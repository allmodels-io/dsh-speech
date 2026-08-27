import type { ConversationNode, RequestView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  MAX_SUMMARY_ANSWER_CHARACTERS,
  MAX_SUMMARY_REQUEST_CHARACTERS,
  preferredTtsSelection,
  selectLocalizedTtsBinding,
  type LlmRoute,
  type TtsCatalogBinding,
} from '../shared.ts'
import { speechApi } from './api.ts'

export type SpokenPhase = 'idle' | 'preparing' | 'ready' | 'playing' | 'error'

export interface SpokenMessageSource {
  messageId: string
  request: string
  answer: string
  locale: string
  route?: LlmRoute
}

export interface SpokenPreparationSettings {
  autoPlay: boolean
  bindings: readonly TtsCatalogBinding[]
  ttsModel?: string
  ttsProvider?: string
  ttsVoice?: string
}

export interface SpokenMessageState {
  phase: SpokenPhase
  summary?: string | undefined
  audioUrl?: string | undefined
  duration: number
  progress: number
  peaks: readonly number[]
  error?: string | undefined
  ended?: boolean | undefined
}

export interface SpokenControllerSnapshot {
  messages: ReadonlyMap<string, SpokenMessageState>
  activeMessageId?: string
}

interface MutableMessage extends SpokenMessageState {
  abort?: AbortController | undefined
  requestGeneration: number
  mounts: number
  releaseGeneration: number
  ephemeral?: boolean
}

interface AudioLike {
  src: string
  currentTime: number
  duration: number
  paused: boolean
  preload: string
  onended: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onpause: ((event: Event) => void) | null
  ontimeupdate: ((event: Event) => void) | null
  play(): Promise<void>
  pause(): void
  removeAttribute(name: string): void
  load(): void
  captureStream?: (() => MediaStream) | undefined
}

const EMPTY_PEAKS = Object.freeze(Array.from({ length: 48 }, (_, index) => 0.15 + 0.08 * Math.sin(index * 0.73) ** 2))

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap(block => {
    if (block === null || typeof block !== 'object') return []
    const candidate = block as { type?: unknown; text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : []
  }).join('\n').trim()
}

function boundSource(text: string, maximum: number): string {
  if (text.length <= maximum) return text
  const marker = '\n\n[...middle omitted for spoken-summary input...]\n\n'
  const remaining = maximum - marker.length
  const beginning = Math.ceil(remaining / 2)
  return `${text.slice(0, beginning)}${marker}${text.slice(text.length - (remaining - beginning))}`
}

/** Derive only the closing finalized assistant message for each completed turn. */
export function spokenSources(nodes: readonly ConversationNode[], locale: string, requests: readonly RequestView[] = []): SpokenMessageSource[] {
  const closings = new Map<number, Extract<ConversationNode, { kind: 'assistant' }>>()
  for (const node of nodes) {
    if (node.kind !== 'assistant' || node.messageId === undefined || node.interrupted === true) continue
    const current = closings.get(node.turn)
    if (current === undefined || node.seq > current.seq) closings.set(node.turn, node)
  }
  const result: SpokenMessageSource[] = []
  for (const assistant of [...closings.values()].sort((a, b) => a.seq - b.seq)) {
    const answer = assistant.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n').trim()
    if (answer.length === 0 || assistant.messageId === undefined) continue
    let request = ''
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const candidate = nodes[index]
      if (candidate === undefined || candidate.seq >= assistant.seq) continue
      if (candidate.kind === 'user' || candidate.kind === 'steering') {
        request = contentText(candidate.content)
        if (request.length > 0) break
      }
    }
    const inspection = requests.find(request => request.purpose === 'assistant' && request.resultSeq === assistant.seq)
      ?? [...requests].reverse().find(request => request.purpose === 'assistant'
        && request.turn === assistant.turn && request.step === assistant.step && request.status === 'complete')
    const recorded = assistant.requestConfig ?? assistant.provenance ?? inspection?.requestConfig ?? inspection?.provenance
    const route = recorded === undefined ? undefined : {
      provider: recorded.provider,
      model: recorded.model,
      ...('reasoningEffort' in recorded && typeof recorded.reasoningEffort === 'string'
        ? { reasoningEffort: recorded.reasoningEffort }
        : {}),
    }
    result.push({
      messageId: String(assistant.messageId),
      request: boundSource(request, MAX_SUMMARY_REQUEST_CHARACTERS),
      answer: boundSource(answer, MAX_SUMMARY_ANSWER_CHARACTERS),
      locale,
      ...(route === undefined ? {} : { route }),
    })
  }
  return result
}

const INTERACTION_CUES: Readonly<Record<string, string>> = {
  en: 'I need some feedback to keep going.',
  zh: '我需要你的反馈才能继续。',
  ja: '続けるには、フィードバックが必要です。',
  ko: '계속하려면 피드백이 필요해요.',
  es: 'Necesito tus comentarios para continuar.',
  fr: 'J’ai besoin de votre avis pour continuer.',
  de: 'Ich brauche Ihre Rückmeldung, um fortzufahren.',
  pt: 'Preciso do seu feedback para continuar.',
  it: 'Ho bisogno del tuo feedback per continuare.',
  ru: 'Мне нужна ваша обратная связь, чтобы продолжить.',
  ar: 'أحتاج إلى ملاحظاتك لكي أتابع.',
  hi: 'आगे बढ़ने के लिए मुझे आपकी प्रतिक्रिया चाहिए।',
  id: 'Saya perlu masukan Anda untuk melanjutkan.',
  vi: 'Tôi cần phản hồi của bạn để tiếp tục.',
}

export function interactionCue(locale: string): string {
  return INTERACTION_CUES[locale.toLowerCase().split('-')[0] ?? ''] ?? INTERACTION_CUES.en!
}

function revokeAudioUrl(url: string | undefined): void {
  if (url?.startsWith('blob:') === true) URL.revokeObjectURL(url)
}

function browserAudio(): AudioLike {
  const audio = new Audio()
  audio.preload = 'metadata'
  return audio
}

export class SpokenSummaryController {
  private readonly audio: AudioLike
  private readonly listeners = new Set<() => void>()
  private readonly states = new Map<string, MutableMessage>()
  private readonly observed = new Map<string, Set<string>>()
  private readonly observedInteractions = new Set<string>()
  private readonly voiceCache = new Map<string, Promise<readonly string[]>>()
  private activeMessageId: string | undefined
  private loadedMessageId: string | undefined
  private playbackGeneration = 0
  private snapshot: SpokenControllerSnapshot = { messages: new Map() }
  private disposed = false
  private analyserContext: AudioContext | undefined
  private analyserSource: MediaStreamAudioSourceNode | undefined
  private analyser: AnalyserNode | undefined
  private analyserData: Uint8Array<ArrayBuffer> | undefined
  private analysisFrame: number | undefined
  private analysisTick = 0

  constructor(audioFactory: () => AudioLike = browserAudio) {
    this.audio = audioFactory()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): SpokenControllerSnapshot => this.snapshot

  mount(messageId: string): () => void {
    const state = this.ensure(messageId)
    state.mounts += 1
    state.releaseGeneration += 1
    return () => {
      state.mounts = Math.max(0, state.mounts - 1)
      const releaseGeneration = ++state.releaseGeneration
      queueMicrotask(() => {
        if (state.mounts === 0 && state.releaseGeneration === releaseGeneration) this.release(messageId)
      })
    }
  }

  observeSession(sessionKey: string, sources: readonly SpokenMessageSource[], settings: SpokenPreparationSettings): void {
    if (this.disposed) return
    const ids = new Set(sources.map(source => source.messageId))
    const previous = this.observed.get(sessionKey)
    if (previous === undefined) {
      this.observed.set(sessionKey, ids)
      for (const id of ids) this.ensure(id)
      this.publish()
      return
    }
    this.observed.set(sessionKey, new Set([...previous, ...ids]))
    for (const source of sources) {
      if (previous.has(source.messageId)) continue
      previous.add(source.messageId)
      void this.prepare(source, settings, settings.autoPlay)
    }
  }

  observeInteractions(sessionKey: string, interactionKeys: readonly string[], locale: string, settings: SpokenPreparationSettings): void {
    if (this.disposed) return
    for (const key of interactionKeys) {
      const identity = `${sessionKey}\n${key}`
      if (this.observedInteractions.has(identity)) continue
      this.observedInteractions.add(identity)
      if (settings.autoPlay) void this.prepareCue(`interaction:${identity}`, interactionCue(locale), settings)
    }
  }

  async prepare(source: SpokenMessageSource, settings: SpokenPreparationSettings, autoPlay = false): Promise<void> {
    const state = this.ensure(source.messageId)
    if (state.phase === 'preparing' || state.phase === 'ready' || state.phase === 'playing') {
      if (state.phase === 'ready' && !autoPlay) await this.play(source.messageId, true)
      return
    }
    if (source.route === undefined) {
      this.fail(source.messageId, 'The completed answer has no recorded LLM route.')
      return
    }
    const binding = selectLocalizedTtsBinding(settings.bindings, source.locale, {
      ...(settings.ttsModel === undefined ? {} : { model: settings.ttsModel }),
      ...(settings.ttsProvider === undefined ? {} : { provider: settings.ttsProvider }),
    })
    if (binding === undefined) {
      this.fail(source.messageId, 'No compatible synchronous text-to-speech model is available.')
      return
    }
    const abort = new AbortController()
    state.abort?.abort()
    state.abort = abort
    const requestGeneration = ++state.requestGeneration
    this.patch(source.messageId, { phase: 'preparing', error: undefined, progress: 0 })
    try {
      const voice = await this.voiceFor(binding, settings.ttsVoice)
      if (voice === undefined) throw new Error('No compatible voice is available for this text-to-speech route.')
      const { summary } = await speechApi.summarize({
        request: source.request || 'No preceding user prose was available.',
        answer: source.answer,
        locale: source.locale,
        route: source.route,
      }, abort.signal)
      const prepared = await speechApi.prepareTts({ text: summary, model: binding.model, provider: binding.provider, voice }, abort.signal)
      if (this.disposed || abort.signal.aborted || state.requestGeneration !== requestGeneration) return
      state.abort = undefined
      this.patch(source.messageId, {
        phase: 'ready', summary, audioUrl: prepared.url, duration: 0, progress: 0, peaks: EMPTY_PEAKS, error: undefined, ended: false,
      })
      if (autoPlay && this.activeMessageId === undefined) await this.play(source.messageId, false)
    } catch (error) {
      if (abort.signal.aborted || state.requestGeneration !== requestGeneration) return
      state.abort = undefined
      this.fail(source.messageId, error instanceof Error ? error.message : 'Could not prepare the spoken summary.')
    }
  }

  private async prepareCue(messageId: string, text: string, settings: SpokenPreparationSettings): Promise<void> {
    const state = this.ensure(messageId)
    state.ephemeral = true
    const binding = selectLocalizedTtsBinding(settings.bindings, text === INTERACTION_CUES.zh ? 'zh' : 'en', {
      ...(settings.ttsModel === undefined ? {} : { model: settings.ttsModel }),
      ...(settings.ttsProvider === undefined ? {} : { provider: settings.ttsProvider }),
    })
    if (binding === undefined) {
      this.release(messageId)
      return
    }
    const abort = new AbortController()
    state.abort = abort
    const requestGeneration = ++state.requestGeneration
    try {
      const voice = await this.voiceFor(binding, settings.ttsVoice)
      if (voice === undefined) throw new Error('No compatible voice is available.')
      const prepared = await speechApi.prepareTts({ text, model: binding.model, provider: binding.provider, voice }, abort.signal)
      if (this.disposed || abort.signal.aborted || state.requestGeneration !== requestGeneration) return
      state.abort = undefined
      this.patch(messageId, { phase: 'ready', audioUrl: prepared.url, duration: 0, progress: 0, peaks: EMPTY_PEAKS, ended: false })
      if (this.activeMessageId !== undefined) {
        this.release(messageId)
        return
      }
      await this.play(messageId, false)
      if (this.activeMessageId !== messageId) this.release(messageId)
    } catch {
      if (!abort.signal.aborted && state.requestGeneration === requestGeneration) this.release(messageId)
    }
  }

  async play(messageId: string, explicit: boolean): Promise<void> {
    const state = this.states.get(messageId)
    if (state?.audioUrl === undefined || this.disposed) return
    if (!explicit && this.activeMessageId !== undefined && this.activeMessageId !== messageId) return
    if (this.activeMessageId !== undefined && this.activeMessageId !== messageId) this.stopActive()
    const generation = ++this.playbackGeneration
    this.activeMessageId = messageId
    if (this.loadedMessageId !== messageId) {
      this.audio.pause()
      this.audio.src = state.audioUrl
      this.loadedMessageId = messageId
      this.audio.currentTime = state.progress > 0 && (state.duration <= 0 || state.progress < state.duration * 0.98) ? state.progress : 0
    } else if (state.ended === true) {
      this.audio.currentTime = 0
    }
    this.audio.onended = () => { this.finishPlayback(generation, messageId, true) }
    this.audio.onerror = () => {
      if (!this.owns(generation, messageId)) return
      this.fail(messageId, 'The spoken summary could not be played.')
      this.clearAudioOwnership(true)
    }
    this.audio.onpause = () => { this.finishPlayback(generation, messageId, false) }
    this.audio.ontimeupdate = () => {
      if (!this.owns(generation, messageId)) return
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : state.duration
      this.patch(messageId, { progress: Math.max(0, this.audio.currentTime), duration: Math.max(0, duration) })
    }
    this.patch(messageId, { phase: 'playing', ended: false })
    try {
      await this.audio.play()
      if (!this.owns(generation, messageId)) return
      this.startAnalysis(messageId, generation)
    } catch {
      if (!this.owns(generation, messageId)) return
      this.patch(messageId, { phase: 'ready' })
      this.clearAudioOwnership(false)
    }
  }

  pause(messageId: string): void {
    if (this.activeMessageId !== messageId) return
    this.patch(messageId, { phase: 'ready', progress: Math.max(0, this.audio.currentTime), ended: false })
    ++this.playbackGeneration
    this.audio.pause()
    this.clearAudioOwnership(false)
  }

  retry(source: SpokenMessageSource, settings: SpokenPreparationSettings): void {
    const state = this.ensure(source.messageId)
    if (this.loadedMessageId === source.messageId) this.clearAudioOwnership(true)
    state.abort?.abort()
    state.requestGeneration += 1
    revokeAudioUrl(state.audioUrl)
    Object.assign(state, { phase: 'idle', audioUrl: undefined, summary: undefined, error: undefined, progress: 0, duration: 0, peaks: EMPTY_PEAKS, ended: false })
    this.publish()
    void this.prepare(source, settings, false).then(() => this.play(source.messageId, true))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopActive()
    this.clearAudioOwnership(true)
    for (const state of this.states.values()) {
      state.abort?.abort()
      revokeAudioUrl(state.audioUrl)
    }
    this.states.clear()
    this.observed.clear()
    this.observedInteractions.clear()
    this.voiceCache.clear()
    void this.analyserContext?.close().catch(() => {})
    this.analyserContext = undefined
    this.analyserSource = undefined
    this.analyser = undefined
    this.analyserData = undefined
    this.listeners.clear()
  }

  private async voiceFor(binding: TtsCatalogBinding, preferred?: string): Promise<string | undefined> {
    if (preferred !== undefined && preferred.length > 0) return preferred
    const key = `${binding.provider}\n${binding.model}`
    let promise = this.voiceCache.get(key)
    if (promise === undefined) {
      promise = speechApi.voices({ model: binding.aliases?.[0] ?? binding.model, provider: binding.provider })
        .then(result => result.voices.map(voice => voice.id))
        .catch(error => {
          this.voiceCache.delete(key)
          throw error
        })
      this.voiceCache.set(key, promise)
    }
    const voices = await promise
    const localized = preferredTtsSelection(binding.model.startsWith('minimax/') ? 'zh' : 'en')
    return binding.model === localized.model && binding.provider === localized.provider && voices.includes(localized.voice) ? localized.voice
      : binding.defaultVoice !== undefined ? binding.defaultVoice
        : voices[0]
  }

  private startAnalysis(messageId: string, generation: number): void {
    this.stopAnalysis()
    this.ensureAnalyser()
    if (typeof requestAnimationFrame === 'undefined') return
    const frame = (time: number): void => {
      if (!this.owns(generation, messageId)) return
      if (time - this.analysisTick >= 45) {
        this.analysisTick = time
        this.patch(messageId, { peaks: this.readAmplitude(time) })
      }
      this.analysisFrame = requestAnimationFrame(frame)
    }
    this.analysisFrame = requestAnimationFrame(frame)
  }

  private ensureAnalyser(): void {
    if (this.analyser !== undefined) {
      void this.analyserContext?.resume().catch(() => {})
      return
    }
    if (typeof AudioContext === 'undefined' || this.audio.captureStream === undefined) return
    try {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.62
      const source = context.createMediaStreamSource(this.audio.captureStream())
      source.connect(analyser)
      this.analyserContext = context
      this.analyserSource = source
      this.analyser = analyser
      this.analyserData = new Uint8Array(analyser.fftSize)
      void context.resume().catch(() => {})
    } catch {
      this.analyserContext = undefined
      this.analyserSource = undefined
      this.analyser = undefined
      this.analyserData = undefined
    }
  }

  private readAmplitude(time: number): readonly number[] {
    if (this.analyser !== undefined && this.analyserData !== undefined) {
      this.analyser.getByteTimeDomainData(this.analyserData)
      return Array.from({ length: 48 }, (_, index) => {
        const start = Math.floor(index * this.analyserData!.length / 48)
        const end = Math.max(start + 1, Math.floor((index + 1) * this.analyserData!.length / 48))
        let amplitude = 0
        for (let sample = start; sample < end; sample += 1) {
          amplitude = Math.max(amplitude, Math.abs((this.analyserData![sample] ?? 128) - 128) / 128)
        }
        return Math.min(1, 0.06 + Math.sqrt(amplitude) * 2.4)
      })
    }
    return Array.from({ length: 48 }, (_, index) => {
      const carrier = 0.5 + 0.5 * Math.sin(time * 0.014 + index * 1.37)
      const envelope = 0.5 + 0.5 * Math.sin(time * 0.0037 + index * 0.29)
      return 0.1 + 0.52 * carrier * envelope
    })
  }

  private stopAnalysis(): void {
    if (this.analysisFrame !== undefined && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.analysisFrame)
    this.analysisFrame = undefined
    this.analysisTick = 0
  }

  private ensure(messageId: string): MutableMessage {
    let state = this.states.get(messageId)
    if (state === undefined) {
      state = { phase: 'idle', duration: 0, progress: 0, peaks: EMPTY_PEAKS, requestGeneration: 0, mounts: 0, releaseGeneration: 0 }
      this.states.set(messageId, state)
    }
    return state
  }

  private patch(messageId: string, patch: Partial<SpokenMessageState>): void {
    Object.assign(this.ensure(messageId), patch)
    this.publish()
  }

  private fail(messageId: string, message: string): void {
    this.patch(messageId, { phase: 'error', error: message })
  }

  private owns(generation: number, messageId: string): boolean {
    return this.playbackGeneration === generation && this.activeMessageId === messageId
  }

  private finishPlayback(generation: number, messageId: string, ended: boolean): void {
    if (!this.owns(generation, messageId)) return
    const state = this.states.get(messageId)
    const measuredDuration = Number.isFinite(this.audio.duration) ? Math.max(0, this.audio.duration) : state?.duration ?? 0
    if (state !== undefined) Object.assign(state, {
      phase: 'ready',
      duration: measuredDuration,
      progress: ended ? measuredDuration : this.audio.currentTime,
      ended,
    })
    ++this.playbackGeneration
    if (state?.ephemeral === true) {
      this.clearAudioOwnership(true)
      revokeAudioUrl(state.audioUrl)
      this.states.delete(messageId)
    } else {
      this.clearAudioOwnership(false)
    }
    this.publish()
  }

  private stopActive(): void {
    const messageId = this.activeMessageId
    if (messageId === undefined) return
    const state = this.states.get(messageId)
    if (state !== undefined && state.phase === 'playing') Object.assign(state, { phase: 'ready', progress: Math.max(0, this.audio.currentTime), ended: false })
    ++this.playbackGeneration
    this.audio.pause()
    this.clearAudioOwnership(false)
    this.publish()
  }

  private clearAudioOwnership(unload: boolean): void {
    this.stopAnalysis()
    this.activeMessageId = undefined
    this.audio.onended = null
    this.audio.onerror = null
    this.audio.onpause = null
    this.audio.ontimeupdate = null
    if (unload) {
      this.loadedMessageId = undefined
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    this.publish()
  }

  private release(messageId: string): void {
    const state = this.states.get(messageId)
    if (state === undefined) return
    if (this.activeMessageId === messageId) this.stopActive()
    if (this.loadedMessageId === messageId) this.clearAudioOwnership(true)
    state.abort?.abort()
    state.requestGeneration += 1
    revokeAudioUrl(state.audioUrl)
    this.states.delete(messageId)
    this.publish()
  }

  private publish(): void {
    this.snapshot = {
      messages: new Map([...this.states].map(([id, state]) => [id, {
        phase: state.phase,
        ...(state.summary === undefined ? {} : { summary: state.summary }),
        ...(state.audioUrl === undefined ? {} : { audioUrl: state.audioUrl }),
        duration: state.duration,
        progress: state.progress,
        peaks: state.peaks,
        ...(state.error === undefined ? {} : { error: state.error }),
        ...(state.ended === undefined ? {} : { ended: state.ended }),
      }])),
      ...(this.activeMessageId === undefined ? {} : { activeMessageId: this.activeMessageId }),
    }
    for (const listener of this.listeners) listener()
  }
}
