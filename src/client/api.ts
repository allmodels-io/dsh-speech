import type {
  CatalogResponse,
  StatusResponse,
  SummarizeRequest,
  TtsRequest,
  VoiceCatalogResponse,
} from '../shared.ts'

export class SpeechApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SpeechApiError'
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = body !== null && typeof body === 'object'
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined
    throw new SpeechApiError(
      typeof error?.code === 'string' ? error.code : `HTTP_${String(response.status)}`,
      typeof error?.message === 'string' ? error.message : 'Speech request failed',
    )
  }
  return body as T
}

async function audioRequest(input: TtsRequest, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/dsh-speech/tts', {
    method: 'POST',
    headers: { accept: 'audio/mpeg', 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined)
    const error = body !== null && typeof body === 'object'
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined
    throw new SpeechApiError(
      typeof error?.code === 'string' ? error.code : `HTTP_${String(response.status)}`,
      typeof error?.message === 'string' ? error.message : 'Speech generation failed',
    )
  }
  const blob = await response.blob()
  if (blob.size === 0 || blob.size > 16 * 1024 * 1024) throw new SpeechApiError('INVALID_AUDIO', 'The spoken summary audio is invalid')
  return blob.type === 'audio/mpeg' ? blob : blob.slice(0, blob.size, 'audio/mpeg')
}

export const speechApi = {
  status: (): Promise<StatusResponse> => request('/api/dsh-speech/status'),
  catalog: (refresh = false): Promise<CatalogResponse> => request(`/api/dsh-speech/catalog${refresh ? '?refresh=1' : ''}`),
  voices: (filters: { model?: string; provider?: string; q?: string; language?: string } = {}, signal?: AbortSignal): Promise<VoiceCatalogResponse> => {
    const query = new URLSearchParams()
    if (filters.model !== undefined) query.set('model', filters.model)
    if (filters.provider !== undefined) query.set('provider', filters.provider)
    if (filters.q !== undefined) query.set('q', filters.q)
    if (filters.language !== undefined) query.set('language', filters.language)
    return request(`/api/dsh-speech/voices?${query.toString()}`, signal === undefined ? undefined : { signal })
  },
  summarize: (input: SummarizeRequest, signal?: AbortSignal): Promise<{ summary: string }> => request('/api/dsh-speech/summarize', {
    method: 'POST', body: JSON.stringify(input), ...(signal === undefined ? {} : { signal }),
  }),
  tts: audioRequest,
  prepareTts: (input: TtsRequest, signal?: AbortSignal): Promise<{ url: string; expiresAt: number }> => request('/api/dsh-speech/tts/prepare', {
    method: 'POST', body: JSON.stringify(input), ...(signal === undefined ? {} : { signal }),
  }),
  startAuth: (email: string): Promise<{ ok: true; expiresInSeconds: number }> => request('/api/dsh-speech/auth/start', {
    method: 'POST', body: JSON.stringify({ email }),
  }),
  verifyAuth: (email: string, code: string): Promise<{ ok: true }> => request('/api/dsh-speech/auth/verify', {
    method: 'POST', body: JSON.stringify({ email, code }),
  }),
  setKey: (apiKey: string): Promise<{ ok: true }> => request('/api/dsh-speech/auth/key', {
    method: 'POST', body: JSON.stringify({ apiKey }),
  }),
  logout: (): Promise<{ ok: true }> => request('/api/dsh-speech/auth/logout', { method: 'POST', body: '{}' }),
  topUp: (amountUsd: number): Promise<{ url: string; expiresAt?: string }> => request('/api/dsh-speech/top-up', {
    method: 'POST', body: JSON.stringify({ amountUsd }),
  }),
}
