// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechController } from '../src/client/controller.ts'
import { createTranscript } from '../src/shared.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('recording stop latency', () => {
  it('commits and closes the STT stream before audio-context shutdown finishes', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 })
    let finishAudioStop: (() => void) | undefined
    const captureStop = vi.fn(() => new Promise<void>(resolve => { finishAudioStop = resolve }))
    const send = vi.fn()
    const controller = new SpeechController()
    const active = {
      sessionId: 'session-1',
      draft: '',
      inputActions: { setDraft: vi.fn() },
      locale: 'en',
      listeningReason: 'Listening',
      socket: { readyState: 1, send },
      capture: { stop: captureStop },
      transcript: createTranscript(''),
      finished: false,
    }
    ;(controller as unknown as { active: typeof active }).active = active

    const stopping = controller.stop()

    expect(captureStop).toHaveBeenCalledOnce()
    expect(send.mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([
      { type: 'commit' },
      { type: 'close' },
    ])
    expect(finishAudioStop).toBeDefined()
    finishAudioStop?.()
    await stopping
    if ('finalTimer' in active && typeof active.finalTimer === 'number') clearTimeout(active.finalTimer)
  })
})
