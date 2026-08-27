import { useEffect, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { RequestView, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { preferredTtsSelection } from '../shared.ts'
import type { SpeechUserSettings } from '../shared.ts'
import type { SpeechController } from './controller.ts'
import type { SpokenSummaryController } from './spoken-controller.ts'
import { spokenSources, type SpokenMessageSource, type SpokenPreparationSettings } from './spoken-controller.ts'
import { styles } from './styles.ts'

export interface SpokenInjected {
  controller: SpeechController
  spoken: SpokenSummaryController
  scope: SettingsScope<SpeechUserSettings>
  getLocale: () => string
}

type TailProps = PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'speech'> & InjectFace<SpokenInjected>
type ObserverProps = PropsRuntime<'conversation.composer.dock'> & InjectFace<SpokenInjected>

const EMPTY_REQUESTS: readonly RequestView[] = []

function preparationSettings(controller: SpeechController, settings: SpeechUserSettings | undefined, locale: string): SpokenPreparationSettings {
  const fallback = preferredTtsSelection(locale)
  const selection = settings?.ttsModel !== undefined && settings.ttsProvider !== undefined && settings.ttsVoice !== undefined
    ? { model: settings.ttsModel, provider: settings.ttsProvider, voice: settings.ttsVoice }
    : fallback
  return {
    autoPlay: settings?.autoPlay ?? true,
    bindings: controller.getSnapshot().catalog?.ttsBindings ?? [],
    ttsModel: selection.model,
    ttsProvider: selection.provider,
    ttsVoice: selection.voice,
  }
}

function PlayIcon({ pause = false }: { pause?: boolean }): ReactNode {
  return pause ? (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h3v10H6zM11 5h3v10h-3z" /></svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6z" /></svg>
  )
}

function Waveform({ peaks, preparing, playing }: { peaks: readonly number[]; preparing: boolean; playing: boolean }): ReactNode {
  return (
    <span
      className={styles.summaryWaveform}
      aria-hidden="true"
      data-preparing={preparing ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
    >
      {peaks.map((peak, index) => (
        <i
          key={index}
          style={{ '--dsh-speech-peak': String(peak) } as CSSProperties}
        />
      ))}
    </span>
  )
}

export function SpokenSummaryTail({ controller, spoken, scope, getLocale, seq, useSession, t }: TailProps): ReactNode {
  const nodes = useSession(snapshot => snapshot.nodes)
  const requests = useSession(snapshot => {
    const views = snapshot.views as unknown as { get?: (target: string) => unknown } | undefined
    if (views?.get === undefined) return EMPTY_REQUESTS
    const trajectory = views.get('trajectory') as { requests?: readonly RequestView[] } | undefined
    return trajectory?.requests ?? EMPTY_REQUESTS
  })
  const client = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const scopeState = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot())
  const spokenState = useSyncExternalStore(spoken.subscribe, spoken.getSnapshot)
  const locale = getLocale()
  const sources = useMemo(() => spokenSources(nodes, locale, requests), [nodes, locale, requests])
  const closing = nodes.find(node => node.kind === 'assistant' && node.seq === seq)
  const id = closing?.kind === 'assistant' && closing.messageId !== undefined ? String(closing.messageId) : `turn-tail:${String(seq)}`
  const source = sources.find(candidate => candidate.messageId === id)
  const settings = useMemo(
    () => preparationSettings(controller, scopeState.value, locale),
    [controller, scopeState.value, client.catalog, locale],
  )
  const state = spokenState.messages.get(id) ?? { phase: 'idle' as const, duration: 0, progress: 0, peaks: [] }
  const latestAudioMessageId = [...sources].reverse().find(candidate => spokenState.messages.get(candidate.messageId)?.audioUrl !== undefined)?.messageId

  useEffect(() => spoken.mount(id), [spoken, id])
  if (source === undefined) return null
  const preparing = state.phase === 'preparing'
  const unavailable = source.route === undefined || (client.catalog !== undefined && settings.bindings.length === 0)
  const replay = state.phase === 'ready' && state.ended === true
  const paused = state.phase === 'ready' && state.progress > 0 && !replay
  const label = unavailable ? t('summaryUnavailable')
    : state.phase === 'playing' ? t('summaryPause')
    : preparing ? t('summaryPreparing')
      : state.phase === 'error' ? t('summaryRetry')
        : replay ? t('summaryReplay')
          : paused ? t('summaryResume')
            : state.audioUrl === undefined ? t('summaryGenerate') : t('summaryPlay')

  const activate = (): void => {
    if (unavailable) return
    if (state.phase === 'playing') {
      spoken.pause(id)
      return
    }
    if (state.phase === 'ready') {
      void spoken.play(id, true)
      return
    }
    if (state.phase === 'error') {
      spoken.retry(source, settings)
      return
    }
    void spoken.prepare(source, settings, false).then(() => spoken.play(id, true))
  }

  const showLabel = state.phase === 'idle' || state.phase === 'error' || unavailable

  return (
    <div className={styles.summaryPlayer} data-phase={state.phase}>
      <div className={styles.summaryControl}>
        <button
          type="button"
          className={styles.summaryButton}
          disabled={preparing || unavailable}
          aria-label={label}
          title={label}
          onClick={activate}
        >
          <PlayIcon pause={state.phase === 'playing'} />
        </button>
        <Waveform
          peaks={state.peaks.length === 48 ? state.peaks : Array.from({ length: 48 }, () => 0.12)}
          preparing={preparing}
          playing={state.phase === 'playing'}
        />
      </div>
      {showLabel ? <span className={styles.summaryLabel}>{label}</span> : null}
      {state.audioUrl === undefined || latestAudioMessageId !== id ? null : (
        <button
          type="button"
          className={styles.autoplayToggle}
          role="switch"
          aria-checked={scopeState.value?.autoPlay ?? true}
          aria-label={`${t('autoplayInline')}: ${(scopeState.value?.autoPlay ?? true) ? t('autoplayOn') : t('autoplayOff')}`}
          title={`${t('autoplayInline')}: ${(scopeState.value?.autoPlay ?? true) ? t('autoplayOn') : t('autoplayOff')}`}
          disabled={!scopeState.writable}
          onClick={() => { void scope.set('autoPlay', !(scopeState.value?.autoPlay ?? true)) }}
        >
          <span className={styles.switchTrack} aria-hidden="true"><i /></span>
          <span>{t('autoplayInline')}</span>
        </button>
      )}
      <span className={styles.srOnly} role="status" aria-live="polite">
        {state.phase === 'error' ? state.error ?? t('summaryError') : label}
      </span>
    </div>
  )
}

export function SpokenSessionObserver({ controller, spoken, scope, getLocale, sessionId, useSession }: ObserverProps): ReactNode {
  const state = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot())
  const client = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const pending = useSession(snapshot => snapshot.pending)
  const nodes = useSession(snapshot => snapshot.nodes)
  const requests = useSession(snapshot => {
    const views = snapshot.views as unknown as { get?: (target: string) => unknown } | undefined
    if (views?.get === undefined) return EMPTY_REQUESTS
    const trajectory = views.get('trajectory') as { requests?: readonly RequestView[] } | undefined
    return trajectory?.requests ?? EMPTY_REQUESTS
  })
  const speechLocale = state.value?.language === undefined || state.value.language === 'auto' ? getLocale() : state.value.language
  const settings = useMemo(() => preparationSettings(controller, state.value, speechLocale), [client.catalog, controller, speechLocale, state.value])
  const sources = useMemo(() => spokenSources(nodes, speechLocale, requests), [nodes, requests, speechLocale])
  useEffect(() => { void controller.ensureMetadata() }, [controller])
  useEffect(() => {
    if (client.catalog === undefined) return
    spoken.observeSession(String(sessionId), sources, settings)
  }, [client.catalog, sessionId, settings, sources, spoken])
  useEffect(() => {
    if (client.catalog === undefined) return
    spoken.observeInteractions(String(sessionId), pending.map(item => item.key), speechLocale, settings)
  }, [client.catalog, pending, sessionId, settings, speechLocale, spoken])
  return null
}
