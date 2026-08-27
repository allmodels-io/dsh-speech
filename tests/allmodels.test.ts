import { afterEach, describe, expect, it, vi } from 'vitest'
import { AllModelsClient, AllModelsError, requestJson } from '../src/allmodels.ts'
import { DEFAULT_API_KEY_ENV, type SpeechSettings } from '../src/shared.ts'

const settings: SpeechSettings = {
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  baseURL: 'https://api.allmodels.io',
  lowBalanceUsd: 0.5,
  defaultTopUpUsd: 10,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('AllModels HTTP client', () => {
  it('keeps authentication in the Authorization header', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-value')
      expect(init?.body).toBeUndefined()
      return new Response('{"paid_balance_usd":"1"}', { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await requestJson(settings.baseURL, '/account/balance', {}, 'secret-value')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('stores no secret in surfaced network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Rejected secret-value"}', { status: 401 })))
    await expect(requestJson(settings.baseURL, '/account/balance', {}, 'secret-value'))
      .rejects.toMatchObject({ status: 401, code: 'HTTP_401', message: 'AllModels rejected the authenticated request' })
  })

  it('validates a pasted key through the balance endpoint shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"state":"active","paid_balance_usd":"0.75"}', { status: 200 })))
    await expect(new AllModelsClient().balance(settings, 'key')).resolves.toMatchObject({ usableUsd: 0.75, low: false })
  })

  it('refuses an insecure top-up URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"url":"http://example.com"}', { status: 200 })))
    await expect(new AllModelsClient().topUp(settings, 'key', 10)).rejects.toBeInstanceOf(AllModelsError)
  })
})
