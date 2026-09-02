// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechSettings } from '../src/client/SpeechSettings.tsx'
import { speechApi } from '../src/client/api.ts'
import type { SpeechClientState, SpeechController } from '../src/client/controller.ts'
import { en, type SpeechLocaleKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function t(key: SpeechLocaleKey, params?: Record<string, unknown>): string {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

type SnapshotInput = Omit<SpeechClientState, 'microphones' | 'switchingMicrophone' | 'hasTranscript'>
  & Partial<Pick<SpeechClientState, 'microphones' | 'switchingMicrophone' | 'hasTranscript'>>

function renderSettings(inputSnapshot: SnapshotInput, settingValue: Record<string, unknown> = { language: 'auto', context: '' }) {
  const snapshot: SpeechClientState = { microphones: [], switchingMicrophone: false, hasTranscript: false, ...inputSnapshot }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    ensureMetadata: vi.fn(async () => {}),
  } as unknown as SpeechController
  const scope = {
    snapshot: { value: settingValue, writable: true },
    subscribe(this: { snapshot: unknown }, _listener: () => void) {
      void this.snapshot
      return () => {}
    },
    getSnapshot(this: { snapshot: unknown }) { return this.snapshot },
    set: vi.fn(async () => {}),
  }
  const summaryCache = { clear: vi.fn(async () => {}) }
  return Object.assign(render(createElement(SpeechSettings, {
    controller,
    scope,
    summaryCache,
    getLocale: () => 'en',
    t,
    close: vi.fn(),
  } as never)), { scope, summaryCache })
}

describe('Speech settings account states', () => {
  it('leads with email signup and hides account-only controls while disconnected', () => {
    const view = renderSettings({
      phase: 'idle',
      amplitude: 0,
      metadataLoading: false,
      status: {
        credential: { configured: false, writable: true },
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      },
    })

    expect(view.getByRole('heading', { name: en.signupTitle })).toBeTruthy()
    expect(view.getByText(en.freeCredit)).toBeTruthy()
    expect(view.getByLabelText(en.email)).toBeTruthy()
    expect(view.getByRole('button', { name: en.sendCode })).toBeTruthy()
    expect(view.queryByRole('heading', { name: en.settings })).toBeNull()
    expect(view.queryByRole('heading', { name: en.balance })).toBeNull()
    const apiKeyDetails = view.container.querySelector('details')
    expect(apiKeyDetails?.open).toBe(false)
    expect(apiKeyDetails?.querySelector('summary')?.textContent).toBe(en.apiKeySignIn)
  })

  it('shows recognition and balance only after connecting', () => {
    const view = renderSettings({
      phase: 'idle',
      amplitude: 0,
      metadataLoading: false,
      status: {
        credential: { configured: true, writable: true },
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
        balance: { paidUsd: 1, promotionUsd: 1, usableUsd: 2, low: false, exhausted: false, fetchedAt: 1 },
      },
      catalog: { fetchedAt: 1, bindings: [{
        provider: 'assemblyai',
        model: 'assemblyai/u3-rt-pro',
        canonical: 'assemblyai/u3-rt-pro',
        isProviderDefault: true,
        contextSupported: true,
        interimResultsSupported: true,
      }] },
    })

    expect(view.getByRole('heading', { name: en.settings })).toBeTruthy()
    expect(view.getByRole('heading', { name: en.balance })).toBeTruthy()
    expect(view.queryByRole('heading', { name: en.signupTitle })).toBeNull()
    const model = view.getByRole('combobox', { name: en.model }) as HTMLInputElement
    expect(model.type).toBe('search')
    expect(model.value).toBe('assemblyai/u3-rt-pro')
    const contextDetails = view.getByText(en.context).closest('details')
    expect(contextDetails?.open).toBe(false)
    expect(view.getByText('$1.00')).toBeTruthy()
    expect(view.queryByText(en.promotion)).toBeNull()
    expect(view.queryByText(en.usable)).toBeNull()
    expect(view.queryByText('$2.00')).toBeNull()
  })

  it('shows compatible spoken-summary model, provider, voice, and concise global controls', async () => {
    const voices = vi.spyOn(speechApi, 'voices').mockImplementation(async filters => ({ voices: [{
      id: 'voice-default', name: 'Default Voice', model: 'deepgram/aura-2', provider: 'deepgram',
      description: filters?.q === undefined ? 'Warm and clear' : `Matches ${filters.q}`,
    }], fetchedAt: 1 }))
    const view = renderSettings({
      phase: 'idle', amplitude: 0, metadataLoading: false,
      status: {
        credential: { configured: true, writable: true }, settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      },
      catalog: {
        fetchedAt: 1,
        bindings: [],
        ttsBindings: [{
          provider: 'deepgram', model: 'deepgram/aura-2', canonical: 'deepgram/aura-2',
          isProviderDefault: true, defaultVoice: 'voice-default', formats: ['mp3'], aliases: ['deepgram/aura-2-search'],
        }],
      },
    })
    expect(view.getByRole('heading', { name: en.spokenSummaries })).toBeTruthy()
    const ttsModel = view.getByRole('combobox', { name: en.ttsModel }) as HTMLInputElement
    expect(ttsModel.type).toBe('search')
    expect(ttsModel.value).toBe('deepgram/aura-2')
    expect((view.getByLabelText(en.ttsProvider) as HTMLSelectElement).value).toBe('deepgram')
    const modelVoiceSearch = view.getByRole('combobox', { name: en.ttsVoice }) as HTMLInputElement
    expect(modelVoiceSearch.type).toBe('search')
    expect((await view.findAllByText('Default Voice')).length).toBeGreaterThan(0)
    fireEvent.change(modelVoiceSearch, { target: { value: 'warm' } })
    await waitFor(() => {
      expect(voices).toHaveBeenCalledWith({ model: 'deepgram/aura-2-search', provider: 'deepgram', q: 'warm' }, expect.any(AbortSignal))
    })
    expect(await view.findByText('Matches warm')).toBeTruthy()
    expect((view.getByLabelText(en.ttsEnabled) as HTMLInputElement).checked).toBe(true)
    expect((view.getByLabelText(en.autoplayGlobal) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(view.getByLabelText(en.ttsEnabled))
    await waitFor(() => { expect(view.scope.set).toHaveBeenCalledWith('ttsEnabled', false) })
    fireEvent.click(view.getByRole('button', { name: en.clearSummaryCache }))
    await waitFor(() => { expect(view.summaryCache.clear).toHaveBeenCalledOnce() })
    expect(await view.findByText(en.summaryCacheCleared)).toBeTruthy()
  })

  it('disables autoplay and voice configuration while text-to-speech summaries are off', () => {
    const view = renderSettings({
      phase: 'idle', amplitude: 0, metadataLoading: false,
      status: {
        credential: { configured: true, writable: true }, settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10, ttsEnabled: false },
      },
      catalog: {
        fetchedAt: 1,
        bindings: [],
        ttsBindings: [{
          provider: 'deepgram', model: 'deepgram/aura-2', canonical: 'deepgram/aura-2',
          isProviderDefault: true, defaultVoice: 'voice-default', formats: ['mp3'],
        }],
      },
    }, { language: 'auto', context: '', ttsEnabled: false, autoPlay: true })
    expect((view.getByLabelText(en.ttsEnabled) as HTMLInputElement).checked).toBe(false)
    expect((view.getByLabelText(en.autoplayGlobal) as HTMLInputElement).disabled).toBe(true)
    expect((view.getByLabelText(en.voiceSearch) as HTMLInputElement).disabled).toBe(true)
    expect((view.getByLabelText(en.ttsModel) as HTMLInputElement).disabled).toBe(true)
  })

  it('filters and selects STT and TTS models from searchable comboboxes', async () => {
    const view = renderSettings({
      phase: 'idle', amplitude: 0, metadataLoading: false,
      status: {
        credential: { configured: true, writable: true }, settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      },
      catalog: {
        fetchedAt: 1,
        bindings: [
          { provider: 'assemblyai', model: 'assemblyai/u3-rt-pro', canonical: 'assemblyai/u3-rt-pro', isProviderDefault: true, contextSupported: true, interimResultsSupported: true },
          { provider: 'soniox', model: 'soniox/stt-rt-v3', canonical: 'soniox/stt-rt-v3', isProviderDefault: true, contextSupported: true, interimResultsSupported: true },
        ],
        ttsBindings: [
          { provider: 'deepgram', model: 'deepgram/aura-2', canonical: 'deepgram/aura-2', isProviderDefault: true, defaultVoice: 'aura', formats: ['mp3'] },
          { provider: 'fish-audio', model: 'fish-audio/s1', canonical: 'fish-audio/s1', isProviderDefault: true, defaultVoice: 'elon', formats: ['mp3'] },
        ],
      },
    })

    const sttModel = view.getByRole('combobox', { name: en.model }) as HTMLInputElement
    fireEvent.focus(sttModel)
    fireEvent.change(sttModel, { target: { value: 'soniox' } })
    expect(view.queryByRole('option', { name: 'assemblyai/u3-rt-pro' })).toBeNull()
    fireEvent.click(view.getByRole('option', { name: 'soniox/stt-rt-v3' }))
    await waitFor(() => {
      expect(view.scope.set).toHaveBeenCalledWith('model', 'soniox/stt-rt-v3')
      expect(view.scope.set).toHaveBeenCalledWith('provider', 'soniox')
    })

    const ttsModel = view.getByRole('combobox', { name: en.ttsModel }) as HTMLInputElement
    fireEvent.focus(ttsModel)
    fireEvent.change(ttsModel, { target: { value: 'fish' } })
    expect(view.queryByRole('option', { name: 'deepgram/aura-2' })).toBeNull()
    fireEvent.keyDown(ttsModel, { key: 'ArrowDown' })
    fireEvent.keyDown(ttsModel, { key: 'Enter' })
    await waitFor(() => {
      expect(view.scope.set).toHaveBeenCalledWith('ttsModel', 'fish-audio/s1')
      expect(view.scope.set).toHaveBeenCalledWith('ttsProvider', 'fish-audio')
    })
  })
})
