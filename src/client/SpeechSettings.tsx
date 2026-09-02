import { useEffect, useId, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpeechUserSettings, VoiceOption } from '../shared.ts'
import { preferredTtsSelection, selectBinding, selectLocalizedTtsBinding } from '../shared.ts'
import { speechApi } from './api.ts'
import type { SpeechController } from './controller.ts'
import type { SpeechLocaleKey } from './locales.ts'
import { styles } from './styles.ts'
import type { SummaryCache } from './summary-cache.ts'

export interface SpeechSettingsInjected {
  controller: SpeechController
  scope: SettingsScope<SpeechUserSettings>
  getLocale: () => string
  summaryCache: SummaryCache
}

export type SpeechSettingsProps = PropsRuntime<'settings.section'>
  & PropsLocale<'speech'>
  & InjectFace<SpeechSettingsInjected>

const LANGUAGES = [
  ['auto', 'Auto'], ['en', 'English'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'],
  ['ru', 'Русский'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'],
] as const

function money(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactNode {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint === undefined ? null : <span className={styles.hint}>{hint}</span>}
    </label>
  )
}

function voiceKey(voice: VoiceOption): string {
  return `${voice.provider ?? ''}\n${voice.model ?? ''}\n${voice.id}`
}

function useVoiceOptions(
  filters: { model?: string; provider?: string },
  query: string,
  enabled = true,
): { voices: VoiceOption[]; loading: boolean } {
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setVoices([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      void speechApi.voices({
        ...(filters.model === undefined ? {} : { model: filters.model }),
        ...(filters.provider === undefined ? {} : { provider: filters.provider }),
        ...(query.trim().length === 0 ? {} : { q: query.trim() }),
      }, controller.signal)
        .then(result => { setVoices(result.voices.filter(voice => voice.model !== undefined && voice.provider !== undefined)) })
        .catch(cause => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setVoices([]) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [enabled, filters.model, filters.provider, query])

  return { voices, loading }
}

function VoicePicker({
  label, hint, placeholder, loadingLabel, emptyLabel, query, voices, selected, loading, disabled, onQuery, onSelect,
}: {
  label: string
  hint: string | undefined
  placeholder: string
  loadingLabel: string
  emptyLabel: string
  query: string
  voices: VoiceOption[]
  selected: VoiceOption | undefined
  loading: boolean
  disabled: boolean
  onQuery: (value: string) => void
  onSelect: (voice: VoiceOption) => void
}): ReactNode {
  const inputId = useId()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const displayed = voices.slice(0, 24)

  useEffect(() => { setActive(0) }, [voices])

  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive(current => Math.min(displayed.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive(current => Math.max(0, current - 1))
    } else if (event.key === 'Enter' && open && displayed[active] !== undefined) {
      event.preventDefault()
      onSelect(displayed[active]!)
      setOpen(false)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.voicePicker} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      {selected === undefined ? null : (
        <div className={styles.voiceSelected}>
          <strong>{selected.name}</strong>
          <span>{selected.providerName ?? selected.provider} · {selected.model}</span>
        </div>
      )}
      <input
        id={inputId}
        className={styles.input}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && displayed[active] !== undefined ? `${listId}-${String(active)}` : undefined}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => { setOpen(true) }}
        onChange={event => { onQuery(event.target.value); setOpen(true) }}
        onKeyDown={keyDown}
      />
      {hint === undefined ? null : <span className={styles.hint}>{hint}</span>}
      {!open ? null : (
        <div id={listId} className={styles.voiceMenu} role="listbox">
          {loading ? <div className={styles.voiceNotice} role="status">{loadingLabel}</div>
            : displayed.length === 0 ? <div className={styles.voiceNotice}>{emptyLabel}</div>
              : displayed.map((voice, index) => (
                <button
                  id={`${listId}-${String(index)}`}
                  key={voiceKey(voice)}
                  className={styles.voiceOption}
                  type="button"
                  role="option"
                  aria-selected={selected !== undefined && voiceKey(voice) === voiceKey(selected)}
                  data-active={index === active}
                  onMouseDown={event => { event.preventDefault() }}
                  onMouseEnter={() => { setActive(index) }}
                  onClick={() => { onSelect(voice); setOpen(false) }}
                >
                  <span><strong>{voice.name}</strong><small>{voice.providerName ?? voice.provider} · {voice.model}</small></span>
                  {voice.description === undefined ? null : <small>{voice.description}</small>}
                </button>
              ))}
        </div>
      )}
    </div>
  )
}

function ModelPicker({
  label, placeholder, emptyLabel, options, value, disabled, onSelect,
}: {
  label: string
  placeholder: string
  emptyLabel: string
  options: string[]
  value: string
  disabled: boolean
  onSelect: (model: string) => void
}): ReactNode {
  const inputId = useId()
  const listId = useId()
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const displayed = normalizedQuery.length === 0 || query === value
    ? options
    : options.filter(option => option.toLocaleLowerCase().includes(normalizedQuery))

  useEffect(() => { setQuery(value) }, [value])
  useEffect(() => { setActive(-1) }, [query, options])

  const select = (model: string): void => {
    setQuery(model)
    setOpen(false)
    setActive(-1)
    onSelect(model)
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive(current => Math.min(displayed.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive(current => current < 0 ? displayed.length - 1 : Math.max(0, current - 1))
    } else if (event.key === 'Enter' && open && displayed[active] !== undefined) {
      event.preventDefault()
      select(displayed[active]!)
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      setQuery(value)
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className={styles.voicePicker} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setQuery(value)
        setOpen(false)
        setActive(-1)
      }
    }}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={styles.input}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && displayed[active] !== undefined ? `${listId}-${String(active)}` : undefined}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => { setOpen(true) }}
        onChange={event => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={keyDown}
      />
      {!open ? null : (
        <div id={listId} className={styles.voiceMenu} role="listbox">
          {displayed.length === 0 ? <div className={styles.voiceNotice}>{emptyLabel}</div>
            : displayed.map((model, index) => (
              <button
                id={`${listId}-${String(index)}`}
                key={model}
                className={styles.voiceOption}
                type="button"
                role="option"
                aria-selected={model === value}
                data-active={index === active}
                onMouseDown={event => { event.preventDefault() }}
                onMouseEnter={() => { setActive(index) }}
                onClick={() => { select(model) }}
              >
                <span><strong>{model}</strong></span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

export function SpeechSettings({ controller, scope, getLocale, summaryCache, t }: SpeechSettingsProps): ReactNode {
  const client = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const settings = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = settings.value
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [codeExpiry, setCodeExpiry] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topUpAmount, setTopUpAmount] = useState(10)
  const [topUpUrl, setTopUpUrl] = useState<string | null>(null)
  const [languageDraft, setLanguageDraft] = useState('auto')
  const [contextDraft, setContextDraft] = useState('')
  const [voiceSearch, setVoiceSearch] = useState('')
  const [modelVoiceSearch, setModelVoiceSearch] = useState('')

  useEffect(() => { void controller.ensureMetadata() }, [controller])
  useEffect(() => {
    if (client.status?.settings.defaultTopUpUsd !== undefined) setTopUpAmount(client.status.settings.defaultTopUpUsd)
  }, [client.status?.settings.defaultTopUpUsd])
  useEffect(() => { setLanguageDraft(value?.language ?? 'auto') }, [value?.language])
  useEffect(() => { setContextDraft(value?.context ?? '') }, [value?.context])
  useEffect(() => {
    if (codeExpiry <= Date.now()) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [codeExpiry])

  const catalog = client.catalog?.bindings ?? []
  const defaultBinding = selectBinding(catalog, getLocale(), {
    ...(value?.model === undefined ? {} : { model: value.model }),
    ...(value?.provider === undefined ? {} : { provider: value.provider }),
  })
  const selectedModel = defaultBinding?.model ?? value?.model ?? ''
  const providers = catalog.filter(binding => binding.model === selectedModel)
  const selectedProvider = providers.some(binding => binding.provider === value?.provider)
    ? value?.provider ?? ''
    : providers.find(binding => binding.isProviderDefault)?.provider ?? providers[0]?.provider ?? ''
  const selectedBinding = providers.find(binding => binding.provider === selectedProvider)
  const models = useMemo(() => [...new Set(catalog.map(binding => binding.model))].sort(), [catalog])
  const ttsCatalog = client.catalog?.ttsBindings ?? []
  const ttsEnabled = value?.ttsEnabled ?? true
  const ttsLocale = value?.language !== undefined && value.language !== 'auto' ? value.language : getLocale()
  const localizedTts = preferredTtsSelection(ttsLocale)
  const hasSavedVoiceRoute = value?.ttsModel !== undefined && value.ttsProvider !== undefined && value.ttsVoice !== undefined
  const ttsBinding = selectLocalizedTtsBinding(ttsCatalog, ttsLocale, {
    ...(!hasSavedVoiceRoute ? {} : { model: value.ttsModel, provider: value.ttsProvider }),
  })
  const selectedTtsModel = ttsBinding?.model ?? value?.ttsModel ?? ''
  const ttsProviders = ttsCatalog.filter(binding => binding.model === selectedTtsModel)
  const selectedTtsProvider = ttsProviders.some(binding => binding.provider === value?.ttsProvider)
    ? value?.ttsProvider ?? ''
    : ttsProviders.find(binding => binding.isProviderDefault)?.provider ?? ttsProviders[0]?.provider ?? ''
  const selectedTtsBinding = ttsProviders.find(binding => binding.provider === selectedTtsProvider) ?? ttsBinding
  const ttsModels = useMemo(() => [...new Set(ttsCatalog.map(binding => binding.model))].sort(), [ttsCatalog])
  const selectedVoice = (hasSavedVoiceRoute ? value.ttsVoice : undefined)
    ?? (selectedTtsModel === localizedTts.model && selectedTtsProvider === localizedTts.provider ? localizedTts.voice : undefined)
    ?? selectedTtsBinding?.defaultVoice ?? ''
  const defaultVoiceOption: VoiceOption = {
    id: selectedVoice,
    name: selectedVoice === localizedTts.voice ? localizedTts.name : selectedVoice,
    model: selectedTtsModel,
    provider: selectedTtsProvider,
  }
  const globalVoiceResults = useVoiceOptions({}, voiceSearch, ttsEnabled)
  const scopedVoiceResults = useVoiceOptions({
    model: selectedTtsBinding?.aliases?.[0] ?? selectedTtsModel,
    provider: selectedTtsProvider,
  }, modelVoiceSearch, ttsEnabled && selectedTtsModel.length > 0 && selectedTtsProvider.length > 0)
  const selectedVoiceOption = [...scopedVoiceResults.voices, ...globalVoiceResults.voices].find(voice =>
    voice.id === selectedVoice && voice.model === selectedTtsModel && voice.provider === selectedTtsProvider)
    ?? (selectedVoice.length === 0 ? undefined : defaultVoiceOption)
  const remaining = Math.max(0, Math.ceil((codeExpiry - now) / 1_000))
  const connected = client.status?.credential.configured === true
  const writable = settings.writable

  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key)
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

  const write = (field: string, next: unknown): void => {
    void run(`setting:${field}`, async () => {
      await scope.set(field, next)
      await controller.ensureMetadata(true)
      setMessage(t('saved'))
    })
  }

  const commitLanguage = (): void => {
    const next = languageDraft.trim() || 'auto'
    if (next !== 'auto' && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(next)) {
      setError(t('invalidLanguage'))
      return
    }
    if (next !== (value?.language ?? 'auto')) write('language', next)
  }

  const commitContext = (): void => {
    if (contextDraft !== (value?.context ?? '')) write('context', contextDraft)
  }

  const sendCode = (): void => {
    void run('send-code', async () => {
      const response = await speechApi.startAuth(email)
      setCodeExpiry(Date.now() + response.expiresInSeconds * 1_000)
      setNow(Date.now())
      setMessage(t('codeSent'))
    })
  }

  const verify = (): void => {
    void run('verify', async () => {
      await speechApi.verifyAuth(email, code)
      setCode('')
      setCodeExpiry(0)
      await controller.ensureMetadata(true)
    })
  }

  const setKey = (): void => {
    void run('api-key', async () => {
      await speechApi.setKey(apiKey)
      setApiKey('')
      await controller.ensureMetadata(true)
    })
  }

  return (
    <div className={styles.settings}>
      <header className={styles.header}>
        <div>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        {connected ? (
          <button className={styles.secondary} type="button" disabled={client.metadataLoading} onClick={() => { void controller.ensureMetadata(true) }}>
            {client.metadataLoading ? t('loading') : t('refresh')}
          </button>
        ) : null}
      </header>

      <section className={`${styles.card} ${connected ? '' : styles.accountWelcome}`}>
        {connected ? (
          <>
            <div className={styles.cardTitle}>
              <h3>{t('account')}</h3>
              <span className={styles.good}>{t('connected')}</span>
            </div>
            {client.status?.credential.source === undefined ? null : (
              <p className={styles.hint}>{t('managedBy', { source: client.status.credential.source })}</p>
            )}
          <button
            className={styles.secondary}
            type="button"
            disabled={busy !== null || client.status?.credential.writable !== true}
            onClick={() => { void run('logout', async () => { await speechApi.logout(); await controller.ensureMetadata(true) }) }}
          >{t('disconnect')}</button>
          </>
        ) : (
          <>
            <div className={styles.cardTitle}>
              <div className={styles.accountIntro}>
                <h3>{t('signupTitle')}</h3>
                <p>{t('signupLead')}</p>
              </div>
              <span className={styles.freeCredit}>{t('freeCredit')}</span>
            </div>
            <div className={styles.stack}>
              <Field label={t('email')}>
                <input className={styles.input} type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value) }} />
              </Field>
              <button className={styles.primary} type="button" disabled={busy !== null || email.length === 0} onClick={sendCode}>
                {remaining > 0 ? t('resend') : t('sendCode')}
              </button>
              <p className={styles.accountHint}>{t('emailFlowHint')}</p>
              {codeExpiry === 0 ? null : (
                <>
                  <Field label={t('code')} hint={t('expires', { seconds: remaining })}>
                    <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => { setCode(event.target.value.replace(/\D/gu, '').slice(0, 6)) }} />
                  </Field>
                  <button className={styles.primary} type="button" disabled={busy !== null || code.length !== 6 || remaining === 0} onClick={verify}>{t('verify')}</button>
                </>
              )}
            </div>
            <details className={styles.apiKeyDetails}>
              <summary className={styles.apiKeySummary}>{t('apiKeySignIn')}</summary>
              <div className={styles.apiKeyBody}>
                <Field label={t('apiKey')}>
                  <input className={styles.input} type="password" autoComplete="off" value={apiKey} onChange={event => { setApiKey(event.target.value) }} />
                </Field>
                <button className={styles.secondary} type="button" disabled={busy !== null || apiKey.length < 8} onClick={setKey}>{t('connect')}</button>
              </div>
            </details>
          </>
        )}
      </section>

      {connected ? <>
        <section className={styles.card}>
        <h3>{t('settings')}</h3>
        <div className={styles.grid}>
          <div className={styles.modelFull}>
            <ModelPicker
              label={t('model')}
              placeholder={t('modelSearchPlaceholder')}
              emptyLabel={t('modelNoResults')}
              options={models}
              value={selectedModel}
              disabled={!writable || models.length === 0}
              onSelect={model => {
                const choices = catalog.filter(binding => binding.model === model)
                const provider = choices.find(binding => binding.isProviderDefault)?.provider ?? choices[0]?.provider
                void run('setting:model', async () => {
                  await scope.set('model', model)
                  if (provider !== undefined) await scope.set('provider', provider)
                  await controller.ensureMetadata(true)
                })
              }}
            />
          </div>
          <Field label={t('provider')}>
            <select className={styles.input} value={selectedProvider} disabled={!writable || providers.length === 0} onChange={event => { write('provider', event.target.value) }}>
              {providers.map(binding => <option key={binding.provider} value={binding.provider}>{binding.provider}</option>)}
            </select>
          </Field>
          <Field label={t('language')}>
            <input
              className={styles.input}
              list="dsh-speech-languages"
              value={languageDraft}
              disabled={!writable}
              onChange={event => { setLanguageDraft(event.target.value) }}
              onBlur={commitLanguage}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
            />
            <datalist id="dsh-speech-languages">
              {LANGUAGES.map(([id, label]) => <option key={id} value={id}>{id === 'auto' ? t('auto') : label}</option>)}
            </datalist>
          </Field>
        </div>
        {selectedBinding?.contextSupported === true ? (
          <details className={styles.contextDetails}>
            <summary className={styles.contextSummary}>{t('context')} <span>{t('optional')}</span></summary>
            <div className={styles.contextBody}>
              <p className={styles.hint}>{t('contextHint')}</p>
              <textarea
                className={styles.textarea}
                aria-label={t('context')}
                maxLength={4_000}
                value={contextDraft}
                disabled={!writable}
                onChange={event => { setContextDraft(event.target.value) }}
                onBlur={commitContext}
              />
            </div>
          </details>
        ) : null}
        </section>

        <section className={styles.card}>
        <div className={styles.cardTitle}>
          <div>
            <h3>{t('spokenSummaries')}</h3>
            <p className={styles.hint}>{t('spokenSummariesHint')}</p>
          </div>
          <div className={styles.summaryToggles}>
            <label className={styles.switchLabel}>
              <input
                type="checkbox"
                checked={ttsEnabled}
                disabled={!writable}
                onChange={event => { write('ttsEnabled', event.target.checked) }}
              />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span>{t('ttsEnabled')}</span>
            </label>
            <label className={styles.switchLabel}>
              <input
                type="checkbox"
                checked={value?.autoPlay ?? true}
                disabled={!writable || !ttsEnabled}
                onChange={event => { write('autoPlay', event.target.checked) }}
              />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span>{t('autoplayGlobal')}</span>
            </label>
          </div>
        </div>
        <div className={styles.grid}>
          <div className={styles.modelFull}>
            <VoicePicker
              label={t('voiceSearch')}
              hint={t('voiceSearchHint')}
              placeholder={t('voiceSearchPlaceholder')}
              loadingLabel={t('loading')}
              emptyLabel={t('voiceNoResults')}
              query={voiceSearch}
              voices={globalVoiceResults.voices}
              selected={selectedVoiceOption}
              loading={globalVoiceResults.loading}
              disabled={!writable || !ttsEnabled}
              onQuery={setVoiceSearch}
              onSelect={voice => {
                if (voice.model === undefined || voice.provider === undefined) return
                setVoiceSearch(voice.name)
                setModelVoiceSearch('')
                void run('setting:ttsVoice', async () => {
                  await scope.set('ttsVoice', voice.id)
                  await scope.set('ttsModel', voice.model!)
                  await scope.set('ttsProvider', voice.provider!)
                })
              }}
            />
          </div>
          <div className={styles.modelFull}>
            <ModelPicker
              label={t('ttsModel')}
              placeholder={t('modelSearchPlaceholder')}
              emptyLabel={t('modelNoResults')}
              options={ttsModels}
              value={selectedTtsModel}
              disabled={!writable || !ttsEnabled || ttsModels.length === 0}
              onSelect={model => {
                const choices = ttsCatalog.filter(binding => binding.model === model)
                const provider = choices.find(binding => binding.isProviderDefault)?.provider ?? choices[0]?.provider
                void run('setting:ttsModel', async () => {
                  await scope.set('ttsModel', model)
                  if (provider !== undefined) await scope.set('ttsProvider', provider)
                })
              }}
            />
          </div>
          <Field label={t('ttsProvider')}>
            <select className={styles.input} value={selectedTtsProvider} disabled={!writable || !ttsEnabled || ttsProviders.length === 0} onChange={event => { write('ttsProvider', event.target.value) }}>
              {ttsProviders.map(binding => <option key={binding.provider} value={binding.provider}>{binding.provider}</option>)}
            </select>
          </Field>
          <div className={styles.modelFull}>
            <VoicePicker
              label={t('ttsVoice')}
              hint={t('modelVoiceSearchHint', { model: selectedTtsModel })}
              placeholder={t('modelVoiceSearchPlaceholder')}
              loadingLabel={t('loading')}
              emptyLabel={t('voiceNoResults')}
              query={modelVoiceSearch}
              voices={scopedVoiceResults.voices}
              selected={selectedVoiceOption}
              loading={scopedVoiceResults.loading}
              disabled={!writable || !ttsEnabled || selectedTtsBinding === undefined}
              onQuery={setModelVoiceSearch}
              onSelect={voice => {
                setModelVoiceSearch(voice.name)
                void run('setting:ttsVoice', async () => {
                  await scope.set('ttsVoice', voice.id)
                  await scope.set('ttsModel', selectedTtsModel)
                  await scope.set('ttsProvider', selectedTtsProvider)
                })
              }}
            />
          </div>
        </div>
        {ttsCatalog.length === 0 ? <p className={styles.muted}>{t('ttsUnavailable')}</p> : null}
        <div className={styles.summaryCache}>
          <div>
            <strong>{t('summaryCache')}</strong>
            <p className={styles.hint}>{t('summaryCacheHint')}</p>
          </div>
          <button className={styles.secondary} type="button" disabled={busy !== null} onClick={() => {
            void run('clear-summary-cache', async () => { await summaryCache.clear(); setMessage(t('summaryCacheCleared')) })
          }}>{busy === 'clear-summary-cache' ? t('loading') : t('clearSummaryCache')}</button>
        </div>
        </section>

        <section className={styles.card}>
        <h3>{t('balance')}</h3>
        {client.status?.balance === undefined ? (
          <p className={styles.muted}>{client.status?.balanceError === undefined ? t('loading') : t('balanceUnavailable')}</p>
        ) : (
          <>
            <strong className={styles.balanceValue}>{money(client.status.balance.paidUsd)}</strong>
            {client.status.balance.exhausted ? <p className={styles.danger}>{t('emptyBalance')}</p>
              : client.status.balance.low ? <p className={styles.warning}>{t('lowBalance')}</p> : null}
          </>
        )}
        {connected ? (
          <div className={styles.topUp}>
            <Field label={t('amount')}>
              <input className={styles.input} type="number" min={5} max={1_000} step={1} value={topUpAmount} onChange={event => { setTopUpAmount(Number(event.target.value)) }} />
            </Field>
            <button className={styles.primary} type="button" disabled={busy !== null || topUpAmount < 5 || topUpAmount > 1_000} onClick={() => {
              void run('top-up', async () => { const result = await speechApi.topUp(topUpAmount); setTopUpUrl(result.url) })
            }}>{t('createLink')}</button>
            {topUpUrl === null ? null : <a className={styles.checkout} href={topUpUrl} target="_blank" rel="noreferrer">{t('openCheckout')}</a>}
          </div>
        ) : null}
        </section>
      </> : null}

      {message === null ? null : <p className={styles.good} role="status">{message}</p>}
      {error === null && client.error === undefined ? null : <p className={styles.danger} role="alert">{error ?? client.error}</p>}
    </div>
  )
}
