const PREFERRED_MICROPHONE_KEY = 'dsh-speech.preferred-microphone'

export function readPreferredMicrophone(): string {
  try {
    return window.localStorage.getItem(PREFERRED_MICROPHONE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writePreferredMicrophone(deviceId: string): void {
  try {
    if (deviceId === '') window.localStorage.removeItem(PREFERRED_MICROPHONE_KEY)
    else window.localStorage.setItem(PREFERRED_MICROPHONE_KEY, deviceId)
  } catch {}
}
