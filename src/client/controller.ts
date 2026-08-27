import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { AudioCapture, type MicrophoneDevice } from './audio.ts'
import { speechApi } from './api.ts'
import { readPreferredMicrophone, writePreferredMicrophone } from './microphonePreference.ts'
import {
  AUDIO_FORMAT,
  applyTranscriptEvent,
  createTranscript,
  transcriptText,
  type CatalogResponse,
  type StatusResponse,
  type TranscriptAccumulator,
} from '../shared.ts'

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'finalizing' | 'error'

export interface SpeechClientState {
  phase: RecordingPhase
  activeSessionId?: SessionId | undefined
  amplitude: number
  status?: StatusResponse | undefined
  catalog?: CatalogResponse | undefined
  metadataLoading: boolean
  error?: string | undefined
  activeModel?: string | undefined
  activeProvider?: string | undefined
  microphones: MicrophoneDevice[]
  activeMicrophoneId?: string | undefined
  switchingMicrophone: boolean
  microphoneError?: string | undefined
}

interface ComposerBlocks {
  set(sessionId: SessionId, block: { reason: string } | undefined): void
}

interface StartOptions {
  sessionId: SessionId
  draft: string
  inputActions: { setDraft(text: string): void }
  locale: string
  listeningReason: string
}

interface ActiveRecording extends StartOptions {
  socket: WebSocket
  capture: AudioCapture
  transcript: TranscriptAccumulator
  finished: boolean
  stoppingCapture?: Promise<void>
  finalTimer?: ReturnType<typeof setTimeout>
  deviceChangeHandler?: (() => void) | undefined
}

function socketUrl(): string {
  const url = new URL('/api/dsh-speech/stt', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export class SpeechController {
  private snapshot: SpeechClientState = {
    phase: 'idle', amplitude: 0, metadataLoading: false, microphones: [], switchingMicrophone: false,
  }
  private readonly listeners = new Set<() => void>()
  private blocks: ComposerBlocks | undefined
  private active: ActiveRecording | undefined
  private metadataPromise: Promise<void> | undefined
  private preferredMicrophoneId = readPreferredMicrophone()

  readonly getSnapshot = (): SpeechClientState => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  attachBlocks(blocks: ComposerBlocks | undefined): void {
    this.blocks = blocks
  }

  detachBlocks(blocks: ComposerBlocks): void {
    if (this.blocks !== blocks) return
    const active = this.active
    if (active !== undefined) this.finish(active)
    this.blocks = undefined
  }

  reportError(message: string): void {
    this.publish({ phase: 'error', error: message })
  }

  async ensureMetadata(refresh = false): Promise<void> {
    if (!refresh && this.metadataPromise !== undefined) return this.metadataPromise
    this.publish({ metadataLoading: true, ...(refresh ? { error: undefined } : {}) })
    const operation = Promise.allSettled([speechApi.status(), speechApi.catalog(refresh)])
      .then(([status, catalog]) => {
        const errors = [status, catalog]
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map(result => result.reason instanceof Error ? result.reason.message : 'Unable to load speech settings')
        this.publish({
          ...(status.status === 'fulfilled' ? { status: status.value } : {}),
          ...(catalog.status === 'fulfilled' ? { catalog: catalog.value } : {}),
          metadataLoading: false,
          ...(errors.length === 0 ? { error: undefined } : { error: errors.join(' · ') }),
        })
      })
      .finally(() => { if (this.metadataPromise === operation) this.metadataPromise = undefined })
    this.metadataPromise = operation
    return operation
  }

  async toggle(options: StartOptions): Promise<void> {
    if (this.active?.sessionId === options.sessionId) {
      await this.stop()
      return
    }
    if (this.active !== undefined) throw new Error('A microphone is already active in another session')
    await this.start(options)
  }

  release(sessionId: SessionId): void {
    const active = this.active
    if (active?.sessionId === sessionId) this.finish(active)
  }

  async stop(): Promise<void> {
    const active = this.active
    if (active === undefined || active.finished) return
    this.publish({ phase: 'finalizing', amplitude: 0 })
    const stoppingCapture = active.stoppingCapture ??= active.capture.stop()
    if (active.socket.readyState === WebSocket.OPEN) {
      active.socket.send(JSON.stringify({ type: 'commit' }))
      active.socket.send(JSON.stringify({ type: 'close' }))
    }
    active.finalTimer = setTimeout(() => { this.finish(active) }, 5_000)
    await stoppingCapture
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    const active = this.active
    if (active === undefined || active.finished || this.snapshot.phase !== 'recording') return
    const previousDeviceId = this.snapshot.activeMicrophoneId
    this.publish({ activeMicrophoneId: deviceId, switchingMicrophone: true, microphoneError: undefined })
    try {
      const microphones = await active.capture.switchMicrophone(deviceId)
      if (this.active !== active || active.finished) return
      this.publish({
        microphones: microphones.devices,
        activeMicrophoneId: microphones.activeDeviceId,
        switchingMicrophone: false,
      })
      this.preferredMicrophoneId = microphones.activeDeviceId ?? ''
      writePreferredMicrophone(this.preferredMicrophoneId)
    } catch (error) {
      if (this.active !== active || active.finished) return
      this.publish({
        activeMicrophoneId: previousDeviceId,
        switchingMicrophone: false,
        microphoneError: error instanceof Error ? error.message : 'Unable to switch microphone',
      })
    }
  }

  dispose(): void {
    const active = this.active
    if (active !== undefined) this.finish(active)
    this.listeners.clear()
  }

  private async start(options: StartOptions): Promise<void> {
    await this.ensureMetadata()
    const status = this.snapshot.status
    if (status?.credential.configured !== true) throw new Error('Connect AllModels in Settings → Speech')
    if (status.balance?.exhausted === true) throw new Error('Your AllModels balance is empty')

    const socket = new WebSocket(socketUrl())
    const capture = new AudioCapture()
    const active: ActiveRecording = {
      ...options,
      socket,
      capture,
      transcript: createTranscript(options.draft),
      finished: false,
    }
    this.active = active
    this.blocks?.set(options.sessionId, { reason: options.listeningReason })
    this.publish({
      phase: 'starting', activeSessionId: options.sessionId, amplitude: 0, error: undefined,
      activeModel: undefined, activeProvider: undefined, microphones: [], activeMicrophoneId: undefined,
      switchingMicrophone: false, microphoneError: undefined,
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { reject(new Error('Speech connection timed out')) }, 10_000)
        let settled = false
        const succeed = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve()
        }
        const fail = (message: string): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(new Error(message))
        }
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ type: 'start', locale: options.locale, audioFormat: AUDIO_FORMAT }))
        }, { once: true })
        socket.addEventListener('message', event => {
          if (typeof event.data !== 'string') return
          try {
            const message = JSON.parse(event.data) as Record<string, unknown>
            if (message.type === 'ready') {
              this.publish({
                activeModel: typeof message.model === 'string' ? message.model : undefined,
                activeProvider: typeof message.provider === 'string' ? message.provider : undefined,
              })
              succeed()
            }
            if (message.type === 'error') fail(typeof message.message === 'string' ? message.message : 'Unable to start speech recognition')
          } catch {}
        })
        socket.addEventListener('error', () => { fail('Unable to connect to speech recognition') }, { once: true })
        socket.addEventListener('close', () => { fail('The speech connection closed before it was ready') }, { once: true })
      })
      this.bindSocket(active)
      await capture.start(
        frame => { if (socket.readyState === WebSocket.OPEN && this.active === active) socket.send(frame) },
        amplitude => { if (this.active === active) this.publish({ amplitude: Math.min(1, amplitude * 4) }) },
        this.preferredMicrophoneId,
      )
      if (this.active !== active) return
      this.publish({ phase: 'recording' })
      void this.refreshMicrophones(active)
      if (typeof navigator.mediaDevices?.addEventListener === 'function') {
        active.deviceChangeHandler = () => { void this.refreshMicrophones(active) }
        navigator.mediaDevices.addEventListener('devicechange', active.deviceChangeHandler)
      }
    } catch (error) {
      await capture.stop()
      this.fail(active, error instanceof Error ? error.message : 'Unable to start microphone')
      throw error
    }
  }

  private bindSocket(active: ActiveRecording): void {
    active.socket.addEventListener('message', event => {
      if (this.active !== active || typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>
        if ((message.type === 'partial' || message.type === 'final')
          && typeof message.text === 'string' && typeof message.sequence === 'number') {
          active.transcript = applyTranscriptEvent(active.transcript, {
            kind: message.type,
            sequence: message.sequence,
            text: message.text,
            ...(typeof message.languageCode === 'string' ? { languageCode: message.languageCode } : {}),
          })
          active.inputActions.setDraft(transcriptText(active.transcript))
          if (message.type === 'final' && this.snapshot.phase === 'finalizing') {
            if (active.finalTimer !== undefined) clearTimeout(active.finalTimer)
            active.finalTimer = setTimeout(() => { this.finish(active) }, 120)
          }
        }
        if (message.type === 'error') {
          this.fail(active, typeof message.message === 'string' ? message.message : 'Speech recognition failed')
        }
        if (message.type === 'ended') this.finish(active)
      } catch {
        this.fail(active, 'The speech service returned an invalid event')
      }
    })
    active.socket.addEventListener('close', () => {
      if (this.active === active && this.snapshot.phase !== 'starting') this.finish(active)
    })
  }

  private fail(active: ActiveRecording, message: string): void {
    if (active.finished) return
    active.inputActions.setDraft(transcriptText(active.transcript))
    this.finish(active, message)
  }

  private finish(active: ActiveRecording, error?: string): void {
    if (active.finished) return
    active.finished = true
    if (active.finalTimer !== undefined) clearTimeout(active.finalTimer)
    if (active.deviceChangeHandler !== undefined && typeof navigator.mediaDevices?.removeEventListener === 'function') {
      navigator.mediaDevices.removeEventListener('devicechange', active.deviceChangeHandler)
    }
    void (active.stoppingCapture ??= active.capture.stop())
    if (active.socket.readyState === WebSocket.OPEN) active.socket.send(JSON.stringify({ type: 'close' }))
    if (active.socket.readyState < WebSocket.CLOSING) active.socket.close(1000, 'recording complete')
    this.blocks?.set(active.sessionId, undefined)
    if (this.active === active) this.active = undefined
    this.publish({
      phase: error === undefined ? 'idle' : 'error',
      activeSessionId: undefined,
      amplitude: 0,
      microphones: [],
      activeMicrophoneId: undefined,
      switchingMicrophone: false,
      microphoneError: undefined,
      ...(error === undefined ? { error: undefined } : { error }),
    })
    void this.ensureMetadata(true)
  }

  private publish(patch: Partial<SpeechClientState>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private async refreshMicrophones(active: ActiveRecording): Promise<void> {
    try {
      const microphones = await active.capture.microphones()
      if (this.active !== active || active.finished) return
      this.publish({
        microphones: microphones.devices,
        activeMicrophoneId: microphones.activeDeviceId,
      })
      const activeDeviceId = microphones.activeDeviceId ?? ''
      if (activeDeviceId !== this.preferredMicrophoneId) {
        this.preferredMicrophoneId = activeDeviceId
        writePreferredMicrophone(activeDeviceId)
      }
    } catch {}
  }
}
