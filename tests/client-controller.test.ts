// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechController } from '../src/client/controller.ts'
import { createTranscript } from '../src/shared.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('recording stop latency', () => {
  it('accepts a microphone choice while capture is still preparing', async () => {
    const switchMicrophone = vi.fn()
    const controller = new SpeechController()
    const active = {
      sessionId: 'session-1',
      draft: '',
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
      locale: 'en',
      listeningReason: 'Listening',
      socket: {},
      capture: { switchMicrophone },
      transcript: createTranscript(''),
      finished: false,
      captureReady: false,
      desiredMicrophoneId: '',
    }
    ;(controller as unknown as { active: typeof active }).active = active
    ;(controller as unknown as { snapshot: Record<string, unknown> }).snapshot = {
      ...controller.getSnapshot(),
      phase: 'starting',
      activeSessionId: 'session-1',
      microphones: [
        { deviceId: '', label: 'System default', systemDefault: true },
        { deviceId: 'usb', label: 'USB Microphone' },
      ],
      activeMicrophoneId: '',
    }

    await controller.switchMicrophone('usb')

    expect(active.desiredMicrophoneId).toBe('usb')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'starting',
      activeMicrophoneId: 'usb',
      switchingMicrophone: false,
    })
    expect(switchMicrophone).not.toHaveBeenCalled()
  })

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
    ;(controller as unknown as { active: unknown }).active = active

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

  it('finalizes and submits exactly once when the recording Send arrow is used', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 })
    const setDraft = vi.fn()
    const submit = vi.fn()
    const send = vi.fn()
    const close = vi.fn()
    const captureStop = vi.fn(async () => {})
    const clearBlock = vi.fn()
    const controller = new SpeechController()
    const active = {
      sessionId: 'session-1',
      draft: '',
      inputActions: { setDraft, submit },
      locale: 'en',
      listeningReason: 'Listening',
      socket: { readyState: 1, send, close },
      capture: { stop: captureStop },
      transcript: createTranscript(''),
      finished: false,
    }
    ;(controller as unknown as { active: typeof active }).active = active
    ;(controller as unknown as { snapshot: Record<string, unknown> }).snapshot = {
      ...controller.getSnapshot(), phase: 'recording', activeSessionId: 'session-1', hasTranscript: true,
    }
    controller.attachBlocks({ set: clearBlock })

    await controller.stopAndSend()
    expect(submit).not.toHaveBeenCalled()
    expect(send.mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([
      { type: 'commit' },
      { type: 'close' },
    ])

    ;(controller as unknown as { finish(active: unknown): void }).finish(active)
    ;(controller as unknown as { finish(active: unknown): void }).finish(active)
    expect(clearBlock).toHaveBeenCalledWith('session-1', undefined)
    expect(submit).toHaveBeenCalledOnce()
    expect(clearBlock.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]!)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', hasTranscript: false })
  })

  it('does not submit from finish-and-send when finalization fails', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 })
    const submit = vi.fn()
    const controller = new SpeechController()
    const active = {
      sessionId: 'session-1',
      draft: '',
      inputActions: { setDraft: vi.fn(), submit },
      locale: 'en',
      listeningReason: 'Listening',
      socket: { readyState: 2, send: vi.fn(), close: vi.fn() },
      capture: { stop: vi.fn(async () => {}) },
      transcript: createTranscript(''),
      finished: false,
      sendAfterFinish: true,
    }
    ;(controller as unknown as { active: unknown }).active = active
    ;(controller as unknown as { finish(active: unknown, error?: string): void }).finish(active, 'Provider failed')
    expect(submit).not.toHaveBeenCalled()
    expect(controller.getSnapshot().phase).toBe('error')
  })

  it('cancels without committing and restores the exact pre-recording draft', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 })
    const setDraft = vi.fn()
    const send = vi.fn()
    const close = vi.fn()
    const captureStop = vi.fn(async () => {})
    const clearBlock = vi.fn()
    const controller = new SpeechController()
    const active = {
      sessionId: 'session-1',
      draft: 'Exact existing draft',
      inputActions: { setDraft },
      locale: 'en',
      listeningReason: 'Listening',
      socket: { readyState: 1, send, close },
      capture: { stop: captureStop },
      transcript: createTranscript('Exact existing draft'),
      finished: false,
    }
    ;(controller as unknown as { active: typeof active }).active = active
    controller.attachBlocks({ set: clearBlock })

    controller.cancel()

    expect(setDraft).toHaveBeenCalledOnce()
    expect(setDraft).toHaveBeenCalledWith('Exact existing draft')
    expect(send.mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([{ type: 'close' }])
    expect(send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'commit' }))
    expect(captureStop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(1000, 'recording complete')
    expect(clearBlock).toHaveBeenCalledWith('session-1', undefined)
    expect(controller.getSnapshot().phase).toBe('idle')
  })
})
