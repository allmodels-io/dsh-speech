import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import type { ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { AllModelsClient } from './allmodels.ts'
import { AUDIO_FORMAT, selectBinding, type SpeechSettings } from './shared.ts'
import { isTrustedRequest } from './security.ts'

const MAX_AUDIO_FRAME = 64 * 1024
const MAX_CONTROL_FRAME = 4 * 1024
const MAX_BUFFERED_BYTES = 1024 * 1024
const START_TIMEOUT_MS = 10_000

interface StartMessage {
  type: 'start'
  locale: string
  audioFormat: typeof AUDIO_FORMAT
}

interface SttProxyOptions {
  settings: () => SpeechSettings
  resolveCredential: () => Promise<ResolvedCredential | undefined>
  allModels: AllModelsClient
  warn: (error: Error) => void
}

export function parseStart(data: RawData): StartMessage | undefined {
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) return undefined
  const text = typeof data === 'string' ? data : data.toString('utf8')
  if (Buffer.byteLength(text) > MAX_CONTROL_FRAME) return undefined
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    if (record.type !== 'start' || record.audioFormat !== AUDIO_FORMAT || typeof record.locale !== 'string') return undefined
    return { type: 'start', audioFormat: AUDIO_FORMAT, locale: record.locale.slice(0, 64) }
  } catch {
    return undefined
  }
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function closeWithError(socket: WebSocket, code: string, message: string): void {
  send(socket, { type: 'error', code, message })
  socket.close(1011, code.slice(0, 120))
}

export function upstreamUrl(settings: SpeechSettings, binding: { provider: string; model: string; contextSupported: boolean; interimResultsSupported: boolean }): URL {
  const base = new URL(settings.baseURL)
  base.protocol = base.protocol === 'http:' ? 'ws:' : 'wss:'
  base.pathname = '/v1/stt'
  base.search = ''
  base.searchParams.set('provider', binding.provider)
  base.searchParams.set('model', binding.model)
  base.searchParams.set('audio_format', AUDIO_FORMAT)
  base.searchParams.set('event_format', 'normalized')
  base.searchParams.set('commit_strategy', 'auto')
  if (binding.interimResultsSupported) base.searchParams.set('interim_results', 'true')
  if (settings.language !== undefined && settings.language !== '' && settings.language !== 'auto') {
    base.searchParams.set('language', settings.language)
  }
  if (binding.contextSupported && settings.context !== undefined && settings.context.trim() !== '') {
    base.searchParams.set('context', settings.context.trim())
  }
  return base
}

export function normalizedEvent(data: RawData): unknown {
  try {
    const text = typeof data === 'string' ? data : data.toString('utf8')
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object') return undefined
    const event = value as Record<string, unknown>
    const eventType = event.type ?? event.event
    const sequenceValue = event.sequence ?? event.seq
    const sequence = typeof sequenceValue === 'number' ? sequenceValue : 0
    const languageCode = typeof event.language_code === 'string'
      ? event.language_code
      : typeof event.languageCode === 'string' ? event.languageCode : undefined
    if (eventType === 'stt.transcript.partial' && typeof event.text === 'string') {
      return { type: 'partial', sequence, text: event.text, ...(languageCode === undefined ? {} : { languageCode }) }
    }
    if (eventType === 'stt.transcript.final' && typeof event.text === 'string') {
      return { type: 'final', sequence, text: event.text, ...(languageCode === undefined ? {} : { languageCode }) }
    }
    if (eventType === 'stt.error') {
      const code = typeof event.code === 'string' ? event.code : 'UPSTREAM_ERROR'
      const message = typeof event.message === 'string' ? event.message : 'Speech recognition failed'
      return { type: 'error', code, message }
    }
    if (eventType === 'stt.session.ended' || eventType === 'stt.ended') return { type: 'ended' }
    return undefined
  } catch {
    return undefined
  }
}

function rawDataBytes(data: RawData): number {
  if (typeof data === 'string') return Buffer.byteLength(data)
  if (data instanceof ArrayBuffer) return data.byteLength
  if (Array.isArray(data)) return data.reduce((sum, entry) => sum + entry.byteLength, 0)
  return data.byteLength
}

export class SttProxy {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_AUDIO_FRAME })
  private readonly clients = new Set<WebSocket>()

  constructor(private readonly options: SttProxyOptions) {
    this.server.on('connection', socket => { this.accept(socket) })
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!isTrustedRequest(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    this.server.handleUpgrade(req, socket, head, client => {
      this.server.emit('connection', client, req)
    })
  }

  close(): void {
    for (const client of this.clients) client.close(1001, 'plugin disposed')
    this.clients.clear()
    this.server.close()
  }

  private accept(client: WebSocket): void {
    this.clients.add(client)
    let upstream: WebSocket | undefined
    let started = false
    let closing = false
    let clientClosed = false
    const startTimeout = setTimeout(() => {
      if (!started) closeWithError(client, 'START_TIMEOUT', 'Speech session did not start in time')
    }, START_TIMEOUT_MS)

    const cleanup = (): void => {
      clientClosed = true
      clearTimeout(startTimeout)
      this.clients.delete(client)
      if (upstream !== undefined && upstream.readyState < WebSocket.CLOSING) upstream.close(1000, 'client closed')
    }
    client.once('close', cleanup)
    client.on('error', error => { this.options.warn(error) })

    client.on('message', (data, isBinary) => {
      if (!started) {
        if (isBinary) {
          closeWithError(client, 'EXPECTED_START', 'The first speech frame must be a start message')
          return
        }
        const start = parseStart(data)
        if (start === undefined) {
          closeWithError(client, 'INVALID_START', 'Invalid speech start message')
          return
        }
        started = true
        clearTimeout(startTimeout)
        void this.openUpstream(client, start).then(value => {
          upstream = value
          if (clientClosed && value.readyState < WebSocket.CLOSING) value.close(1000, 'client closed')
        }).catch(error => {
          const message = error instanceof Error ? error.message : 'Unable to start speech recognition'
          closeWithError(client, 'START_FAILED', message)
        })
        return
      }

      if (isBinary) {
        if (rawDataBytes(data) > MAX_AUDIO_FRAME) {
          closeWithError(client, 'FRAME_TOO_LARGE', 'Audio frame is too large')
          return
        }
        if (upstream?.readyState !== WebSocket.OPEN) return
        if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
          closeWithError(client, 'BACKPRESSURE', 'The speech provider cannot keep up with audio input')
          return
        }
        upstream.send(data, { binary: true })
        return
      }

      if (rawDataBytes(data) > MAX_CONTROL_FRAME || upstream?.readyState !== WebSocket.OPEN) return
      try {
        const control = JSON.parse(data.toString('utf8')) as { type?: unknown }
        if (control.type === 'commit') upstream.send(JSON.stringify({ type: 'stt.audio.commit' }))
        if (control.type === 'close' && !closing) {
          closing = true
          upstream.send(JSON.stringify({ type: 'stt.session.close' }))
        }
      } catch {
        closeWithError(client, 'INVALID_CONTROL', 'Invalid speech control message')
      }
    })
  }

  private async openUpstream(client: WebSocket, start: StartMessage): Promise<WebSocket> {
    const settings = this.options.settings()
    const [credential, catalog] = await Promise.all([
      this.options.resolveCredential(),
      this.options.allModels.catalog(settings),
    ])
    if (credential === undefined) throw new Error('Connect AllModels in Settings → Speech')
    const binding = selectBinding(catalog.bindings, start.locale, {
      ...(settings.model === undefined ? {} : { model: settings.model }),
      ...(settings.provider === undefined ? {} : { provider: settings.provider }),
    })
    if (binding === undefined) throw new Error('No compatible streaming STT model is available')
    const url = upstreamUrl(settings, binding)
    const upstream = new WebSocket(url, { headers: { authorization: `Bearer ${credential.value}` } })
    upstream.on('open', () => {
      send(client, { type: 'ready', model: binding.model, provider: binding.provider })
    })
    upstream.on('message', data => {
      const event = normalizedEvent(data)
      if (event !== undefined) send(client, event)
    })
    upstream.on('error', () => {
      closeWithError(client, 'UPSTREAM_CONNECTION', 'The speech provider connection failed')
    })
    upstream.on('close', () => {
      send(client, { type: 'ended' })
      if (client.readyState < WebSocket.CLOSING) client.close(1000, 'speech ended')
    })
    return upstream
  }
}
