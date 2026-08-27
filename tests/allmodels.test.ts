import { afterEach, describe, expect, it, vi } from 'vitest'
import { AllModelsClient, AllModelsError, requestAudio, requestJson } from '../src/allmodels.ts'
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

  it('routes synchronous MP3 generation through the selected provider with header-only credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe('/oai/audio/speech')
      expect(url.searchParams.get('provider_only')).toBe('deepgram')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-value')
      expect(url.toString()).not.toContain('secret-value')
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'deepgram/aura-2', voice: 'aura-2-thalia-en', input: 'Short summary', response_format: 'mp3', stream_format: 'audio',
      })
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }))
    const bytes = await new AllModelsClient().speech(settings, 'secret-value', {
      model: 'deepgram/aura-2', provider: 'deepgram', voice: 'aura-2-thalia-en', text: 'Short summary',
    })
    expect([...bytes.slice(0, 3)]).toEqual([0x49, 0x44, 0x33])
  })

  it('rejects malformed and oversized audio responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
    await expect(requestAudio(settings.baseURL, '/oai/audio/speech', {}, 'key')).rejects.toMatchObject({ code: 'INVALID_AUDIO' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), {
      status: 200, headers: { 'content-length': String(17 * 1024 * 1024) },
    })))
    await expect(requestAudio(settings.baseURL, '/oai/audio/speech', {}, 'key')).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('enforces the TTS timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })))
    await expect(requestAudio(settings.baseURL, '/oai/audio/speech', {}, 'key', { timeoutMs: 1 }))
      .rejects.toMatchObject({ code: 'TIMEOUT', status: 504 })
  })
})
