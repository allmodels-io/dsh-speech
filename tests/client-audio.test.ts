// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioCapture } from '../src/client/audio.ts'

afterEach(() => { vi.unstubAllGlobals() })

function track(deviceId: string, label: string) {
  return {
    label,
    getSettings: () => ({ deviceId }),
    stop: vi.fn(),
  }
}

describe('live microphone selection', () => {
  it('enumerates labeled audio inputs after capture starts', async () => {
    const activeTrack = track('built-in', 'MacBook Microphone')
    vi.stubGlobal('navigator', { mediaDevices: {
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'built-in', label: 'MacBook Microphone' },
        { kind: 'audioinput', deviceId: 'usb', label: 'USB Microphone' },
        { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
      ]),
    } })
    const capture = new AudioCapture()
    Object.assign(capture, { stream: { getAudioTracks: () => [activeTrack] }, selectedDeviceId: 'built-in' })

    await expect(capture.microphones()).resolves.toEqual({
      activeDeviceId: 'built-in',
      devices: [
        { deviceId: '', label: 'System default', systemDefault: true },
        { deviceId: 'built-in', label: 'MacBook Microphone' },
        { deviceId: 'usb', label: 'USB Microphone' },
      ],
    })
  })

  it('reconnects the worklet to a new input before stopping the previous track', async () => {
    const previousTrack = track('built-in', 'MacBook Microphone')
    const nextTrack = track('usb', 'USB Microphone')
    const previousSource = { disconnect: vi.fn() }
    const nextSource = { connect: vi.fn() }
    const worklet = {}
    const nextStream = {
      getAudioTracks: () => [nextTrack],
      getTracks: () => [nextTrack],
    }
    const getUserMedia = vi.fn(async () => nextStream)
    vi.stubGlobal('navigator', { mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'built-in', label: 'MacBook Microphone' },
        { kind: 'audioinput', deviceId: 'usb', label: 'USB Microphone' },
      ]),
    } })
    const capture = new AudioCapture()
    Object.assign(capture, {
      context: { createMediaStreamSource: vi.fn(() => nextSource) },
      worklet,
      source: previousSource,
      stream: {
        getAudioTracks: () => [previousTrack],
        getTracks: () => [previousTrack],
      },
    })

    const result = await capture.switchMicrophone('usb')

    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ deviceId: { exact: 'usb' } }) })
    expect(nextSource.connect).toHaveBeenCalledWith(worklet)
    expect(previousSource.disconnect).toHaveBeenCalledOnce()
    expect(previousTrack.stop).toHaveBeenCalledOnce()
    expect(nextTrack.stop).not.toHaveBeenCalled()
    expect(result.activeDeviceId).toBe('usb')
  })

  it('offers and can switch back to the system-default input', async () => {
    const previousTrack = track('usb', 'USB Microphone')
    const defaultTrack = track('built-in', 'MacBook Microphone')
    const nextSource = { connect: vi.fn() }
    const getUserMedia = vi.fn(async () => ({
      getAudioTracks: () => [defaultTrack],
      getTracks: () => [defaultTrack],
    }))
    vi.stubGlobal('navigator', { mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'built-in', label: 'MacBook Microphone' },
        { kind: 'audioinput', deviceId: 'usb', label: 'USB Microphone' },
      ]),
    } })
    const capture = new AudioCapture()
    Object.assign(capture, {
      context: { createMediaStreamSource: vi.fn(() => nextSource) },
      worklet: {},
      source: { disconnect: vi.fn() },
      stream: { getAudioTracks: () => [previousTrack], getTracks: () => [previousTrack] },
      selectedDeviceId: 'usb',
    })

    const result = await capture.switchMicrophone('')

    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.not.objectContaining({ deviceId: expect.anything() }) })
    expect(result.activeDeviceId).toBe('')
    expect(result.devices[0]).toEqual({ deviceId: '', label: 'System default', systemDefault: true })
  })
})
