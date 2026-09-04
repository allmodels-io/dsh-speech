import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { AllModelsClient, AllModelsError } from './allmodels.ts'
import { isTrustedRequest } from './security.ts'
import {
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_LOW_BALANCE_USD,
  DEFAULT_TOP_UP_USD,
  PLUGIN_NAME,
  SETTINGS_NAMESPACE,
  type SpeechSettings,
  type SpeechUserSettings,
} from './shared.ts'
import { SttProxy } from './stt-proxy.ts'
import { summarizeAnswer, validateSummarizeRequest } from './summarizer.ts'

export const name = PLUGIN_NAME
export const inject = ['webServer', 'credentials', 'llm']
export const SPEECH_SETTINGS_NS = SETTINGS_NAMESPACE

export type Config = SpeechSettings

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  lowBalanceUsd: z.number().min(0).default(DEFAULT_LOW_BALANCE_USD),
  defaultTopUpUsd: z.number().min(5).max(1_000).default(DEFAULT_TOP_UP_USD),
  model: z.string(),
  provider: z.string(),
  language: z.string(),
  context: z.string(),
  ttsModel: z.string(),
  ttsProvider: z.string(),
  ttsVoice: z.string(),
  ttsEnabled: z.boolean().default(true),
  autoPlay: z.boolean().default(true),
  autoplayInlineRevealed: z.boolean().default(false),
})

export const UserSettingsConfig: z<SpeechUserSettings> = z.object({
  model: z.string(),
  provider: z.string(),
  language: z.string(),
  context: z.string(),
  ttsModel: z.string(),
  ttsProvider: z.string(),
  ttsVoice: z.string(),
  ttsEnabled: z.boolean().default(true),
  autoPlay: z.boolean().default(true),
  autoplayInlineRevealed: z.boolean().default(false),
})

const MAX_BODY = 16 * 1024
const MAX_SUMMARIZE_BODY = 384 * 1024
const TTS_LEASE_MS = 10 * 60 * 1_000
const MAX_TTS_LEASES = 128

interface TtsLease {
  chunks: Uint8Array[]
  size: number
  complete: boolean
  error?: unknown
  expiresAt: number
  abort: AbortController
  listeners: Set<() => void>
}

async function readJson(req: IncomingMessage, maximum = MAX_BODY): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > maximum) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object')
  return parsed as Record<string, unknown>
}

function sendAudio(res: ServerResponse, bytes: Uint8Array): void {
  res.writeHead(200, {
    'content-type': 'audio/mpeg',
    'content-length': String(bytes.byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

class PluginHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'PluginHttpError'
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

function safeError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof AllModelsError) {
    const message = /bearer|authorization|secret|api.?key|\bsk-[A-Za-z0-9_-]+/iu.test(error.message)
      ? 'AllModels rejected the credential'
      : error.message.slice(0, 500)
    return { status: error.status >= 400 && error.status < 600 ? error.status : 502, body: { error: { code: error.code, message } } }
  }
  if (error instanceof PluginHttpError) {
    const message = /bearer|authorization|secret|api.?key|\bsk-[A-Za-z0-9_-]+/iu.test(error.message)
      ? 'Request failed'
      : error.message.slice(0, 500)
    return { status: error.status, body: { error: { code: error.code, message } } }
  }
  const message = error instanceof Error && !/api.?key|bearer|secret/i.test(error.message)
    ? error.message.slice(0, 500)
    : 'Request failed'
  return { status: 400, body: { error: { code: 'INVALID_REQUEST', message } } }
}

function emailField(body: Record<string, unknown>): string {
  const email = body.email
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('Enter a valid email address')
  }
  return email
}

function validateSettings(value: Pick<SpeechSettings, 'baseURL' | 'language' | 'context'>): void {
  const url = new URL(value.baseURL)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('baseURL must use HTTP or HTTPS')
  if (value.language !== undefined && value.language !== 'auto'
    && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value.language)) {
    throw new Error('language must be auto or a valid BCP-47 tag')
  }
  if (value.context !== undefined && value.context.length > 4_000) throw new Error('context is limited to 4000 characters')
}

export function apply(ctx: Context, config: Config): void {
  validateSettings(config)
  let handleSettingsChange = (): void => {}
  const entrySettings: SpeechUserSettings = {
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.language === undefined ? {} : { language: config.language }),
    ...(config.context === undefined ? {} : { context: config.context }),
    ...(config.ttsModel === undefined ? {} : { ttsModel: config.ttsModel }),
    ...(config.ttsProvider === undefined ? {} : { ttsProvider: config.ttsProvider }),
    ...(config.ttsVoice === undefined ? {} : { ttsVoice: config.ttsVoice }),
    ttsEnabled: config.ttsEnabled ?? true,
    autoPlay: config.autoPlay ?? true,
    autoplayInlineRevealed: config.autoplayInlineRevealed ?? false,
  }
  let userSettingsSource = (): SpeechUserSettings => entrySettings
  const settingsSource = (): SpeechSettings => ({ ...config, ...userSettingsSource() })
  ctx.inject(['settings'], scoped => scoped.settings.installSection(ctx, SPEECH_SETTINGS_NS, UserSettingsConfig, entrySettings, {
    setSource: (source: () => SpeechUserSettings) => { userSettingsSource = source },
    onChange: () => { handleSettingsChange() },
    validate: (value: SpeechUserSettings) => { validateSettings({ baseURL: config.baseURL, ...value }) },
  }))

  const allModels = new AllModelsClient()
  const pendingSpeech = new Set<AbortController>()
  const ttsLeases = new Map<string, TtsLease>()
  const keyFor = () => credentialRef(settingsSource().apiKeyEnv)
  const resolveCredential = () => ctx.credentials.resolve(keyFor())
  const requireTtsEnabled = (): void => {
    if (settingsSource().ttsEnabled === false) throw new PluginHttpError(409, 'TTS_DISABLED', 'Text-to-speech summaries are disabled')
  }
  const withRequestAbort = async <T>(req: IncomingMessage, operation: (signal: AbortSignal) => Promise<T>, res?: ServerResponse): Promise<T> => {
    const abort = new AbortController()
    const cancelled = (): void => { abort.abort() }
    pendingSpeech.add(abort)
    req.once('aborted', cancelled)
    res?.once('close', cancelled)
    try {
      return await operation(abort.signal)
    } finally {
      req.off('aborted', cancelled)
      res?.off('close', cancelled)
      pendingSpeech.delete(abort)
    }
  }

  const register = (method: 'GET' | 'POST', path: string, handler: (req: IncomingMessage) => Promise<unknown>) => {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (!isTrustedRequest(req, method)) {
          sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } })
          return
        }
        try {
          sendJson(res, 200, await handler(req))
        } catch (error) {
          const safe = safeError(error)
          sendJson(res, safe.status, safe.body)
        }
      },
    }), `${PLUGIN_NAME}: ${method} ${path}`)
  }

  const registerAudio = (path: string, handler: (req: IncomingMessage) => Promise<Uint8Array>) => {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (!isTrustedRequest(req, 'POST')) {
          sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } })
          return
        }
        try {
          sendAudio(res, await handler(req))
        } catch (error) {
          const safe = safeError(error)
          sendJson(res, safe.status, safe.body)
        }
      },
    }), `${PLUGIN_NAME}: POST ${path}`)
  }

  const validateTtsBody = (body: Record<string, unknown>): { text: string; model: string; provider: string; voice: string } => {
    const { text, model, provider, voice } = body
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4_096) throw new Error('text must contain 1 to 4096 characters')
    if (typeof model !== 'string' || model.length === 0 || model.length > 512) throw new Error('model is required')
    if (typeof provider !== 'string' || provider.length === 0 || provider.length > 256) throw new Error('provider is required')
    if (typeof voice !== 'string' || voice.length === 0 || voice.length > 256) throw new Error('voice is required')
    return { text, model, provider, voice }
  }

  const wakeLease = (lease: TtsLease): void => {
    for (const listener of lease.listeners) listener()
    lease.listeners.clear()
  }

  const removeLease = (token: string): void => {
    const lease = ttsLeases.get(token)
    if (lease === undefined) return
    lease.abort.abort()
    wakeLease(lease)
    ttsLeases.delete(token)
  }

  handleSettingsChange = () => {
    if (settingsSource().ttsEnabled !== false) return
    for (const request of pendingSpeech) request.abort()
    for (const token of [...ttsLeases.keys()]) removeLease(token)
  }

  const startLease = (
    lease: TtsLease,
    request: { text: string; model: string; provider: string; voice: string },
    credential: string,
  ): void => {
    pendingSpeech.add(lease.abort)
    void allModels.streamSpeech(settingsSource(), credential, request, chunk => {
      lease.chunks.push(chunk.slice())
      lease.size += chunk.byteLength
      wakeLease(lease)
    }, { signal: lease.abort.signal }).then(() => {
      lease.complete = true
      wakeLease(lease)
    }).catch(error => {
      lease.error = error
      wakeLease(lease)
    }).finally(() => {
      pendingSpeech.delete(lease.abort)
    })
  }

  const serveLease = async (req: IncomingMessage, res: ServerResponse, lease: TtsLease): Promise<void> => {
    let cursor = 0
    let closed = false
    let headersSent = false
    const closedEarly = (): void => {
      closed = true
      wakeLease(lease)
    }
    req.once('aborted', closedEarly)
    res.once('close', closedEarly)
    const waitForChange = (): Promise<void> => new Promise(resolve => {
      if (closed || cursor < lease.chunks.length || lease.complete || lease.error !== undefined) {
        resolve()
        return
      }
      lease.listeners.add(resolve)
    })
    try {
      while (!closed) {
        if (lease.error !== undefined && cursor === 0) throw lease.error
        if (!headersSent && (cursor < lease.chunks.length || lease.complete)) {
          res.writeHead(200, {
            'content-type': 'audio/mpeg',
            ...(lease.complete ? { 'content-length': String(lease.size) } : {}),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'accept-ranges': 'none',
            'x-accel-buffering': 'no',
          })
          headersSent = true
        }
        while (!closed && cursor < lease.chunks.length) {
          const writable = res.write(lease.chunks[cursor++]!)
          if (!writable) await Promise.race([once(res, 'drain'), once(res, 'close')])
        }
        if (closed) return
        if (lease.error !== undefined) {
          if (!headersSent) throw lease.error
          res.destroy()
          return
        }
        if (lease.complete) {
          res.end()
          return
        }
        await waitForChange()
      }
    } finally {
      req.off('aborted', closedEarly)
      res.off('close', closedEarly)
    }
  }

  register('GET', '/api/dsh-speech/status', async () => {
    const settings = settingsSource()
    const credential = await ctx.credentials.describe(keyFor())
    const publicSettings = {
      ...(settings.model === undefined ? {} : { model: settings.model }),
      ...(settings.provider === undefined ? {} : { provider: settings.provider }),
      ...(settings.language === undefined ? {} : { language: settings.language }),
      ...(settings.context === undefined ? {} : { context: settings.context }),
      ...(settings.ttsModel === undefined ? {} : { ttsModel: settings.ttsModel }),
      ...(settings.ttsProvider === undefined ? {} : { ttsProvider: settings.ttsProvider }),
      ...(settings.ttsVoice === undefined ? {} : { ttsVoice: settings.ttsVoice }),
      ttsEnabled: settings.ttsEnabled,
      autoPlay: settings.autoPlay,
      lowBalanceUsd: settings.lowBalanceUsd,
      defaultTopUpUsd: settings.defaultTopUpUsd,
    }
    if (!credential.configured) return { credential, settings: publicSettings }
    const resolved = await resolveCredential()
    if (resolved === undefined) return { credential: { ...credential, configured: false }, settings: publicSettings }
    try {
      const balance = await allModels.balance(settings, resolved.value)
      return { credential, settings: publicSettings, balance }
    } catch (error) {
      return { credential, settings: publicSettings, balanceError: safeError(error).body.error.message }
    }
  })

  register('GET', '/api/dsh-speech/catalog', async req => {
    const force = new URL(req.url ?? '/', 'http://localhost').searchParams.get('refresh') === '1'
    return allModels.catalog(settingsSource(), force)
  })

  register('GET', '/api/dsh-speech/voices', async req => {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams
    const model = query.get('model') ?? undefined
    const provider = query.get('provider') ?? undefined
    const q = query.get('q')?.trim() || undefined
    const language = query.get('language') ?? undefined
    if ((model?.length ?? 0) > 512 || (provider?.length ?? 0) > 256 || (q?.length ?? 0) > 200 || (language?.length ?? 0) > 32) throw new Error('Invalid voice search')
    return allModels.voices(settingsSource(), {
      ...(model === undefined ? {} : { model }),
      ...(provider === undefined ? {} : { provider }),
      ...(q === undefined ? {} : { q }),
      ...(language === undefined ? {} : { language }),
    })
  })

  register('POST', '/api/dsh-speech/summarize', async req => {
    requireTtsEnabled()
    const input = validateSummarizeRequest(await readJson(req, MAX_SUMMARIZE_BODY))
    try {
      return await withRequestAbort(req, async signal => ({ summary: await summarizeAnswer(ctx.llm, input, signal) }))
    } catch {
      ctx.logger.warn('Spoken summary generation failed for the recorded LLM route')
      throw new PluginHttpError(502, 'SUMMARY_FAILED', 'The answer\'s recorded LLM route could not prepare a spoken summary')
    }
  })

  registerAudio('/api/dsh-speech/tts', async req => {
    requireTtsEnabled()
    const request = validateTtsBody(await readJson(req))
    const credential = await resolveCredential()
    if (credential === undefined) throw new Error('Connect AllModels first')
    return withRequestAbort(req, signal => allModels.speech(settingsSource(), credential.value, request, signal))
  })

  register('POST', '/api/dsh-speech/tts/prepare', async req => {
    requireTtsEnabled()
    const now = Date.now()
    for (const [token, lease] of ttsLeases) if (lease.expiresAt <= now) removeLease(token)
    while (ttsLeases.size >= MAX_TTS_LEASES) removeLease(ttsLeases.keys().next().value as string)
    const request = validateTtsBody(await readJson(req))
    const credential = await resolveCredential()
    if (credential === undefined) throw new Error('Connect AllModels first')
    const token = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + TTS_LEASE_MS
    const lease: TtsLease = {
      chunks: [], size: 0, complete: false, expiresAt,
      abort: new AbortController(), listeners: new Set(),
    }
    ttsLeases.set(token, lease)
    // The lease owns upstream generation. A media element may disconnect and
    // reconnect without cancelling or restarting the AllModels speech stream.
    startLease(lease, request, credential.value)
    return { url: `/api/dsh-speech/tts/audio/${token}`, expiresAt }
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/dsh-speech/tts/audio',
    handler: async (req, res) => {
      if (!isTrustedRequest(req, 'GET')) {
        sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } })
        return
      }
      if (settingsSource().ttsEnabled === false) {
        sendJson(res, 409, { error: { code: 'TTS_DISABLED', message: 'Text-to-speech summaries are disabled' } })
        return
      }
      const token = new URL(req.url ?? '/', 'http://localhost').pathname.slice('/api/dsh-speech/tts/audio/'.length)
      const lease = /^[A-Za-z0-9_-]{32}$/u.test(token) ? ttsLeases.get(token) : undefined
      if (lease === undefined || lease.expiresAt <= Date.now()) {
        if (lease !== undefined) removeLease(token)
        sendJson(res, 404, { error: { code: 'AUDIO_EXPIRED', message: 'This spoken audio has expired. Retry to regenerate it.' } })
        return
      }
      try {
        await serveLease(req, res, lease)
      } catch (error) {
        const safe = safeError(error)
        if (!res.headersSent) sendJson(res, safe.status, safe.body)
        else res.destroy()
      }
    },
  }), `${PLUGIN_NAME}: GET /api/dsh-speech/tts/audio/*`)

  register('POST', '/api/dsh-speech/auth/start', async req => {
    await allModels.startAuth(settingsSource(), emailField(await readJson(req)))
    return { ok: true, expiresInSeconds: 300 }
  })

  register('POST', '/api/dsh-speech/auth/verify', async req => {
    const body = await readJson(req)
    const code = body.code
    if (typeof code !== 'string' || !/^\d{6}$/u.test(code)) throw new Error('Enter the six-digit code')
    const key = await allModels.verifyAuth(settingsSource(), emailField(body), code)
    await ctx.credentials.set(keyFor(), key)
    return { ok: true }
  })

  register('POST', '/api/dsh-speech/auth/key', async req => {
    const body = await readJson(req)
    const apiKey = body.apiKey
    if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 2_048) throw new Error('Enter a valid API key')
    await allModels.balance(settingsSource(), apiKey.trim())
    await ctx.credentials.set(keyFor(), apiKey.trim())
    return { ok: true }
  })

  register('POST', '/api/dsh-speech/auth/logout', async () => {
    const info = await ctx.credentials.describe(keyFor())
    if (!info.writable) throw new Error('This credential is managed outside Harness and cannot be removed here')
    await ctx.credentials.unset(keyFor())
    return { ok: true }
  })

  register('POST', '/api/dsh-speech/top-up', async req => {
    const body = await readJson(req)
    const amountUsd = body.amountUsd
    if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd < 5 || amountUsd > 1_000) {
      throw new Error('Top-up amount must be between $5 and $1000')
    }
    const credential = await resolveCredential()
    if (credential === undefined) throw new Error('Connect AllModels first')
    return allModels.topUp(settingsSource(), credential.value, amountUsd)
  })

  const proxy = new SttProxy({
    settings: settingsSource,
    resolveCredential,
    allModels,
    warn: error => { ctx.logger.warn(error) },
  })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/api/dsh-speech/stt',
    handler: (req, socket, head) => { proxy.handleUpgrade(req, socket, head) },
  }), `${PLUGIN_NAME}: WebSocket /api/dsh-speech/stt`)
  ctx.effect(() => () => { proxy.close() }, `${PLUGIN_NAME}: close speech sockets`)
  ctx.effect(() => () => {
    for (const request of pendingSpeech) request.abort()
    pendingSpeech.clear()
    for (const lease of ttsLeases.values()) wakeLease(lease)
    ttsLeases.clear()
  }, `${PLUGIN_NAME}: abort speech requests`)
}

export {
  normalizeCatalog,
  selectBinding,
  summarizeBalance,
  appendTranscript,
  applyTranscriptEvent,
  createTranscript,
  transcriptText,
  selectTtsBinding,
} from './shared.ts'
