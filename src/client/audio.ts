const WORKLET_SOURCE = String.raw`
class DshSpeechPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = 16000 / sampleRate
    this.credit = 0
    this.samples = new Int16Array(1600)
    this.offset = 0
    this.energy = 0
    this.energySamples = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let index = 0; index < channel.length; index += 1) {
      const raw = channel[index]
      this.energy += raw * raw
      this.energySamples += 1
      this.credit += this.ratio
      if (this.credit < 1) continue
      this.credit -= 1
      const sample = Math.max(-1, Math.min(1, raw))
      this.samples[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      if (this.offset === this.samples.length) {
        const pcm = this.samples.buffer
        this.port.postMessage({ type: 'pcm', pcm }, [pcm])
        this.samples = new Int16Array(1600)
        this.offset = 0
      }
    }
    if (this.energySamples >= 2048) {
      this.port.postMessage({ type: 'amplitude', value: Math.sqrt(this.energy / this.energySamples) })
      this.energy = 0
      this.energySamples = 0
    }
    return true
  }
}
registerProcessor('dsh-speech-pcm', DshSpeechPcmProcessor)
`

export interface MicrophoneDevice {
  deviceId: string
  label: string
  systemDefault?: boolean
}

export interface MicrophoneSnapshot {
  devices: MicrophoneDevice[]
  activeDeviceId?: string
}

function microphoneConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId === undefined || deviceId === '' ? {} : { deviceId: { exact: deviceId } }),
  }
}

export class AudioCapture {
  private context: AudioContext | undefined
  private stream: MediaStream | undefined
  private source: MediaStreamAudioSourceNode | undefined
  private worklet: AudioWorkletNode | undefined
  private sink: GainNode | undefined
  private moduleUrl: string | undefined
  private deviceSwitchVersion = 0
  private selectedDeviceId = ''

  async start(
    onFrame: (frame: ArrayBuffer) => void,
    onAmplitude: (value: number) => void,
    preferredDeviceId = '',
  ): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      throw new Error('This browser does not support live microphone transcription')
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(preferredDeviceId) })
      this.selectedDeviceId = preferredDeviceId
    } catch (error) {
      const name = error !== null && typeof error === 'object' && 'name' in error ? String(error.name) : ''
      if (preferredDeviceId === '' || (name !== 'NotFoundError' && name !== 'OverconstrainedError')) throw error
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() })
      this.selectedDeviceId = ''
    }
    const context = new AudioContext({ latencyHint: 'interactive' })
    this.context = context
    this.moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
    await context.audioWorklet.addModule(this.moduleUrl)
    this.source = context.createMediaStreamSource(this.stream)
    this.worklet = new AudioWorkletNode(context, 'dsh-speech-pcm', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    })
    this.sink = context.createGain()
    this.sink.gain.value = 0
    this.worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === null || typeof event.data !== 'object') return
      const message = event.data as { type?: unknown; pcm?: unknown; value?: unknown }
      if (message.type === 'pcm' && message.pcm instanceof ArrayBuffer) onFrame(message.pcm)
      if (message.type === 'amplitude' && typeof message.value === 'number') onAmplitude(message.value)
    }
    this.source.connect(this.worklet)
    this.worklet.connect(this.sink)
    this.sink.connect(context.destination)
    await context.resume()
  }

  async microphones(): Promise<MicrophoneSnapshot> {
    const activeTrack = this.stream?.getAudioTracks()[0]
    const activeDeviceId = activeTrack?.getSettings().deviceId
    const inputs = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput')
      : []
    const seen = new Set<string>()
    const devices: MicrophoneDevice[] = [{ deviceId: '', label: 'System default', systemDefault: true }]
    for (const [index, device] of inputs.entries()) {
      if (device.deviceId === '' || device.deviceId === 'default' || seen.has(device.deviceId)) continue
      seen.add(device.deviceId)
      devices.push({ deviceId: device.deviceId, label: device.label.trim() || `Microphone ${String(index + 1)}` })
    }
    if (this.selectedDeviceId !== '' && activeDeviceId !== undefined && activeDeviceId !== '' && !seen.has(this.selectedDeviceId)) {
      devices.push({ deviceId: this.selectedDeviceId, label: activeTrack?.label.trim() || 'Current microphone' })
    }
    return {
      devices,
      activeDeviceId: this.selectedDeviceId,
    }
  }

  async switchMicrophone(deviceId: string): Promise<MicrophoneSnapshot> {
    const context = this.context
    const worklet = this.worklet
    if (context === undefined || worklet === undefined || this.stream === undefined) {
      throw new Error('The microphone is not currently recording')
    }
    const version = ++this.deviceSwitchVersion
    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId) })
    if (version !== this.deviceSwitchVersion || this.context !== context || this.worklet !== worklet) {
      for (const track of nextStream.getTracks()) track.stop()
      throw new Error('The microphone changed before the previous selection finished')
    }
    const nextSource = context.createMediaStreamSource(nextStream)
    nextSource.connect(worklet)
    const previousSource = this.source
    const previousStream = this.stream
    this.source = nextSource
    this.stream = nextStream
    this.selectedDeviceId = deviceId
    previousSource?.disconnect()
    for (const track of previousStream.getTracks()) track.stop()
    return this.microphones()
  }

  async stop(): Promise<void> {
    this.deviceSwitchVersion += 1
    this.worklet?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    if (this.context !== undefined && this.context.state !== 'closed') await this.context.close().catch(() => {})
    if (this.moduleUrl !== undefined) URL.revokeObjectURL(this.moduleUrl)
    this.context = undefined
    this.stream = undefined
    this.source = undefined
    this.worklet = undefined
    this.sink = undefined
    this.moduleUrl = undefined
    this.selectedDeviceId = ''
  }
}
