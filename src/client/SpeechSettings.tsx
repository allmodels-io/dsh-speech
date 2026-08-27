import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpeechUserSettings } from '../shared.ts'
import { selectBinding } from '../shared.ts'
import { speechApi } from './api.ts'
import type { SpeechController } from './controller.ts'
import type { SpeechLocaleKey } from './locales.ts'
import { styles } from './styles.ts'

export interface SpeechSettingsInjected {
  controller: SpeechController
  scope: SettingsScope<SpeechUserSettings>
  getLocale: () => string
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

export function SpeechSettings({ controller, scope, getLocale, t }: SpeechSettingsProps): ReactNode {
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
            <Field label={t('model')}>
              <select className={styles.input} value={selectedModel} disabled={!writable || models.length === 0} onChange={event => {
                const model = event.target.value
                const choices = catalog.filter(binding => binding.model === model)
                const provider = choices.find(binding => binding.isProviderDefault)?.provider ?? choices[0]?.provider
                void run('setting:model', async () => {
                  await scope.set('model', model)
                  if (provider !== undefined) await scope.set('provider', provider)
                  await controller.ensureMetadata(true)
                })
              }}>
                {models.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </Field>
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
