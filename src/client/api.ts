import type { CatalogResponse, StatusResponse } from '../shared.ts'

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

export const speechApi = {
  status: (): Promise<StatusResponse> => request('/api/dsh-speech/status'),
  catalog: (refresh = false): Promise<CatalogResponse> => request(`/api/dsh-speech/catalog${refresh ? '?refresh=1' : ''}`),
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
