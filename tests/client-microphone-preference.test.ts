// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readPreferredMicrophone, writePreferredMicrophone } from '../src/client/microphonePreference.ts'

describe('microphone preference', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('remembers a specifically selected microphone in browser-local storage', () => {
    writePreferredMicrophone('usb-microphone')
    expect(readPreferredMicrophone()).toBe('usb-microphone')
  })

  it('uses system default when no specific microphone is saved', () => {
    writePreferredMicrophone('usb-microphone')
    writePreferredMicrophone('')
    expect(readPreferredMicrophone()).toBe('')
  })
})
