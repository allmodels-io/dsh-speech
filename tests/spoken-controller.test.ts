// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { speechApi } from '../src/client/api.ts'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { interactionCue, SpokenSummaryController, spokenSources, type SpokenMessageSource, type SpokenPreparationSettings } from '../src/client/spoken-controller.ts'
import type { SummaryCache } from '../src/client/summary-cache.ts'

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
  play = vi.fn(async () => { this.ended = false; this.paused = false; this.onplaying?.(new Event('playing')) })
  pause = vi.fn(() => {
    const changed = !this.paused
    this.paused = true
    if (changed) this.onpause?.(new Event('pause'))
  })
  removeAttribute = vi.fn(() => { this.src = '' })
  load = vi.fn()
  captureStream?: (() => MediaStream) | undefined
}

const settings: SpokenPreparationSettings = {
  ttsEnabled: true,
  autoPlay: true,
  bindings: [{
    provider: 'deepgram', model: 'deepgram/aura-2', canonical: 'deepgram/aura-2',
    isProviderDefault: true, defaultVoice: 'voice', formats: ['mp3'],
  }],
}

function source(messageId: string, seq = 1): SpokenMessageSource {
  return { messageId, seq, request: `request ${messageId}`, answer: `answer ${messageId}`, locale: 'en', route: { provider: 'p', model: 'm' } }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(audio = new FakeAudio(), summaryCache?: SummaryCache) {
  const urls: string[] = []
  vi.stubGlobal('URL', class extends globalThis.URL {
    static createObjectURL(): string { const url = `blob:test-${String(urls.length + 1)}`; urls.push(url); return url }
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(speechApi, 'voices').mockResolvedValue({ voices: [{ id: 'voice', name: 'Voice' }], fetchedAt: 1 })
  vi.spyOn(speechApi, 'summarize').mockImplementation(async input => ({ summary: `summary ${input.answer}` }))
  vi.spyOn(speechApi, 'prepareTts').mockResolvedValue({ url: '/api/dsh-speech/tts/audio/test-token', expiresAt: Date.now() + 60_000 })
  let factoryCalls = 0
  const cache = summaryCache ?? {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    dispose: vi.fn(),
  } as unknown as SummaryCache
  const controller = new SpokenSummaryController(() => { factoryCalls += 1; return audio }, cache)
  return { audio, controller, factoryCalls: () => factoryCalls }
}

describe('browser-global spoken-summary arbitration', () => {
  it('extracts closing answer prose, nearest human context, and requestConfig before provenance', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Original request' }] },
      { kind: 'assistant', seq: 2, turn: 1, messageId: 'step', blocks: [{ kind: 'text', text: 'Tool preface' }], provenance: { provider: 'old', model: 'old' } },
      { kind: 'steering', seq: 3, messageId: 'steer', content: [{ type: 'text', text: 'Latest direction' }] },
      { kind: 'assistant', seq: 4, turn: 1, messageId: 'final', blocks: [{ kind: 'text', text: 'Final answer' }], requestConfig: { provider: 'exact', model: 'route', reasoningEffort: 'high' }, provenance: { provider: 'fallback', model: 'fallback' } },
    ] as unknown as ConversationNode[]
    expect(spokenSources(nodes, 'en', new Map([[1, 5]]))).toEqual([{
      messageId: 'final', seq: 4, request: 'Latest direction', answer: 'Final answer', locale: 'en',
      route: { provider: 'exact', model: 'route', reasoningEffort: 'high' },
    }])
  })

  it('keeps the last speakable assistant when a produced-file node closes the turn', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Create a file' }] },
      { kind: 'assistant', seq: 2, turn: 1, messageId: 'answer', blocks: [{ kind: 'text', text: 'Done. I created it.' }], provenance: { provider: 'p', model: 'm' } },
      { kind: 'assistant', seq: 3, turn: 1, messageId: 'artifact', blocks: [{ kind: 'artifact', path: '/tmp/result.txt' }], provenance: { provider: 'p', model: 'm' } },
    ] as unknown as ConversationNode[]
    expect(spokenSources(nodes, 'en', new Map([[1, 4]]))).toEqual([expect.objectContaining({
      messageId: 'answer', answer: 'Done. I created it.',
    })])
  })

  it('recovers the exact route from the read-only trajectory projection and localizes interaction cues', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Request' }] },
      { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'final', blocks: [{ kind: 'text', text: 'Answer' }] },
    ] as unknown as ConversationNode[]
    const requests = [{
      purpose: 'assistant', turn: 1, step: 1, startSeq: 1, startedAt: 1, completedAt: 2, status: 'complete', resultSeq: 2,
      requestConfig: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    }] as never
    expect(spokenSources(nodes, 'en', new Map([[1, 3]]), requests)[0]?.route).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high',
    })
    expect(interactionCue('zh-CN')).toBe('我需要你的反馈才能继续。')
    expect(interactionCue('ja-JP')).toContain('フィードバック')
  })

  it('does not expose an assistant message as a spoken source before its turn ends', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Do several things' }] },
      { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'intermediate', blocks: [{ kind: 'text', text: 'I will call a tool now.' }], provenance: { provider: 'p', model: 'm' } },
    ] as unknown as ConversationNode[]
    expect(spokenSources(nodes, 'en', new Map())).toEqual([])
    expect(spokenSources(nodes, 'en', new Map([[1, 3]]))).toEqual([
      expect.objectContaining({ messageId: 'intermediate', seq: 2 }),
    ])
  })

  it('waits through intermediate agent-loop prose and prepares only the completed turn answer', async () => {
    const target = setup()
    target.controller.observeSession('session-a', [], settings)
    const intermediate = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Do several things' }] },
      { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'intermediate', blocks: [{ kind: 'text', text: 'I am checking that now.' }], provenance: { provider: 'p', model: 'm' } },
    ] as unknown as ConversationNode[]
    target.controller.observeSession('session-a', spokenSources(intermediate, 'en', new Map()), settings)
    await settle()
    expect(speechApi.summarize).not.toHaveBeenCalled()

    const completed = [
      ...intermediate,
      { kind: 'assistant', seq: 4, turn: 1, step: 2, messageId: 'final', blocks: [{ kind: 'text', text: 'Everything is finished.' }], provenance: { provider: 'p', model: 'm' } },
    ] as unknown as ConversationNode[]
    target.controller.observeSession('session-a', spokenSources(completed, 'en', new Map([[1, 5]])), settings)
    await settle()
    expect(speechApi.summarize).toHaveBeenCalledOnce()
    expect(speechApi.summarize).toHaveBeenCalledWith(expect.objectContaining({ answer: 'Everything is finished.' }), expect.any(AbortSignal))
    expect(target.controller.getSnapshot().activeMessageId).toBe('final')
  })

  it('creates one audio element, seeds existing history, and prepares each new answer once', async () => {
    const target = setup()
    target.controller.observeSession('session-a', [source('old')], settings)
    await settle()
    expect(speechApi.summarize).not.toHaveBeenCalled()

    target.controller.observeSession('session-a', [source('old'), source('new', 2)], settings)
    target.controller.observeSession('session-a', [source('old'), source('new', 2)], settings)
    await settle()
    expect(target.factoryCalls()).toBe(1)
    expect(speechApi.summarize).toHaveBeenCalledOnce()
    expect(target.controller.getSnapshot().messages.get('new')?.phase).toBe('playing')
    expect(target.controller.getSnapshot().activeSessionKey).toBe('session-a')
  })

  it('reuses a cached summary without calling the LLM and still synthesizes the selected voice', async () => {
    const summaryCache = {
      get: vi.fn(async () => 'Previously prepared summary'),
      set: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      dispose: vi.fn(),
    } as unknown as SummaryCache
    const target = setup(new FakeAudio(), summaryCache)
    await target.controller.prepare(source('cached'), settings, false)

    expect(summaryCache.get).toHaveBeenCalledOnce()
    expect(summaryCache.set).not.toHaveBeenCalled()
    expect(speechApi.summarize).not.toHaveBeenCalled()
    expect(speechApi.prepareTts).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Previously prepared summary', voice: 'voice',
    }), expect.any(AbortSignal))
  })

  it('never autoplays refreshed history or older answers introduced by pagination', async () => {
    const target = setup()
    target.controller.observeSession('session-a', [source('latest', 20)], settings)
    target.controller.observeSession('session-a', [source('older', 10), source('latest', 20)], settings)
    await settle()
    expect(speechApi.summarize).not.toHaveBeenCalled()
    expect(target.audio.play).not.toHaveBeenCalled()

    target.controller.observeSession('session-a', [source('older', 10), source('latest', 20), source('new', 21)], settings)
    await settle()
    expect(speechApi.summarize).toHaveBeenCalledOnce()
    expect(target.audio.play).toHaveBeenCalledOnce()
  })

  it('does not autoplay or queue another session while one summary is playing, but explicit Play preempts it', async () => {
    const target = setup()
    target.controller.observeSession('session-a', [], settings)
    target.controller.observeSession('session-a', [source('a')], settings)
    await settle()
    expect(target.controller.getSnapshot().activeMessageId).toBe('a')

    target.controller.observeSession('session-b', [], settings)
    target.controller.observeSession('session-b', [source('b')], settings)
    await settle()
    expect(target.controller.getSnapshot().messages.get('b')?.phase).toBe('ready')
    expect(target.audio.play).toHaveBeenCalledTimes(1)

    target.audio.onended?.(new Event('ended'))
    await settle()
    expect(target.audio.play).toHaveBeenCalledTimes(1)
    expect(target.controller.getSnapshot().messages.get('b')?.phase).toBe('ready')

    await target.controller.play('b', true)
    expect(target.controller.getSnapshot().activeMessageId).toBe('b')
    expect(target.controller.getSnapshot().activeSessionKey).toBe('session-b')
    expect(target.audio.play).toHaveBeenCalledTimes(2)
  })

  it('never autoplays a message again after playback has successfully begun', async () => {
    const target = setup()
    const unmount = target.controller.mount('a')
    target.controller.observeSession('session-a', [], settings)
    target.controller.observeSession('session-a', [source('a')], settings)
    await settle()
    expect(target.audio.play).toHaveBeenCalledOnce()

    target.audio.onended?.(new Event('ended'))
    unmount()
    await settle()
    expect(target.controller.getSnapshot().messages.has('a')).toBe(false)

    await target.controller.prepare(source('a'), settings, true)
    expect(target.audio.play).toHaveBeenCalledOnce()
    expect(target.controller.getSnapshot().messages.get('a')?.phase).toBe('ready')

    await target.controller.play('a', true)
    expect(target.audio.play).toHaveBeenCalledTimes(2)
  })

  it('marks playback consumed on the playing event even when pause beats play promise settlement', async () => {
    const audio = new FakeAudio()
    let resolvePlay: (() => void) | undefined
    audio.play.mockImplementationOnce(() => {
      audio.paused = false
      audio.onplaying?.(new Event('playing'))
      return new Promise<void>(resolve => { resolvePlay = resolve })
    })
    const target = setup(audio)
    const unmount = target.controller.mount('a')
    await target.controller.prepare(source('a'), settings, false)
    const playback = target.controller.play('a', true)
    target.controller.pause('a')
    resolvePlay?.()
    await playback
    unmount()
    await settle()

    await target.controller.prepare(source('a'), settings, true)
    expect(audio.play).toHaveBeenCalledOnce()
    expect(target.controller.getSnapshot().messages.get('a')?.phase).toBe('ready')
  })

  it('generation-fences stale play promises and stale ended events', async () => {
    const audio = new FakeAudio()
    let resolveFirst: (() => void) | undefined
    audio.play
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve }))
      .mockImplementation(async () => {})
    const target = setup(audio)
    await target.controller.prepare(source('a'), settings, false)
    await target.controller.prepare(source('b'), settings, false)
    const first = target.controller.play('a', true)
    const staleEnded = audio.onended
    await target.controller.play('b', true)
    resolveFirst?.()
    await first
    staleEnded?.(new Event('ended'))
    expect(target.controller.getSnapshot().activeMessageId).toBe('b')
    expect(target.controller.getSnapshot().messages.get('b')?.phase).toBe('playing')
  })

  it('resumes a paused summary from the same loaded stream without fetching it again', async () => {
    const target = setup()
    await target.controller.prepare(source('a'), settings, false)
    await target.controller.play('a', true)
    target.audio.currentTime = 2
    target.audio.ontimeupdate?.(new Event('timeupdate'))
    target.controller.pause('a')

    expect(target.controller.getSnapshot().messages.get('a')).toMatchObject({ phase: 'ready', progress: 2 })
    expect(target.controller.getSnapshot().activeSessionKey).toBeUndefined()
    expect(target.audio.src).toBe('/api/dsh-speech/tts/audio/test-token')
    const sourceWrites = target.audio.removeAttribute.mock.calls.length

    await target.controller.play('a', true)
    expect(target.audio.currentTime).toBe(2)
    expect(target.audio.removeAttribute).toHaveBeenCalledTimes(sourceWrites)
    expect(target.audio.play).toHaveBeenCalledTimes(2)
  })

  it('lets the terminal ended event win when the browser dispatches pause first', async () => {
    vi.useFakeTimers()
    const target = setup()
    await target.controller.prepare(source('a'), settings, false)
    await target.controller.play('a', true)
    target.audio.currentTime = target.audio.duration
    target.audio.ended = true
    target.audio.onpause?.(new Event('pause'))
    target.audio.onended?.(new Event('ended'))
    await vi.advanceTimersByTimeAsync(100)
    expect(target.controller.getSnapshot().messages.get('a')).toMatchObject({
      phase: 'ready', ended: true, progress: target.audio.duration,
    })
  })

  it('keeps the waveform moving on explicit play and replay when captured audio is flat', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const contexts: Array<{ close: ReturnType<typeof vi.fn> }> = []
    class SilentAudioContext {
      close = vi.fn(async () => {})
      resume = vi.fn(async () => {})
      constructor() { contexts.push(this) }
      createAnalyser(): AnalyserNode {
        return {
          fftSize: 128,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (data: Uint8Array) => { data.fill(128) },
        } as unknown as AnalyserNode
      }
      createMediaStreamSource(): MediaStreamAudioSourceNode {
        return { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode
      }
    }
    vi.stubGlobal('AudioContext', SilentAudioContext)
    const audio = new FakeAudio()
    audio.captureStream = vi.fn(() => ({} as MediaStream))
    const target = setup(audio)
    await target.controller.prepare(source('a'), settings, false)

    await target.controller.play('a', true)
    expect(target.controller.getSnapshot().activeSessionKey).toBeUndefined()
    callbacks.shift()?.(100)
    const first = target.controller.getSnapshot().messages.get('a')?.peaks
    callbacks.shift()?.(160)
    const second = target.controller.getSnapshot().messages.get('a')?.peaks
    expect(first).not.toEqual(second)

    audio.onended?.(new Event('ended'))
    callbacks.length = 0
    await target.controller.play('a', true)
    callbacks.shift()?.(240)
    const replay = target.controller.getSnapshot().messages.get('a')?.peaks
    callbacks.shift()?.(300)
    expect(replay).not.toEqual(target.controller.getSnapshot().messages.get('a')?.peaks)
    expect(contexts).toHaveLength(2)
    expect(contexts[0]?.close).toHaveBeenCalledOnce()
  })

  it('falls back to ready when autoplay is blocked and releases resources on unmount/disposal', async () => {
    const audio = new FakeAudio()
    audio.play.mockRejectedValueOnce(new Error('NotAllowedError'))
    const target = setup(audio)
    const release = target.controller.mount('a')
    target.controller.observeSession('session-a', [], settings)
    target.controller.observeSession('session-a', [source('a')], settings)
    await settle()
    expect(target.controller.getSnapshot().activeMessageId).toBeUndefined()
    expect(target.controller.getSnapshot().messages.get('a')?.phase).toBe('ready')
    release()
    await settle()
    expect(target.controller.getSnapshot().messages.has('a')).toBe(false)
    target.controller.dispose()
    expect(audio.removeAttribute).toHaveBeenCalled()
  })

  it('speaks each newly observed interaction once in the selected language without creating another audio element', async () => {
    const target = setup()
    target.controller.observeInteractions('session-a', [], 'zh-CN', settings)
    target.controller.observeInteractions('session-a', ['question:1'], 'zh-CN', settings)
    target.controller.observeInteractions('session-a', ['question:1'], 'zh-CN', settings)
    await settle()
    expect(speechApi.prepareTts).toHaveBeenCalledOnce()
    expect(speechApi.prepareTts).toHaveBeenCalledWith(expect.objectContaining({ text: '我需要你的反馈才能继续。' }), expect.any(AbortSignal))
    expect(target.factoryCalls()).toBe(1)
    expect(target.audio.play).toHaveBeenCalledOnce()
  })

  it('does not speak a pending interaction that was already present when a session opened', async () => {
    const target = setup()
    target.controller.observeInteractions('session-a', ['question:old'], 'en', settings)
    await settle()
    expect(speechApi.prepareTts).not.toHaveBeenCalled()
    expect(target.audio.play).not.toHaveBeenCalled()
  })

  it('stops active audio and suppresses summaries and interaction cues while globally disabled', async () => {
    const target = setup()
    target.controller.observeSession('session-a', [], settings)
    target.controller.observeSession('session-a', [source('a')], settings)
    await settle()
    expect(target.controller.getSnapshot().activeMessageId).toBe('a')

    const disabled = { ...settings, ttsEnabled: false }
    target.controller.observeSession('session-a', [source('a'), source('b', 2)], disabled)
    target.controller.observeInteractions('session-a', ['question:disabled'], 'en', disabled)
    await settle()
    expect(target.controller.getSnapshot().activeMessageId).toBeUndefined()
    expect(target.controller.getSnapshot().messages.get('a')?.phase).toBe('idle')
    expect(target.controller.getSnapshot().messages.get('a')?.audioUrl).toBeUndefined()
    expect(speechApi.summarize).toHaveBeenCalledTimes(1)
    expect(speechApi.prepareTts).toHaveBeenCalledTimes(1)

    target.controller.observeSession('session-a', [source('a'), source('b', 2)], settings)
    target.controller.observeInteractions('session-a', ['question:disabled'], 'en', settings)
    await settle()
    expect(speechApi.summarize).toHaveBeenCalledTimes(1)
    expect(speechApi.prepareTts).toHaveBeenCalledTimes(1)
  })
})
