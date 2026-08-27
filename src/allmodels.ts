import {
  CATALOG_TTL_MS,
  normalizeCatalog,
  normalizeVoices,
  summarizeBalance,
  type BalanceSummary,
  type CatalogResponse,
  type SpeechSettings,
  type TtsRequest,
  type VoiceCatalogResponse,
} from './shared.ts'

const HTTP_TIMEOUT_MS = 15_000
export const TTS_TIMEOUT_MS = 60_000
export const MAX_TTS_RESPONSE_BYTES = 16 * 1024 * 1024

export class AllModelsError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AllModelsError'
    this.status = status
    this.code = code
  }
}

function endpoint(baseURL: string, path: string): URL {
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL(path.replace(/^\//u, ''), base)
}

function errorMessage(value: unknown, fallback: string): string {
  if (value === null || typeof value !== 'object') return fallback
  const record = value as Record<string, unknown>
  const candidate = record.message ?? record.error ?? record.detail
  return typeof candidate === 'string' && candidate.length <= 500 ? candidate : fallback
}

export async function requestJson(
  baseURL: string,
  path: string,
  init: RequestInit = {},
  apiKey?: string,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, HTTP_TIMEOUT_MS)
  try {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    if (apiKey !== undefined) headers.set('authorization', `Bearer ${apiKey}`)
    const response = await fetch(endpoint(baseURL, path), { ...init, headers, signal: controller.signal })
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      // Never surface an authenticated upstream response body. A provider or
      // intermediary must not be able to reflect a bearer credential into UI,
      // browser traces, or host logs through an error message.
      const message = apiKey === undefined ? errorMessage(body, 'AllModels request failed') : 'AllModels rejected the authenticated request'
      throw new AllModelsError(response.status, `HTTP_${String(response.status)}`, message)
    }
    return body
  } catch (error) {
    if (error instanceof AllModelsError) throw error
    if (controller.signal.aborted) throw new AllModelsError(504, 'TIMEOUT', 'AllModels request timed out')
    throw new AllModelsError(502, 'NETWORK', 'Unable to reach AllModels')
  } finally {
    clearTimeout(timeout)
  }
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
}

export async function requestAudio(
  baseURL: string,
  path: string,
  body: unknown,
  apiKey: string,
  options: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, options.timeoutMs ?? TTS_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(endpoint(baseURL, path), {
      method: 'POST',
      headers: {
        accept: 'audio/mpeg',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => undefined)
      throw new AllModelsError(response.status, `HTTP_${String(response.status)}`, errorMessage(errorBody, 'AllModels speech request failed'))
    }
    const declared = Number(response.headers.get('content-length'))
    const maxBytes = options.maxBytes ?? MAX_TTS_RESPONSE_BYTES
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new AllModelsError(502, 'RESPONSE_TOO_LARGE', 'AllModels speech response exceeded 16 MB')
    }
    if (response.body === null) throw new AllModelsError(502, 'INVALID_AUDIO', 'AllModels returned an empty speech response')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new AllModelsError(502, 'RESPONSE_TOO_LARGE', 'AllModels speech response exceeded 16 MB')
      }
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (!isMp3(bytes)) throw new AllModelsError(502, 'INVALID_AUDIO', 'AllModels returned malformed MP3 audio')
    return bytes
  } catch (error) {
    if (error instanceof AllModelsError) throw error
    if (options.signal?.aborted === true) throw new AllModelsError(499, 'CANCELLED', 'Speech request was cancelled')
    if (controller.signal.aborted) throw new AllModelsError(504, 'TIMEOUT', 'AllModels speech request timed out')
    throw new AllModelsError(502, 'NETWORK', 'Unable to reach AllModels')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export async function streamAudio(
  baseURL: string,
  path: string,
  body: unknown,
  apiKey: string,
  write: (chunk: Uint8Array) => void | Promise<void>,
  options: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal; start?: () => void } = {},
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, options.timeoutMs ?? TTS_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(endpoint(baseURL, path), {
      method: 'POST',
      headers: {
        accept: 'audio/mpeg',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => undefined)
      throw new AllModelsError(response.status, `HTTP_${String(response.status)}`, errorMessage(errorBody, 'AllModels speech request failed'))
    }
    const maxBytes = options.maxBytes ?? MAX_TTS_RESPONSE_BYTES
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new AllModelsError(502, 'RESPONSE_TOO_LARGE', 'AllModels speech response exceeded 16 MB')
    if (response.body === null) throw new AllModelsError(502, 'INVALID_AUDIO', 'AllModels returned an empty speech response')
    const reader = response.body.getReader()
    let size = 0
    let started = false
    let prefix = new Uint8Array()
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new AllModelsError(502, 'RESPONSE_TOO_LARGE', 'AllModels speech response exceeded 16 MB')
      }
      if (!started) {
        const combined = new Uint8Array(prefix.byteLength + part.value.byteLength)
        combined.set(prefix)
        combined.set(part.value, prefix.byteLength)
        prefix = combined
        if (prefix.byteLength < 3) continue
        if (!isMp3(prefix)) throw new AllModelsError(502, 'INVALID_AUDIO', 'AllModels returned malformed MP3 audio')
        options.start?.()
        started = true
        await write(prefix)
      } else {
        await write(part.value)
      }
    }
    if (!started) throw new AllModelsError(502, 'INVALID_AUDIO', 'AllModels returned an empty speech response')
  } catch (error) {
    if (error instanceof AllModelsError) throw error
    if (options.signal?.aborted === true) throw new AllModelsError(499, 'CANCELLED', 'Speech request was cancelled')
    if (controller.signal.aborted) throw new AllModelsError(504, 'TIMEOUT', 'AllModels speech request timed out')
    throw new AllModelsError(502, 'NETWORK', 'Unable to reach AllModels')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export class AllModelsClient {
  private catalogCache: { key: string; expiresAt: number; value: CatalogResponse } | undefined

  async catalog(settings: SpeechSettings, force = false): Promise<CatalogResponse> {
    const now = Date.now()
    if (!force && this.catalogCache?.key === settings.baseURL && this.catalogCache.expiresAt > now) {
      return this.catalogCache.value
    }
    const raw = await requestJson(settings.baseURL, '/v1/providers')
    const value = normalizeCatalog(raw, now)
    if (value.bindings.length === 0) throw new AllModelsError(502, 'EMPTY_CATALOG', 'No compatible streaming STT models are available')
    this.catalogCache = { key: settings.baseURL, expiresAt: now + CATALOG_TTL_MS, value }
    return value
  }

  async balance(settings: SpeechSettings, apiKey: string): Promise<BalanceSummary> {
    const raw = await requestJson(settings.baseURL, '/account/balance', {}, apiKey)
    return summarizeBalance(raw, settings.lowBalanceUsd, {
      ...(settings.provider === undefined ? {} : { provider: settings.provider }),
      ...(settings.model === undefined ? {} : { model: settings.model }),
    })
  }

  async voices(settings: SpeechSettings, filters: { model?: string; provider?: string; q?: string; language?: string }): Promise<VoiceCatalogResponse> {
    const query = new URLSearchParams({ sort: filters.q === undefined || filters.q.length === 0 ? 'featured' : 'relevance', page_size: '100' })
    if (filters.model !== undefined) query.set('model', filters.model)
    if (filters.provider !== undefined) query.set('provider', filters.provider)
    if (filters.q !== undefined && filters.q.length > 0) query.set('q', filters.q)
    if (filters.language !== undefined && filters.language.length > 0) query.set('language', filters.language)
    return normalizeVoices(await requestJson(settings.baseURL, `/v1/voices?${query.toString()}`))
  }

  async speech(settings: SpeechSettings, apiKey: string, request: TtsRequest, signal?: AbortSignal): Promise<Uint8Array> {
    const query = new URLSearchParams({ provider_only: request.provider })
    return requestAudio(settings.baseURL, `/oai/audio/speech?${query.toString()}`, {
      model: request.model,
      voice: request.voice,
      input: request.text,
      response_format: 'mp3',
      stream_format: 'audio',
    }, apiKey, signal === undefined ? {} : { signal })
  }

  async streamSpeech(
    settings: SpeechSettings,
    apiKey: string,
    request: TtsRequest,
    write: (chunk: Uint8Array) => void | Promise<void>,
    options: { signal?: AbortSignal; start?: () => void } = {},
  ): Promise<void> {
    const query = new URLSearchParams({ provider_only: request.provider, allow_fallbacks: 'false' })
    await streamAudio(settings.baseURL, `/oai/audio/speech?${query.toString()}`, {
      model: request.model,
      voice: request.voice,
      input: request.text,
      response_format: 'mp3',
      stream_format: 'audio',
    }, apiKey, write, options)
  }

  async startAuth(settings: SpeechSettings, email: string): Promise<void> {
    await requestJson(settings.baseURL, '/account/agent-signup', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async verifyAuth(settings: SpeechSettings, email: string, code: string): Promise<string> {
    const raw = await requestJson(settings.baseURL, '/account/agent-signup/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    })
    if (raw === null || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).apiKey !== 'string') {
      throw new AllModelsError(502, 'INVALID_RESPONSE', 'AllModels did not return an API key')
    }
    return (raw as { apiKey: string }).apiKey
  }

  async topUp(settings: SpeechSettings, apiKey: string, amountUsd: number): Promise<{ url: string; expiresAt?: string }> {
    const raw = await requestJson(settings.baseURL, '/account/top-up-link', {
      method: 'POST',
      body: JSON.stringify({ amount_usd: amountUsd }),
    }, apiKey)
    if (raw === null || typeof raw !== 'object') throw new AllModelsError(502, 'INVALID_RESPONSE', 'Invalid top-up response')
    const record = raw as Record<string, unknown>
    const url = record.url ?? record.top_up_url ?? record.checkout_url
    if (typeof url !== 'string' || !/^https:\/\//u.test(url)) {
      throw new AllModelsError(502, 'INVALID_RESPONSE', 'AllModels did not return a secure top-up link')
    }
    return {
      url,
      ...(typeof record.expires_at === 'string' ? { expiresAt: record.expires_at } : {}),
    }
  }
}
