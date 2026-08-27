export const PLUGIN_NAME = '@allmodels/dsh-speech'
export const SETTINGS_NAMESPACE = 'dsh-speech'
export const DEFAULT_API_KEY_ENV = 'ALLMODELS_API_KEY'
export const DEFAULT_BASE_URL = 'https://api.allmodels.io'
export const DEFAULT_LOW_BALANCE_USD = 0.5
export const DEFAULT_TOP_UP_USD = 10
export const CATALOG_TTL_MS = 5 * 60 * 1_000
export const AUDIO_FORMAT = 'pcm_16000' as const
export const MAX_TTS_CHARACTERS = 4_096
export const MAX_SUMMARY_REQUEST_CHARACTERS = 16_000
export const MAX_SUMMARY_ANSWER_CHARACTERS = 64_000
export const DEFAULT_ENGLISH_TTS = {
  model: 'fish/s2.1-pro',
  provider: 'fish',
  voice: '03397b4c4be74759b72533b663fbd001',
  name: 'Elon Musk (Noise reduction)',
} as const
export const DEFAULT_CHINESE_TTS = {
  model: 'minimax/speech-2.8-hd',
  provider: 'minimax',
  voice: 'Chinese (Mandarin)_HK_Flight_Attendant',
  name: 'HK Flight Attendant',
} as const

export interface SpeechSettings {
  apiKeyEnv: string
  baseURL: string
  lowBalanceUsd: number
  defaultTopUpUsd: number
  model?: string
  provider?: string
  language?: string
  context?: string
  ttsModel?: string
  ttsProvider?: string
  ttsVoice?: string
  autoPlay?: boolean
}

export type SpeechUserSettings = Pick<SpeechSettings,
  'model' | 'provider' | 'language' | 'context' | 'ttsModel' | 'ttsProvider' | 'ttsVoice' | 'autoPlay'>

export interface CatalogBinding {
  provider: string
  model: string
  canonical: string
  isProviderDefault: boolean
  contextSupported: boolean
  interimResultsSupported: boolean
  languages?: readonly string[]
  pricePerMinuteUsd?: number
}

export interface CatalogResponse {
  bindings: CatalogBinding[]
  ttsBindings?: TtsCatalogBinding[]
  fetchedAt: number
}

export interface TtsCatalogBinding {
  provider: string
  model: string
  canonical: string
  isProviderDefault: boolean
  defaultVoice?: string
  formats: readonly string[]
  streaming?: boolean
  aliases?: readonly string[]
}

export interface VoiceOption {
  id: string
  name: string
  description?: string
  previewUrl?: string
  model?: string
  provider?: string
  providerName?: string
  languages?: readonly string[]
}

export interface VoiceCatalogResponse {
  voices: VoiceOption[]
  fetchedAt: number
}

export function normalizeVoices(raw: unknown, fetchedAt = Date.now()): VoiceCatalogResponse {
  const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const candidates = Array.isArray(raw) ? raw : Array.isArray(record.voices) ? record.voices : Array.isArray(record.data) ? record.data : []
  const voices: VoiceOption[] = []
  const seen = new Set<string>()
  for (const value of candidates) {
    if (value === null || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const voice = entry.voice !== null && typeof entry.voice === 'object'
      ? entry.voice as Record<string, unknown>
      : entry
    const id = voice.id ?? voice.voice_id ?? voice.voice
    if (typeof id !== 'string' || id.length === 0 || id.length > 256) continue
    const modelRecord = entry.model !== null && typeof entry.model === 'object'
      ? entry.model as Record<string, unknown>
      : undefined
    const providers = Array.isArray(entry.providers) ? entry.providers : []
    const providerRecord = providers.find(candidate => candidate !== null && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).default === true) as Record<string, unknown> | undefined
      ?? providers.find(candidate => candidate !== null && typeof candidate === 'object') as Record<string, unknown> | undefined
    const provider = typeof providerRecord?.id === 'string' ? providerRecord.id : undefined
    const providerModel = typeof providerRecord?.provider_model_id === 'string' ? providerRecord.provider_model_id : undefined
    const advertisedModel = typeof modelRecord?.id === 'string' ? modelRecord.id : undefined
    const model = provider !== undefined && providerModel !== undefined ? `${provider}/${providerModel}` : advertisedModel
    const identity = `${id}\n${model ?? ''}\n${provider ?? ''}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const name = typeof voice.name === 'string' && voice.name.length > 0 ? voice.name : id
    const description = voice.description
    const previewUrl = voice.preview_url ?? voice.previewUrl
    const languages = Array.isArray(voice.languages)
      ? voice.languages.flatMap(language => {
          if (typeof language === 'string') return [language]
          if (language === null || typeof language !== 'object') return []
          const languageRecord = language as Record<string, unknown>
          return typeof languageRecord.id === 'string' ? [languageRecord.id]
            : typeof languageRecord.locale === 'string' ? [languageRecord.locale] : []
        })
      : []
    voices.push({
      id,
      name,
      ...(typeof description === 'string' && description.length <= 1_000 ? { description } : {}),
      ...(typeof previewUrl === 'string' && /^https:\/\//u.test(previewUrl) ? { previewUrl } : {}),
      ...(model === undefined ? {} : { model }),
      ...(provider === undefined ? {} : { provider }),
      ...(typeof providerRecord?.name === 'string' ? { providerName: providerRecord.name } : {}),
      ...(languages.length === 0 ? {} : { languages }),
    })
  }
  return { voices, fetchedAt }
}

export interface LlmRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface SummarizeRequest {
  request: string
  answer: string
  locale: string
  route: LlmRoute
}

export interface TtsRequest {
  text: string
  model: string
  provider: string
  voice: string
}

export interface BalanceGrant {
  remainingUsd: number
  eligible: boolean
  expiresAt?: string
  targets?: unknown
}

export interface BalanceSummary {
  state?: string
  paidUsd: number
  promotionUsd: number
  usableUsd: number
  low: boolean
  exhausted: boolean
  fetchedAt: number
}

export interface CredentialStatus {
  configured: boolean
  source?: string
  writable: boolean
}

export interface StatusResponse {
  credential: CredentialStatus
  settings: Pick<SpeechSettings,
    'model' | 'provider' | 'language' | 'context' | 'ttsModel' | 'ttsProvider' | 'ttsVoice' | 'autoPlay'
    | 'lowBalanceUsd' | 'defaultTopUpUsd'>
  balance?: BalanceSummary
  balanceError?: string
}

interface RawStreamingInput {
  audioFormats?: unknown
  portableOptions?: unknown
}

interface RawSttModel {
  id?: unknown
  canonical?: unknown
  streaming?: unknown
  streamingInput?: RawStreamingInput
  languages?: unknown
  pricing?: { unit?: unknown; unitPrice?: unknown }
}

interface RawTtsModel {
  id?: unknown
  canonical?: unknown
  synchronous?: unknown
  formats?: unknown
  streaming?: unknown
  aliases?: unknown
}

interface RawProvider {
  defaults?: {
    stt?: { model?: unknown }
    tts?: { model?: unknown; voice?: unknown }
  }
  stt?: unknown
  tts?: unknown
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Normalize only bindings this client can feed with its fixed PCM16/16 kHz pipeline. */
export function normalizeCatalog(raw: unknown, fetchedAt = Date.now()): CatalogResponse {
  const root = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const providersValue = root.providers
  const providers = providersValue !== null && typeof providersValue === 'object'
    ? providersValue as Record<string, RawProvider>
    : {}
  const bindings: CatalogBinding[] = []
  const ttsBindings: TtsCatalogBinding[] = []
  for (const [provider, value] of Object.entries(providers)) {
    if (Array.isArray(value.stt)) {
      const defaultModel = typeof value.defaults?.stt?.model === 'string' ? value.defaults.stt.model : undefined
      for (const candidate of value.stt as RawSttModel[]) {
        if (candidate.streaming !== true || candidate.streamingInput === undefined) continue
        const formats = stringArray(candidate.streamingInput.audioFormats)
        if (!formats.includes(AUDIO_FORMAT)) continue
        if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue
        const options = stringArray(candidate.streamingInput.portableOptions)
        const price = candidate.pricing?.unit === 'minute' ? finiteNumber(candidate.pricing.unitPrice) : undefined
        const canonical = typeof candidate.canonical === 'string' && candidate.canonical.includes('/')
          ? candidate.canonical
          : `${provider}/${candidate.id}`
        bindings.push({
          provider,
          model: canonical,
          canonical,
          isProviderDefault: candidate.id === defaultModel || canonical === defaultModel,
          contextSupported: options.includes('context'),
          interimResultsSupported: options.includes('interim_results'),
          ...(stringArray(candidate.languages).length === 0 ? {} : { languages: stringArray(candidate.languages) }),
          ...(price === undefined ? {} : { pricePerMinuteUsd: price }),
        })
      }
    }
    if (Array.isArray(value.tts)) {
      const defaultModel = typeof value.defaults?.tts?.model === 'string' ? value.defaults.tts.model : undefined
      const defaultVoice = typeof value.defaults?.tts?.voice === 'string' ? value.defaults.tts.voice : undefined
      for (const candidate of value.tts as RawTtsModel[]) {
        if (candidate.synchronous !== true || typeof candidate.id !== 'string' || candidate.id.length === 0) continue
        const formats = stringArray(candidate.formats)
        if (formats.length > 0 && !formats.some(format => format.toLowerCase() === 'mp3')) continue
        const canonical = typeof candidate.canonical === 'string' && candidate.canonical.includes('/')
          ? candidate.canonical
          : `${provider}/${candidate.id}`
        ttsBindings.push({
          provider,
          model: canonical,
          canonical,
          isProviderDefault: candidate.id === defaultModel || canonical === defaultModel,
          ...(defaultVoice === undefined ? {} : { defaultVoice }),
          formats: formats.length === 0 ? ['mp3'] : formats,
          ...(candidate.streaming === true ? { streaming: true } : {}),
          ...(stringArray(candidate.aliases).length === 0 ? {} : { aliases: stringArray(candidate.aliases) }),
        })
      }
    }
  }
  bindings.sort((a, b) => a.model.localeCompare(b.model) || a.provider.localeCompare(b.provider))
  ttsBindings.sort((a, b) => a.model.localeCompare(b.model) || a.provider.localeCompare(b.provider))
  return { bindings, ttsBindings, fetchedAt }
}

export function selectTtsBinding(
  bindings: readonly TtsCatalogBinding[],
  preferred?: { model?: string; provider?: string },
): TtsCatalogBinding | undefined {
  if (preferred?.model !== undefined) {
    const preferredModel = preferred.model
    const matchesModel = (binding: TtsCatalogBinding): boolean => binding.model === preferredModel
      || binding.canonical === preferredModel
      || (!preferredModel.includes('/') && binding.model.endsWith(`/${preferredModel}`))
    const exact = bindings.find(binding => matchesModel(binding)
      && (preferred.provider === undefined || binding.provider === preferred.provider))
    if (exact !== undefined) return exact
    const sameModel = bindings.find(matchesModel)
    if (sameModel !== undefined) return sameModel
  }
  return bindings.find(binding => binding.isProviderDefault) ?? bindings[0]
}

export function preferredTtsSelection(locale: string): typeof DEFAULT_ENGLISH_TTS | typeof DEFAULT_CHINESE_TTS {
  return locale.toLowerCase().startsWith('zh') ? DEFAULT_CHINESE_TTS : DEFAULT_ENGLISH_TTS
}

export function selectLocalizedTtsBinding(
  bindings: readonly TtsCatalogBinding[],
  locale: string,
  preferred?: { model?: string; provider?: string },
): TtsCatalogBinding | undefined {
  if (preferred?.model !== undefined || preferred?.provider !== undefined) return selectTtsBinding(bindings, preferred)
  const localized = preferredTtsSelection(locale)
  return selectTtsBinding(bindings, { model: localized.model, provider: localized.provider })
}

export function selectBinding(
  bindings: readonly CatalogBinding[],
  locale: string,
  preferred?: { model?: string; provider?: string },
): CatalogBinding | undefined {
  if (preferred?.model !== undefined) {
    const preferredModel = preferred.model
    const matchesModel = (binding: CatalogBinding): boolean => binding.model === preferredModel
      || binding.canonical === preferredModel
      || (!preferredModel.includes('/') && binding.model.endsWith(`/${preferredModel}`))
    const exact = bindings.find(binding => matchesModel(binding)
      && (preferred.provider === undefined || binding.provider === preferred.provider))
    if (exact !== undefined) return exact
    const sameModel = bindings.find(matchesModel)
    if (sameModel !== undefined) return sameModel
  }
  const preferredProvider = locale.toLowerCase().startsWith('zh') ? 'soniox' : 'assemblyai'
  return bindings.find(binding => binding.provider === preferredProvider && binding.isProviderDefault)
    ?? bindings.find(binding => binding.provider === preferredProvider)
    ?? bindings[0]
}

function targetAllows(targets: unknown, provider?: string, model?: string): boolean {
  const providerModel = model === undefined || model.includes('/') ? model : `${provider}/${model}`
  if (targets === undefined || targets === null) return true
  if (Array.isArray(targets)) {
    if (targets.length === 0) return true
    return targets.some(target => targetAllows(target, provider, model))
  }
  if (typeof targets === 'string') {
    return targets === '*' || targets === provider || targets === model || targets === providerModel
  }
  if (typeof targets !== 'object') return false
  const record = targets as Record<string, unknown>
  const providers = stringArray(record.providers ?? record.provider)
  const models = stringArray(record.models ?? record.model)
  const providerOk = providers.length === 0 || provider === undefined || providers.includes(provider)
  const modelOk = models.length === 0 || model === undefined
    || models.includes(model) || (providerModel !== undefined && models.includes(providerModel))
  return providerOk && modelOk
}

export function summarizeBalance(
  raw: unknown,
  lowThresholdUsd: number,
  selected?: { provider?: string; model?: string },
  now = Date.now(),
): BalanceSummary {
  const value = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const paidUsd = finiteNumber(value.paid_balance_usd ?? value.spendable_paid_credits_usd) ?? 0
  const grantsValue = value.promotion_grants ?? value.promotional_grants ?? []
  const grants = Array.isArray(grantsValue) ? grantsValue : []
  let promotionUsd = 0
  for (const entry of grants) {
    if (entry === null || typeof entry !== 'object') continue
    const grant = entry as Record<string, unknown>
    const remaining = finiteNumber(grant.remaining_usd) ?? 0
    const eligible = grant.eligible !== false
    const expiresAt = typeof grant.expires_at === 'string' ? Date.parse(grant.expires_at) : Number.POSITIVE_INFINITY
    if (eligible && expiresAt > now && targetAllows(grant.targets, selected?.provider, selected?.model)) {
      promotionUsd += Math.max(0, remaining)
    }
  }
  const usableUsd = Math.round((Math.max(0, paidUsd) + promotionUsd) * 1_000_000_000) / 1_000_000_000
  return {
    ...(typeof value.state === 'string' ? { state: value.state } : {}),
    paidUsd: Math.max(0, paidUsd),
    promotionUsd,
    usableUsd,
    low: usableUsd < lowThresholdUsd,
    exhausted: usableUsd <= 0,
    fetchedAt: now,
  }
}

const CJK = /^(zh|ja|ko)(-|$)/i

export function transcriptSeparator(left: string, right: string, language?: string): string {
  if (left.length === 0 || right.length === 0) return ''
  if (language !== undefined && CJK.test(language)) return ''
  if (/\s$/u.test(left) || /^\s/u.test(right)) return ''
  if (/^[,.;:!?\u3000-\u303f\uff00-\uff65]/u.test(right)) return ''
  return ' '
}

export function appendTranscript(left: string, right: string, language?: string): string {
  return `${left}${transcriptSeparator(left, right, language)}${right}`
}

export interface TranscriptAccumulator {
  base: string
  finals: string
  partial: string
  language?: string
  lastSequence: number
}

export function createTranscript(base: string): TranscriptAccumulator {
  return { base, finals: '', partial: '', lastSequence: -1 }
}

export function transcriptText(state: TranscriptAccumulator): string {
  return appendTranscript(appendTranscript(state.base, state.finals, state.language), state.partial, state.language)
}

export function applyTranscriptEvent(
  state: TranscriptAccumulator,
  event: { kind: 'partial' | 'final'; sequence: number; text: string; languageCode?: string },
): TranscriptAccumulator {
  if (event.sequence <= state.lastSequence) return state
  const language = event.languageCode ?? state.language
  if (event.kind === 'partial') {
    return { ...state, partial: event.text, ...(language === undefined ? {} : { language }), lastSequence: event.sequence }
  }
  return {
    ...state,
    finals: appendTranscript(state.finals, event.text, language),
    partial: '',
    ...(language === undefined ? {} : { language }),
    lastSequence: event.sequence,
  }
}
