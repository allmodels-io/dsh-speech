// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechDock, SpeechInputDock, SpeechMic } from '../src/client/SpeechComposer.tsx'
import type { SpeechController, SpeechClientState } from '../src/client/controller.ts'
import { en, type SpeechLocaleKey } from '../src/client/locales.ts'
import { STYLE_TEXT } from '../src/client/styles.ts'

afterEach(cleanup)

function t(key: SpeechLocaleKey, params?: Record<string, unknown>): string {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

type SnapshotInput = Omit<SpeechClientState, 'microphones' | 'switchingMicrophone'>
  & Partial<Pick<SpeechClientState, 'microphones' | 'switchingMicrophone'>>

function withMicrophones(snapshot: SnapshotInput): SpeechClientState {
  return { microphones: [], switchingMicrophone: false, ...snapshot }
}

function renderMic(inputSnapshot: SnapshotInput) {
  const snapshot = withMicrophones(inputSnapshot)
  const toggle = vi.fn(async () => {})
  const cancel = vi.fn()
  const reportError = vi.fn()
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    ensureMetadata: vi.fn(async () => {}),
    release: vi.fn(),
    toggle,
    cancel,
    reportError,
  } as unknown as SpeechController
  const inputActions = { setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn() }
  const props = {
    controller,
    getLocale: () => 'en',
    sessionId: 'session-1',
    input: { draft: 'Existing draft', phase: 'plain' },
    inputActions,
    t,
    useSession: vi.fn(), useProjection: vi.fn(), useSessions: vi.fn(), useWorkspaces: vi.fn(),
  }
  return { ...render(createElement(SpeechMic, props as never)), toggle, cancel, reportError, inputActions }
}

function renderDock(inputSnapshot: SnapshotInput, showMetrics = true) {
  const snapshot = withMicrophones(inputSnapshot)
  const switchMicrophone = vi.fn(async () => {})
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    switchMicrophone,
  } as unknown as SpeechController
  const dock = createElement(SpeechDock, {
      controller,
      getLocale: () => 'en',
      sessionId: 'session-1',
      t,
      useSession: vi.fn(), useProjection: vi.fn(), useSessions: vi.fn(), useWorkspaces: vi.fn(),
    } as never)
  const view = render(createElement('div', { 'data-slot': 'conversation.composer.dock' },
    showMetrics ? createElement('div', {}, '1 turns · 1 steps | LLM 1.6s | TTFT avg 0.9s') : null,
    dock,
  ))
  return { ...view, switchMicrophone }
}

function renderInputDock(inputSnapshot: SnapshotInput, showComposerDock = false) {
  const snapshot = withMicrophones(inputSnapshot)
  const switchMicrophone = vi.fn(async () => {})
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    switchMicrophone,
  } as unknown as SpeechController
  const dock = createElement(SpeechInputDock, {
    controller,
    getLocale: () => 'en',
    sessionId: 'session-1',
    t,
    useSession: vi.fn(), useProjection: vi.fn(), useSessions: vi.fn(), useWorkspaces: vi.fn(),
  } as never)
  const view = render(createElement('div', { 'data-slot': 'conversation.composer' },
    createElement('div', { className: 'hero-controls' },
      createElement('div', { 'data-slot': 'conversation.hero.agentPreset' },
        createElement('button', { type: 'button' }, 'Creator mode'),
      ),
    ),
    createElement('div', { 'data-slot': 'conversation.input.dock' }, dock),
    showComposerDock ? createElement('div', { 'data-slot': 'conversation.composer.dock' }) : null,
  ))
  return { ...view, switchMicrophone }
}

describe('composer microphone', () => {
  it('removes the microphone selector and its separator at the mobile breakpoint', () => {
    expect(STYLE_TEXT).toContain('@media(max-width:680px)')
    expect(STYLE_TEXT).toContain('.dsh-speech-device-separator,.dsh-speech-device-dock{display:none}')
  })

  it('stays explainable and directs disconnected users to Speech settings', () => {
    const view = renderMic({ phase: 'idle', amplitude: 0, metadataLoading: false, status: {
      credential: { configured: false, writable: true },
      settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
    } })
    const button = view.getByRole('button') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(view.getByRole('tooltip').textContent).toBe(en.disconnectedMic)
    fireEvent.click(button)
    expect(view.reportError).toHaveBeenCalledWith(en.disconnectedMic)
    expect(view.toggle).not.toHaveBeenCalled()
    expect((button.parentElement as HTMLElement).dataset.explanationOpen).toBe('true')
  })

  it('starts with the existing draft and never invokes submit', () => {
    const view = renderMic({ phase: 'idle', amplitude: 0, metadataLoading: false, status: {
      credential: { configured: true, writable: true },
      settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      balance: { paidUsd: 1, promotionUsd: 0, usableUsd: 1, low: false, exhausted: false, fetchedAt: 1 },
    } })
    fireEvent.click(view.getByRole('button'))
    expect(view.toggle).toHaveBeenCalledWith(expect.objectContaining({ draft: 'Existing draft', locale: 'en' }))
    expect(view.inputActions.submit).not.toHaveBeenCalled()
  })

  it('replaces the composer footer with a full-width scrolling waveform while recording', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const view = renderMic({
      phase: 'recording',
      activeSessionId: 'session-1' as never,
      amplitude: 0.8,
      metadataLoading: false,
      status: {
        credential: { configured: true, writable: true },
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
        balance: { paidUsd: 1, promotionUsd: 0, usableUsd: 1, low: false, exhausted: false, fetchedAt: 1 },
      },
    })

    const takeover = view.container.querySelector('.dsh-speech-recording-takeover')
    expect(takeover).toBeTruthy()
    expect(takeover?.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
    const cancel = view.getByRole('button', { name: en.micCancel })
    expect(cancel).toBeTruthy()
    expect(takeover?.firstElementChild).toBe(cancel)
    expect(view.getByRole('button', { name: en.micStop })).toBeTruthy()
  })

  it('cancels an active recording without invoking Stop', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const view = renderMic({
      phase: 'recording',
      activeSessionId: 'session-1' as never,
      amplitude: 0.4,
      metadataLoading: false,
    })

    fireEvent.click(view.getByRole('button', { name: en.micCancel }))
    expect(view.cancel).toHaveBeenCalledOnce()
    expect(view.toggle).not.toHaveBeenCalled()
  })

  it('shows preparation status without starting the waveform before capture is ready', () => {
    const view = renderMic({
      phase: 'starting',
      activeSessionId: 'session-1' as never,
      amplitude: 0,
      metadataLoading: false,
      status: {
        credential: { configured: true, writable: true },
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      },
    })

    expect(view.container.querySelector('.dsh-speech-recording-canvas')).toBeNull()
    expect(view.container.querySelector('[data-phase="starting"]')).toBeTruthy()
    expect(view.getAllByRole('status').some(node => node.textContent === en.starting)).toBe(true)
    expect(view.queryByRole('button', { name: en.micStop })).toBeNull()
  })

  it('replaces the waveform with finalizing status after Stop', () => {
    const view = renderMic({
      phase: 'finalizing',
      activeSessionId: 'session-1' as never,
      amplitude: 0,
      metadataLoading: false,
      status: {
        credential: { configured: true, writable: true },
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      },
    })

    expect(view.container.querySelector('.dsh-speech-recording-canvas')).toBeNull()
    expect(view.getAllByRole('status').some(node => node.textContent === en.finalizing)).toBe(true)
    expect(view.queryByRole('button', { name: en.micStop })).toBeNull()
  })

  it('shows the microphone selector only during recording and switches the active capture', () => {
    const view = renderDock({
      phase: 'recording',
      activeSessionId: 'session-1' as never,
      amplitude: 0.2,
      metadataLoading: false,
      activeMicrophoneId: 'built-in',
      microphones: [
        { deviceId: 'built-in', label: 'MacBook Microphone' },
        { deviceId: 'usb', label: 'USB Microphone' },
      ],
    })

    const trigger = view.getByRole('button', { name: `${en.microphone}: MacBook Microphone` })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(view.getByRole('menuitemradio', { name: 'USB Microphone' }))
    expect(view.switchMicrophone).toHaveBeenCalledWith('usb')
  })

  it('finds an existing-session metrics row when TTFT text renders after the dock', async () => {
    const view = renderDock({
      phase: 'recording',
      activeSessionId: 'session-1' as never,
      amplitude: 0.2,
      metadataLoading: false,
      activeMicrophoneId: 'built-in',
      microphones: [{ deviceId: 'built-in', label: 'MacBook Microphone' }],
    }, false)

    const slot = view.container.querySelector('[data-slot="conversation.composer.dock"]')
    const metrics = document.createElement('div')
    const metricsText = document.createTextNode('Loading metrics')
    metrics.append(metricsText)
    slot?.append(metrics)
    metricsText.data = '1 turns · 1 steps | LLM 1.6s | TTFT avg 0.9s'

    await waitFor(() => {
      expect(view.getByRole('button', { name: `${en.microphone}: MacBook Microphone` })).toBeTruthy()
    })
    expect(metrics.querySelector('.dsh-speech-device-separator')?.textContent).toBe('|')
  })

  it('shows the hero-sized microphone selector beside the mode control on a new chat', () => {
    const view = renderInputDock({
      phase: 'recording',
      activeSessionId: 'session-1' as never,
      amplitude: 0.2,
      metadataLoading: false,
      activeMicrophoneId: '',
      microphones: [
        { deviceId: '', label: 'System default', systemDefault: true },
        { deviceId: 'usb', label: 'USB Microphone' },
      ],
    })

    const trigger = view.getByRole('button', { name: `${en.microphone}: ${en.systemDefaultMicrophone}` })
    expect(trigger.closest('.hero-controls')).toBeTruthy()
    expect(trigger.closest('.dsh-speech-device-dock')?.getAttribute('data-variant')).toBe('hero')
  })

  it('does not duplicate the selector in the input dock once the regular composer dock exists', () => {
    const view = renderInputDock({
      phase: 'recording',
      activeSessionId: 'session-1' as never,
      amplitude: 0.2,
      metadataLoading: false,
      activeMicrophoneId: '',
      microphones: [{ deviceId: '', label: 'System default', systemDefault: true }],
    }, true)

    expect(view.queryByRole('button', { name: `${en.microphone}: ${en.systemDefaultMicrophone}` })).toBeNull()
  })

  it('hides the microphone selector outside an active recording', () => {
    const view = renderDock({ phase: 'idle', amplitude: 0, metadataLoading: false })
    expect(view.queryByRole('button', { name: new RegExp(`^${en.microphone}:`) })).toBeNull()
  })
})
