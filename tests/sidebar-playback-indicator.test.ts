// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { speechApi } from '../src/client/api.ts'
import { SidebarPlaybackIndicator } from '../src/client/sidebar-playback-indicator.ts'
import { SpokenSummaryController, type SpokenMessageSource, type SpokenPreparationSettings } from '../src/client/spoken-controller.ts'

class FakeAudio {
  src = ''
  currentTime = 0
  duration = 5
  ended = false
  paused = true
  preload = ''
  onplaying: ((event: Event) => void) | null = null
  onended: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onpause: ((event: Event) => void) | null = null
  ontimeupdate: ((event: Event) => void) | null = null
  play = vi.fn(async () => { this.paused = false; this.onplaying?.(new Event('playing')) })
  pause = vi.fn(() => { this.paused = true })
  removeAttribute = vi.fn()
  load = vi.fn()
}

const settings: SpokenPreparationSettings = {
  ttsEnabled: true,
  autoPlay: false,
  bindings: [{
    provider: 'deepgram', model: 'deepgram/aura-2', canonical: 'deepgram/aura-2',
    isProviderDefault: true, defaultVoice: 'voice', formats: ['mp3'],
  }],
}

function source(messageId: string): SpokenMessageSource {
  return { messageId, seq: 1, request: 'request', answer: 'answer', locale: 'en', route: { provider: 'p', model: 'm' } }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('sidebar playback indicator', () => {
  it('follows the audio-owning session and clears on pause', async () => {
    vi.spyOn(speechApi, 'voices').mockResolvedValue({ voices: [{ id: 'voice', name: 'Voice' }], fetchedAt: 1 })
    vi.spyOn(speechApi, 'summarize').mockResolvedValue({ summary: 'summary' })
    vi.spyOn(speechApi, 'prepareTts').mockResolvedValue({ url: '/audio', expiresAt: Date.now() + 60_000 })

    const first = document.createElement('div')
    first.setAttribute('role', 'treeitem')
    first.setAttribute('aria-selected', 'true')
    first.textContent = 'First session'
    const second = document.createElement('div')
    second.setAttribute('role', 'treeitem')
    second.setAttribute('aria-selected', 'false')
    second.textContent = 'Second session'
    document.body.append(first, second)

    const audio = new FakeAudio()
    const spoken = new SpokenSummaryController(() => audio)
    const indicator = new SidebarPlaybackIndicator(spoken)
    spoken.observeSession('session-a', [source('a')], settings)
    indicator.observeCurrentSession('session-a')
    await spoken.prepare(source('a'), settings)
    await spoken.play('a', true)
    await settle()

    expect(first.querySelector('[aria-label="Playing spoken summary"]')).not.toBeNull()
    expect(second.querySelector('[aria-label="Playing spoken summary"]')).toBeNull()

    first.setAttribute('aria-selected', 'false')
    second.setAttribute('aria-selected', 'true')
    indicator.observeCurrentSession('session-b')
    await settle()
    expect(first.querySelector('[aria-label="Playing spoken summary"]')).not.toBeNull()

    spoken.pause('a')
    await settle()
    expect(document.querySelector('.dsh-speech-sidebar-playing')).toBeNull()

    indicator.dispose()
    spoken.dispose()
  })

  it('moves to the explicitly selected session when playback is preempted', async () => {
    vi.spyOn(speechApi, 'voices').mockResolvedValue({ voices: [{ id: 'voice', name: 'Voice' }], fetchedAt: 1 })
    vi.spyOn(speechApi, 'summarize').mockResolvedValue({ summary: 'summary' })
    vi.spyOn(speechApi, 'prepareTts').mockResolvedValue({ url: '/audio', expiresAt: Date.now() + 60_000 })

    const first = document.createElement('div')
    first.setAttribute('role', 'treeitem')
    first.setAttribute('aria-selected', 'true')
    const second = document.createElement('div')
    second.setAttribute('role', 'treeitem')
    second.setAttribute('aria-selected', 'false')
    document.body.append(first, second)

    const spoken = new SpokenSummaryController(() => new FakeAudio())
    const indicator = new SidebarPlaybackIndicator(spoken)
    spoken.observeSession('session-a', [source('a')], settings)
    indicator.observeCurrentSession('session-a')
    await spoken.prepare(source('a'), settings)
    await spoken.play('a', true)

    first.setAttribute('aria-selected', 'false')
    second.setAttribute('aria-selected', 'true')
    spoken.observeSession('session-b', [source('b')], settings)
    indicator.observeCurrentSession('session-b')
    await spoken.prepare(source('b'), settings)
    await spoken.play('b', true)
    await settle()

    expect(first.querySelector('.dsh-speech-sidebar-playing')).toBeNull()
    expect(second.querySelector('.dsh-speech-sidebar-playing')).not.toBeNull()

    indicator.dispose()
    spoken.dispose()
  })
})
