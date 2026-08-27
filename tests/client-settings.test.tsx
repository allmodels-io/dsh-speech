// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechSettings } from '../src/client/SpeechSettings.tsx'
import type { SpeechClientState, SpeechController } from '../src/client/controller.ts'
import { en, type SpeechLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

function t(key: SpeechLocaleKey, params?: Record<string, unknown>): string {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

type SnapshotInput = Omit<SpeechClientState, 'microphones' | 'switchingMicrophone'>
  & Partial<Pick<SpeechClientState, 'microphones' | 'switchingMicrophone'>>

function renderSettings(inputSnapshot: SnapshotInput) {
  const snapshot: SpeechClientState = { microphones: [], switchingMicrophone: false, ...inputSnapshot }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    ensureMetadata: vi.fn(async () => {}),
  } as unknown as SpeechController
  const scope = {
    snapshot: { value: { language: 'auto', context: '' }, writable: true },
    subscribe(this: { snapshot: unknown }, _listener: () => void) {
      void this.snapshot
      return () => {}
    },
    getSnapshot(this: { snapshot: unknown }) { return this.snapshot },
    set: vi.fn(async () => {}),
  }
  return render(createElement(SpeechSettings, {
    controller,
    scope,
    getLocale: () => 'en',
    t,
    close: vi.fn(),
  } as never))
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
    expect((view.getByLabelText(en.model) as HTMLSelectElement).value).toBe('assemblyai/u3-rt-pro')
    const contextDetails = view.getByText(en.context).closest('details')
    expect(contextDetails?.open).toBe(false)
    expect(view.getByText('$1.00')).toBeTruthy()
    expect(view.queryByText(en.promotion)).toBeNull()
    expect(view.queryByText(en.usable)).toBeNull()
    expect(view.queryByText('$2.00')).toBeNull()
  })
})
