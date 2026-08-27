import { describe, expect, it } from 'vitest'
import { normalizedEvent, parseStart, upstreamUrl } from '../src/stt-proxy.ts'
import { AUDIO_FORMAT, DEFAULT_API_KEY_ENV, type SpeechSettings } from '../src/shared.ts'

const settings: SpeechSettings = {
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  baseURL: 'https://api.allmodels.io',
  lowBalanceUsd: 0.5,
  defaultTopUpUsd: 10,
  language: 'zh-CN',
  context: 'DeepSeek Harness, Cordis',
}

describe('STT proxy protocol', () => {
  it('accepts only the bounded start contract', () => {
    expect(parseStart(Buffer.from(JSON.stringify({ type: 'start', locale: 'zh-CN', audioFormat: AUDIO_FORMAT })))).toEqual({
      type: 'start', locale: 'zh-CN', audioFormat: AUDIO_FORMAT,
    })
    expect(parseStart(Buffer.from(JSON.stringify({ type: 'start', locale: 'en', audioFormat: 'mp3' })))).toBeUndefined()
  })

  it('sends only supported portable options upstream', () => {
    const withContext = upstreamUrl(settings, {
      provider: 'soniox', model: 'stt-rt-v5', contextSupported: true, interimResultsSupported: true,
    })
    expect(withContext.protocol).toBe('wss:')
    expect(withContext.searchParams.get('context')).toBe('DeepSeek Harness, Cordis')
    expect(withContext.searchParams.get('interim_results')).toBe('true')
    expect(withContext.searchParams.get('language')).toBe('zh-CN')
    const withoutContext = upstreamUrl(settings, {
      provider: 'fal', model: 'whisper', contextSupported: false, interimResultsSupported: false,
    })
    expect(withoutContext.searchParams.has('context')).toBe(false)
    expect(withoutContext.searchParams.has('interim_results')).toBe(false)
  })

  it('normalizes partial, final, error, and ended events', () => {
    expect(normalizedEvent(Buffer.from('{"type":"stt.transcript.partial","sequence":4,"text":"hel"}')))
      .toEqual({ type: 'partial', sequence: 4, text: 'hel' })
    expect(normalizedEvent(Buffer.from('{"type":"stt.transcript.final","sequence":5,"text":"hello","language_code":"en"}')))
      .toEqual({ type: 'final', sequence: 5, text: 'hello', languageCode: 'en' })
    expect(normalizedEvent(Buffer.from('{"type":"stt.error","code":"BALANCE","message":"empty"}')))
      .toEqual({ type: 'error', code: 'BALANCE', message: 'empty' })
    expect(normalizedEvent(Buffer.from('{"type":"stt.session.ended"}'))).toEqual({ type: 'ended' })
  })
})
