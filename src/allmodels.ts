import {
  CATALOG_TTL_MS,
  normalizeCatalog,
  summarizeBalance,
  type BalanceSummary,
  type CatalogResponse,
  type SpeechSettings,
} from './shared.ts'

const HTTP_TIMEOUT_MS = 15_000

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
