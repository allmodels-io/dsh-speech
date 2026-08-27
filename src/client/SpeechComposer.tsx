import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpeechController } from './controller.ts'
import { styles } from './styles.ts'

export interface SpeechComposerInjected {
  controller: SpeechController
  getLocale: () => string
}

type MicProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'speech'> & InjectFace<SpeechComposerInjected>
type DockProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'speech'> & InjectFace<SpeechComposerInjected>
type InputDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'speech'> & InjectFace<SpeechComposerInjected>

function MicIcon({ stopped }: { stopped: boolean }): ReactNode {
  return stopped ? (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2" /></svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  )
}

function ChevronIcon(): ReactNode {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m3.5 5.25 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m2.75 7.2 2.6 2.6 5.9-5.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 5.5 9 9m0-9-9 9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8.3125.980183c.35517.072917.66652.223997.9502.452147.22454.18064.46759.4256.71679.67481L14.707 6.83468l-1.414 1.41406L9 3.95577V15.0417H7V3.95577L2.70703 8.24874 1.29297 6.83468l4.72754-4.72754c.2492-.24921.49226-.49417.71679-.67481.23932-.19247.54715-.38831.9502-.452147.2098-.033177.4156-.025023.625 0Z" fill="currentColor" />
    </svg>
  )
}

const WAVEFORM_PITCH = 4
const WAVEFORM_BASELINE = 0.025

function RecordingWaveform({ amplitude }: { amplitude: number }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplesRef = useRef<number[]>([])
  const reducedMotionRef = useRef(false)

  const draw = useCallback((): void => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null || canvas.clientWidth === 0 || canvas.clientHeight === 0) return

    const ratio = window.devicePixelRatio || 1
    const width = Math.floor(canvas.clientWidth * ratio)
    const height = Math.floor(canvas.clientHeight * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const barCount = Math.max(1, Math.floor(canvas.clientWidth / WAVEFORM_PITCH))
    if (samplesRef.current.length !== barCount) {
      const existing = samplesRef.current.slice(-barCount)
      samplesRef.current = [
        ...Array.from({ length: Math.max(0, barCount - existing.length) }, () => WAVEFORM_BASELINE),
        ...existing,
      ]
    }

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = getComputedStyle(canvas).color || '#a8a8a8'
    const pitch = width / barCount
    const barWidth = Math.max(1, pitch / 2)
    const center = height / 2
    for (let index = 0; index < barCount; index += 1) {
      const sample = samplesRef.current[index] ?? WAVEFORM_BASELINE
      const barHeight = Math.max(1.5 * ratio, sample * height * 0.88)
      context.globalAlpha = sample <= WAVEFORM_BASELINE ? 0.24 : 0.92
      context.fillRect(index * pitch, center - barHeight / 2, barWidth, barHeight)
    }
    context.globalAlpha = 1
  }, [])

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const canvas = canvasRef.current
    if (canvas === null) return
    draw()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => { observer.disconnect() }
  }, [draw])

  useEffect(() => {
    const normalized = Math.max(WAVEFORM_BASELINE, Math.min(1, Math.pow(amplitude, 0.72)))
    const samples = samplesRef.current
    if (samples.length === 0) {
      draw()
      return
    }
    if (reducedMotionRef.current) samples.fill(normalized)
    else {
      samples.push(normalized)
      samples.shift()
    }
    draw()
  }, [amplitude, draw])

  return <canvas ref={canvasRef} className={styles.recordingCanvas} aria-hidden="true" />
}

function RecordingTakeover({ amplitude, cancelLabel, disabled, phase, label, onCancel, onSend, onStop, sendDisabled, sendLabel, stopLabel }: {
  amplitude: number
  cancelLabel: string
  disabled: boolean
  phase: 'starting' | 'recording' | 'finalizing'
  label: string
  onCancel: () => void
  onSend: () => void
  onStop: () => void
  sendDisabled: boolean
  sendLabel: string
  stopLabel: string
}): ReactNode {
  const recording = phase === 'recording'
  return (
    <div className={styles.recordingTakeover} data-phase={phase}>
      {recording ? (
        <button
          type="button"
          className={`${styles.mic} ${styles.recordingCancel}`}
          disabled={disabled}
          aria-label={cancelLabel}
          title={cancelLabel}
          onClick={onCancel}
        >
          <CloseIcon />
        </button>
      ) : null}
      <div className={styles.recordingTrack}>
        {recording ? <RecordingWaveform amplitude={amplitude} /> : (
          <span className={styles.recordingProgress} role="status" aria-live="polite">
            <i aria-hidden="true" />
            {label}
          </span>
        )}
      </div>
      {recording ? (
        <div className={styles.recordingActions}>
          <button
            type="button"
            className={`${styles.mic} ${styles.recordingStop}`}
            disabled={disabled}
            aria-label={stopLabel}
            title={stopLabel}
            onClick={onStop}
          >
            <MicIcon stopped />
          </button>
          <button
            type="button"
            className={styles.recordingSend}
            disabled={sendDisabled}
            aria-label={sendLabel}
            title={sendLabel}
            onClick={onSend}
          >
            <SendIcon />
          </button>
        </div>
      ) : null}
      <span className={styles.srOnly} role="status" aria-live="polite">{label}</span>
    </div>
  )
}

export function SpeechMic({ controller, getLocale, sessionId, input, inputActions, t }: MicProps): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const tooltipId = useId()
  const [explanationOpen, setExplanationOpen] = useState(false)
  const explanationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activeHere = state.activeSessionId === sessionId
  const activeElsewhere = state.activeSessionId !== undefined && !activeHere
  const disconnected = state.status?.credential.configured !== true
  const exhausted = state.status?.balance?.exhausted === true
  const unavailable = !activeHere && (disconnected || exhausted || activeElsewhere)
  const disabled = (!activeHere && input.phase !== 'plain') || state.phase === 'starting' || state.phase === 'finalizing'
  const title = activeHere ? t('micStop')
    : disconnected ? t('disconnectedMic')
      : exhausted ? t('emptyMic')
        : activeElsewhere ? t('anotherMic') : t('micStart')

  useEffect(() => {
    void controller.ensureMetadata()
    return () => {
      if (explanationTimer.current !== undefined) clearTimeout(explanationTimer.current)
      controller.release(sessionId)
    }
  }, [controller, sessionId])

  const toggle = (): void => {
    if (unavailable) {
      controller.reportError(title)
      setExplanationOpen(true)
      if (explanationTimer.current !== undefined) clearTimeout(explanationTimer.current)
      explanationTimer.current = setTimeout(() => { setExplanationOpen(false) }, 4000)
      return
    }
    void controller.toggle({
      sessionId,
      draft: input.draft,
      inputActions,
      locale: getLocale(),
      listeningReason: t('listening'),
    }).catch(error => { controller.reportError(error instanceof Error ? error.message : 'Unable to start microphone') })
  }

  if (activeHere) {
    const takeoverPhase = state.phase === 'starting' || state.phase === 'finalizing'
      ? state.phase
      : 'recording'
    return (
      <RecordingTakeover
        amplitude={state.amplitude}
        cancelLabel={t('micCancel')}
        disabled={disabled}
        phase={takeoverPhase}
        label={state.phase === 'starting' ? t('starting')
          : state.phase === 'finalizing' ? t('finalizing') : t('listening')}
        onCancel={() => { controller.cancel() }}
        onSend={() => { void controller.stopAndSend().catch(error => { controller.reportError(error instanceof Error ? error.message : 'Unable to send voice input') }) }}
        onStop={toggle}
        sendDisabled={disabled || !state.hasTranscript}
        sendLabel={t('micSend')}
        stopLabel={title}
      />
    )
  }

  return (
    <span className={styles.micWrap} data-explanation-open={explanationOpen || undefined}>
      <button
        type="button"
        className={`${styles.mic} ${activeHere ? styles.micActive : ''}`}
        disabled={disabled}
        aria-disabled={disabled || unavailable}
        aria-describedby={tooltipId}
        aria-label={title}
        aria-pressed={activeHere}
        onClick={toggle}
      >
        <MicIcon stopped={activeHere} />
      </button>
      <span id={tooltipId} className={styles.micTooltip} role="tooltip">{title}</span>
    </span>
  )
}

function MicrophoneSelector({ controller, state, t, variant = 'metrics' }: {
  controller: SpeechController
  state: ReturnType<SpeechController['getSnapshot']>
  t: MicProps['t']
  variant?: 'metrics' | 'hero'
}): ReactNode {
  const menuId = useId()
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const deviceLabel = (device: (typeof state.microphones)[number]): string => device.systemDefault === true
    ? t('systemDefaultMicrophone')
    : device.label
  const current = state.microphones.find(device => device.deviceId === state.activeMicrophoneId)
  const label = current === undefined
    ? (state.microphones.length === 0 ? t('loadingMicrophones') : t('microphone'))
    : deviceLabel(current)
  const deviceError = state.microphoneError === undefined
    ? undefined
    : t('microphoneError', { message: state.microphoneError })

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  return (
    <span
      ref={rootRef}
      className={styles.deviceDock}
      data-variant={variant}
      data-error={deviceError === undefined ? undefined : true}
      aria-busy={state.switchingMicrophone}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.deviceTrigger}
        aria-label={`${t('microphone')}: ${label}`}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        disabled={state.switchingMicrophone || state.microphones.length === 0}
        title={deviceError ?? (state.switchingMicrophone ? t('switchingMicrophone') : label)}
        onClick={() => { setOpen(value => !value) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className={styles.deviceIcon} aria-hidden="true"><MicIcon stopped={false} /></span>
        <span className={styles.deviceLabel}>{label}</span>
        <span className={styles.deviceChevron} aria-hidden="true"><ChevronIcon /></span>
      </button>
      {open ? (
        <span id={menuId} className={styles.deviceMenu} role="menu" aria-label={t('microphone')}>
          {state.microphones.map(device => {
            const selected = device.deviceId === state.activeMicrophoneId
            return (
              <button
                key={device.deviceId}
                type="button"
                className={styles.deviceMenuItem}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setOpen(false)
                  if (!selected) void controller.switchMicrophone(device.deviceId)
                }}
              >
                <span>{deviceLabel(device)}</span>
                <span className={styles.deviceCheck} aria-hidden="true">{selected ? <CheckIcon /> : null}</span>
              </button>
            )
          })}
        </span>
      ) : null}
      {deviceError === undefined ? null : <span className={styles.srOnly} role="alert">{deviceError}</span>}
    </span>
  )
}

function MicrophoneDockPortal({ controller, state, t }: {
  controller: SpeechController
  state: ReturnType<SpeechController['getSnapshot']>
  t: MicProps['t']
}): ReactNode {
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    let disposed = false
    let frame: number | undefined
    let observedSlot: HTMLElement | null = null
    const observer = new MutationObserver(() => { findTarget() })

    const retry = (): void => {
      if (disposed || frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        findTarget()
      })
    }

    const findTarget = (): void => {
      if (disposed) return
      const marker = markerRef.current
      const slot = marker?.closest('[data-slot="conversation.composer.dock"]')
      if (!(slot instanceof HTMLElement)) {
        setTarget(null)
        retry()
        return
      }

      if (observedSlot !== slot) {
        observer.disconnect()
        observedSlot = slot
        observer.observe(slot, { childList: true, subtree: true, characterData: true })
      }

      const metrics = Array.from(slot.children).find(child => child !== marker && child.textContent?.includes('TTFT'))
      const nextTarget = metrics instanceof HTMLElement ? metrics : null
      setTarget(current => current === nextTarget ? current : nextTarget)
      if (nextTarget === null) retry()
    }

    findTarget()
    return () => {
      disposed = true
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <>
      <span ref={markerRef} className={styles.deviceMarker} aria-hidden="true" />
      {target === null ? null : createPortal((
        <>
          <span className={styles.deviceSeparator} aria-hidden="true">|</span>
          <MicrophoneSelector controller={controller} state={state} t={t} />
        </>
      ), target)}
    </>
  )
}

function MicrophoneInputDock({ controller, state, t }: {
  controller: SpeechController
  state: ReturnType<SpeechController['getSnapshot']>
  t: MicProps['t']
}): ReactNode {
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const [heroTarget, setHeroTarget] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const marker = markerRef.current
    const composer = marker?.closest('[data-slot="conversation.composer"]')
    if (!(composer instanceof HTMLElement)) return
    const update = (): void => {
      if (composer.querySelector('[data-slot="conversation.composer.dock"]') !== null) {
        setHeroTarget(null)
        return
      }
      const presetSlot = composer.querySelector('[data-slot="conversation.hero.agentPreset"]')
      setHeroTarget(presetSlot?.parentElement instanceof HTMLElement ? presetSlot.parentElement : null)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(composer, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])

  return (
    <>
      <span ref={markerRef} className={styles.deviceMarker} aria-hidden="true" />
      {heroTarget === null ? null : createPortal(
        <MicrophoneSelector controller={controller} state={state} t={t} variant="hero" />,
        heroTarget,
      )}
    </>
  )
}

export function SpeechDock({ controller, sessionId, t }: DockProps): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (state.activeSessionId === sessionId && state.phase === 'recording') {
    return <MicrophoneDockPortal controller={controller} state={state} t={t} />
  }
  if (state.activeSessionId === sessionId || state.error === undefined) return null
  return <div className={styles.dockError} role="alert">{state.error}</div>
}

export function SpeechInputDock({ controller, sessionId, t }: InputDockProps): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (state.activeSessionId !== sessionId || state.phase !== 'recording') return null
  return <MicrophoneInputDock controller={controller} state={state} t={t} />
}
