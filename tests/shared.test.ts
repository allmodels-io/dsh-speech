import { describe, expect, it } from 'vitest'
import {
  appendTranscript,
  applyTranscriptEvent,
  createTranscript,
  normalizeCatalog,
  normalizeVoices,
  selectBinding,
  selectTtsBinding,
  summarizeBalance,
  transcriptText,
} from '../src/shared.ts'

const catalogFixture = {
  providers: {
    soniox: {
      defaults: { stt: { model: 'stt-rt-v5' }, tts: { model: 'tts-rt-v1', voice: 'Adrian' } },
      stt: [{
        id: 'stt-rt-v5', canonical: 'soniox/stt-rt-v5', streaming: true,
        streamingInput: { audioFormats: ['pcm_16000'], portableOptions: ['context', 'interim_results'] },
        pricing: { unit: 'minute', unitPrice: '0.01' },
      }],
      tts: [{ id: 'tts-rt-v1', canonical: 'soniox/tts-rt-v1', aliases: ['soniox/tts-rt-v1-search'], synchronous: true, formats: ['mp3', 'wav'] }],
    },
    assemblyai: {
      defaults: { stt: { model: 'u3-rt-pro' } },
      stt: [{
        id: 'u3-rt-pro', canonical: 'assemblyai/u3-rt-pro', streaming: true,
        streamingInput: { audioFormats: ['pcm_16000'], portableOptions: ['context', 'interim_results'] },
      }],
    },
    incompatible: {
      defaults: { stt: { model: 'only-24k' } },
      stt: [{ id: 'only-24k', streaming: true, streamingInput: { audioFormats: ['pcm_24000'] } }],
      tts: [{ id: 'stream-only', synchronous: false, formats: ['mp3'] }, { id: 'wav-only', synchronous: true, formats: ['wav'] }],
    },
  },
}

describe('catalog selection', () => {
  it('keeps only PCM16/16k streaming bindings and their portable capabilities', () => {
    const result = normalizeCatalog(catalogFixture, 123)
    expect(result.fetchedAt).toBe(123)
    expect(result.bindings).toHaveLength(2)
    expect(result.bindings.find(binding => binding.provider === 'soniox')).toMatchObject({
      model: 'soniox/stt-rt-v5', isProviderDefault: true, contextSupported: true, interimResultsSupported: true,
      pricePerMinuteUsd: 0.01,
    })
  })

  it('defaults Chinese to Soniox and other locales to AssemblyAI', () => {
    const bindings = normalizeCatalog(catalogFixture).bindings
    expect(selectBinding(bindings, 'zh-CN')?.provider).toBe('soniox')
    expect(selectBinding(bindings, 'en-US')?.provider).toBe('assemblyai')
  })

  it('honors explicit model/provider and falls back within the model', () => {
    const bindings = normalizeCatalog(catalogFixture).bindings
    expect(selectBinding(bindings, 'zh', { model: 'u3-rt-pro', provider: 'assemblyai' })?.provider).toBe('assemblyai')
    expect(selectBinding(bindings, 'zh', { model: 'assemblyai/u3-rt-pro', provider: 'missing' })?.provider).toBe('assemblyai')
  })

  it('normalizes synchronous MP3 TTS routes and selects saved values before advertised defaults', () => {
    const bindings = normalizeCatalog(catalogFixture).ttsBindings ?? []
    expect(bindings).toEqual([{
      provider: 'soniox', model: 'soniox/tts-rt-v1', canonical: 'soniox/tts-rt-v1',
      isProviderDefault: true, defaultVoice: 'Adrian', formats: ['mp3', 'wav'], aliases: ['soniox/tts-rt-v1-search'],
    }])
    expect(selectTtsBinding(bindings, { model: 'tts-rt-v1', provider: 'soniox' })?.provider).toBe('soniox')
  })

  it('normalizes the nested voice catalog response', () => {
    expect(normalizeVoices({ voices: [{ voice: { id: 'voice-1', name: 'Ava', preview_url: 'https://cdn.example/ava.mp3' } }] }, 44))
      .toEqual({ voices: [{ id: 'voice-1', name: 'Ava', previewUrl: 'https://cdn.example/ava.mp3' }], fetchedAt: 44 })
  })

  it('keeps the model/provider binding from global voice-search results', () => {
    expect(normalizeVoices({ voices: [{
      model: { id: 'fish/s2-1-pro' },
      voice: { id: 'voice-1', name: 'Elon', languages: [{ id: 'en', name: 'English' }] },
      providers: [{ id: 'fish', name: 'Fish Audio', default: true, provider_model_id: 's2.1-pro' }],
    }] }, 45)).toEqual({
      voices: [{ id: 'voice-1', name: 'Elon', model: 'fish/s2.1-pro', provider: 'fish', providerName: 'Fish Audio', languages: ['en'] }],
      fetchedAt: 45,
    })
  })
})

describe('balance summary', () => {
  it('adds only eligible, unexpired, applicable grants', () => {
    const now = Date.parse('2026-08-26T00:00:00Z')
    const summary = summarizeBalance({
      state: 'active',
      paid_balance_usd: '0.20',
      promotion_grants: [
        { remaining_usd: '0.40', eligible: true, expires_at: '2026-09-01T00:00:00Z' },
        { remaining_usd: '9', eligible: false },
        { remaining_usd: '9', eligible: true, expires_at: '2026-01-01T00:00:00Z' },
        { remaining_usd: '1', eligible: true, targets: { providers: ['deepgram'] } },
      ],
    }, 0.5, { provider: 'soniox', model: 'soniox/stt-rt-v5' }, now)
    expect(summary).toMatchObject({ paidUsd: 0.2, promotionUsd: 0.4, usableUsd: 0.6, low: false, exhausted: false })
  })

  it('marks a known zero balance exhausted', () => {
    expect(summarizeBalance({}, 0.5)).toMatchObject({ usableUsd: 0, low: true, exhausted: true })
  })
})

describe('transcript accumulation', () => {
  it('replaces partials, commits finals, and ignores duplicate sequences', () => {
    let state = createTranscript('Existing draft')
    state = applyTranscriptEvent(state, { kind: 'partial', sequence: 1, text: 'hello' })
    expect(transcriptText(state)).toBe('Existing draft hello')
    state = applyTranscriptEvent(state, { kind: 'partial', sequence: 2, text: 'hello world' })
    state = applyTranscriptEvent(state, { kind: 'final', sequence: 3, text: 'hello world' })
    state = applyTranscriptEvent(state, { kind: 'final', sequence: 3, text: 'duplicate' })
    expect(transcriptText(state)).toBe('Existing draft hello world')
  })

  it('does not force spaces between CJK chunks', () => {
    expect(appendTranscript('你好', '世界', 'zh-CN')).toBe('你好世界')
    expect(appendTranscript('hello', 'world', 'en')).toBe('hello world')
  })
})
