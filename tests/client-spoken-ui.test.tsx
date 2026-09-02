// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpokenSessionObserver, SpokenSummaryTail } from '../src/client/SpokenSummary.tsx'
import type { SpeechController } from '../src/client/controller.ts'
import { en, type SpeechLocaleKey } from '../src/client/locales.ts'
import type { SpokenSummaryController, SpokenMessageState } from '../src/client/spoken-controller.ts'

afterEach(cleanup)

function t(key: SpeechLocaleKey): string { return en[key] }

function scope(autoPlay = true, autoplayInlineRevealed = false, legacyAutoplayWasUsed = false, ttsEnabled = true, ready = true) {
  const set = vi.fn(async () => {})
  const snapshot = {
    status: 'ready' as const,
    value: ready ? { autoPlay, autoplayInlineRevealed, ttsEnabled } : undefined,
    base: {},
    user: ready ? (legacyAutoplayWasUsed ? { autoPlay } : {}) : undefined,
    revision: 1,
    writable: true,
    mode: 'host' as const,
  }
  return {
    set,
    value: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      set,
      unset: vi.fn(),
    },
  }
}

function renderAction(state: SpokenMessageState, autoplayInlineRevealed = false, legacyAutoplayWasUsed = false, ttsEnabled = true, settingsReady = true) {
  const controllerSnapshot = {
    phase: 'idle' as const, amplitude: 0, metadataLoading: false, microphones: [], switchingMicrophone: false,
    catalog: { fetchedAt: 1, bindings: [], ttsBindings: [{
      provider: 'deepgram', model: 'deepgram/aura-2', canonical: 'deepgram/aura-2', isProviderDefault: true, defaultVoice: 'voice', formats: ['mp3'],
    }] },
  }
  const controller = {
    getSnapshot: () => controllerSnapshot,
    subscribe: () => () => {},
    ensureMetadata: vi.fn(async () => {}),
  } as unknown as SpeechController
  const spokenSnapshot = { messages: new Map([['message', state]]) }
  const spoken = {
    getSnapshot: () => spokenSnapshot,
    subscribe: () => () => {},
    mount: vi.fn(() => () => {}),
    observeSession: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    prepare: vi.fn(async () => {}),
    retry: vi.fn(),
  } as unknown as SpokenSummaryController
  const settings = scope(true, autoplayInlineRevealed, legacyAutoplayWasUsed, ttsEnabled, settingsReady)
  const nodes = [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Request' }] },
    { kind: 'assistant', seq: 2, turn: 1, messageId: 'message', blocks: [{ kind: 'text', text: 'Answer' }], provenance: { provider: 'p', model: 'm' } },
  ]
  const props = {
    controller, spoken, scope: settings.value, getLocale: () => 'en', t,
    messageId: 'message', sessionId: 'session', useSession: (selector: (snapshot: unknown) => unknown) => selector({ nodes, turnEnds: new Map([[1, 3]]) }),
  } as unknown as ComponentProps<typeof SpokenSummaryTail>
  const view = render(<SpokenSummaryTail {...props} />)
  return { spoken, settings, ...view }
}

describe('spoken-summary UI', () => {
  it('does not observe restored answers until Harness marks the session window open', () => {
    const controllerSnapshot = {
      phase: 'idle' as const, amplitude: 0, metadataLoading: false, microphones: [], switchingMicrophone: false,
      catalog: { fetchedAt: 1, bindings: [], ttsBindings: [] },
    }
    const controller = {
      getSnapshot: () => controllerSnapshot,
      subscribe: () => () => {},
      ensureMetadata: vi.fn(async () => {}),
    } as unknown as SpeechController
    const spoken = {
      setEnabled: vi.fn(),
      observeSession: vi.fn(),
      observeInteractions: vi.fn(),
    } as unknown as SpokenSummaryController
    const sidebarPlayback = { observeCurrentSession: vi.fn() }
    const settings = scope()
    const snapshot = {
      openState: 'loading',
      pending: [{ key: 'old-question' }],
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Old request' }] },
        { kind: 'assistant', seq: 2, turn: 1, messageId: 'old-answer', blocks: [{ kind: 'text', text: 'Old answer' }], provenance: { provider: 'p', model: 'm' } },
      ],
      turnEnds: new Map([[1, 3]]),
      views: new Map(),
    }
    const props = {
      controller, spoken, scope: settings.value, getLocale: () => 'en', sidebarPlayback,
      sessionId: 'session',
      useSession: (selector: (value: typeof snapshot) => unknown) => selector(snapshot),
    } as unknown as ComponentProps<typeof SpokenSessionObserver>
    const view = render(<SpokenSessionObserver {...props} />)
    expect(spoken.observeSession).not.toHaveBeenCalled()
    expect(spoken.observeInteractions).not.toHaveBeenCalled()

    snapshot.openState = 'open'
    view.rerender(<SpokenSessionObserver {...props} />)
    expect(spoken.observeSession).toHaveBeenCalledOnce()
    expect(spoken.observeInteractions).toHaveBeenCalledOnce()
  })

  it('renders a 48-bar progress waveform and exposes pause to keyboard/button users', () => {
    const { spoken } = renderAction({
      phase: 'playing', duration: 5, progress: 2.5, peaks: Array.from({ length: 48 }, (_, index) => (index + 1) / 48), summary: 'Summary',
    })
    const button = screen.getByRole('button', { name: en.summaryPause })
    expect(document.querySelectorAll('.dsh-speech-summary-waveform i')).toHaveLength(48)
    expect(document.querySelector('.dsh-speech-summary-waveform')?.getAttribute('data-playing')).toBe('true')
    expect(document.querySelector('.dsh-speech-summary-label')).toBeNull()
    fireEvent.click(button)
    expect(spoken.pause).toHaveBeenCalledWith('message')
  })

  it.each([
    ['idle', en.summaryGenerate],
    ['preparing', en.summaryPreparing],
    ['ready', en.summaryGenerate],
    ['error', en.summaryRetry],
  ] as const)('labels the %s phase accessibly', (phase, label) => {
    renderAction({ phase, duration: 0, progress: 0, peaks: Array.from({ length: 48 }, () => 0.2), ...(phase === 'error' ? { error: 'Failed' } : {}) })
    expect(screen.getByRole('button', { name: label })).toBeDefined()
  })

  it('distinguishes prepared, paused, and completed audio without regenerating it', () => {
    const { unmount } = renderAction({ phase: 'ready', duration: 5, progress: 0, peaks: [], audioUrl: '/audio' })
    expect(screen.getByRole('button', { name: en.summaryPlay })).toBeDefined()
    expect(document.querySelector('.dsh-speech-summary-label')).toBeNull()
    unmount()
    renderAction({ phase: 'ready', duration: 5, progress: 2, peaks: [], audioUrl: '/audio' })
    expect(screen.getByRole('button', { name: en.summaryResume })).toBeDefined()
  })

  it('reveals the global autoplay toggle only after audio is prepared and writes the shared setting', () => {
    const idle = renderAction({ phase: 'idle', duration: 0, progress: 0, peaks: [] })
    expect(screen.queryByRole('switch')).toBeNull()
    idle.unmount()

    const { settings } = renderAction({ phase: 'ready', duration: 0, progress: 0, peaks: [], audioUrl: '/audio' })
    const toggle = screen.getByRole('switch', { name: `${en.autoplayInline}: ${en.autoplayOn}` })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(settings.set).toHaveBeenCalledWith('autoplayInlineRevealed', true)
    fireEvent.click(toggle)
    expect(settings.set).toHaveBeenCalledWith('autoPlay', false)
  })

  it('keeps the inline autoplay toggle visible after audio memory is released or the page reloads', () => {
    renderAction({ phase: 'idle', duration: 0, progress: 0, peaks: [] }, true)
    expect(screen.getByRole('switch', { name: `${en.autoplayInline}: ${en.autoplayOn}` })).toBeDefined()
  })

  it('migrates an explicitly used legacy autoplay setting into the durable reveal flag', () => {
    const { settings } = renderAction({ phase: 'idle', duration: 0, progress: 0, peaks: [] }, false, true)
    expect(screen.getByRole('switch', { name: `${en.autoplayInline}: ${en.autoplayOn}` })).toBeDefined()
    expect(settings.set).toHaveBeenCalledWith('autoplayInlineRevealed', true)
  })

  it('removes spoken-summary players from chat while text-to-speech summaries are globally disabled', () => {
    const view = renderAction({ phase: 'idle', duration: 0, progress: 0, peaks: [] }, false, false, false)
    expect(view.container.querySelector('.dsh-speech-summary-player')).toBeNull()
  })

  it('renders safely before the RC settings scope finishes initializing', () => {
    const view = renderAction({ phase: 'idle', duration: 0, progress: 0, peaks: [] }, false, false, true, false)
    expect(view.getByRole('button', { name: en.summaryGenerate })).toBeDefined()
  })

  it('renders from the additive finalized-assistant slot independently of turn-tail features', () => {
    const view = renderAction({ phase: 'idle', duration: 0, progress: 0, peaks: [] })
    expect(view.getByRole('button', { name: en.summaryGenerate })).toBeDefined()
  })
})
