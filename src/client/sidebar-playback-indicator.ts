import type { SpokenSummaryController } from './spoken-controller.ts'

const INDICATOR_CLASS = 'dsh-speech-sidebar-playing'
const ROW_ATTRIBUTE = 'data-dsh-speech-playing-session'

function selectedSessionRow(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined
  return document.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ?? undefined
}

/**
 * Adds a memory-only playback marker to the Harness session row that owned
 * the selected conversation when audio began. Harness RC does not expose a
 * per-session-row slot, so this bridge relies only on its ARIA tree contract.
 */
export class SidebarPlaybackIndicator {
  private readonly rows = new Map<string, HTMLElement>()
  private readonly unsubscribe: () => void
  private readonly observer: MutationObserver | undefined
  private currentSessionKey: string | undefined
  private activeSessionKey: string | undefined
  private disposed = false

  constructor(private readonly spoken: SpokenSummaryController) {
    this.unsubscribe = spoken.subscribe(() => {
      const activeSessionKey = spoken.getSnapshot().activeSessionKey
      if (activeSessionKey === this.activeSessionKey) return
      this.activeSessionKey = activeSessionKey
      this.refresh()
    })
    this.activeSessionKey = spoken.getSnapshot().activeSessionKey
    this.observer = typeof MutationObserver === 'undefined' || typeof document === 'undefined'
      ? undefined
      : new MutationObserver(() => { this.refresh() })
    this.observer?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    })
  }

  observeCurrentSession(sessionKey: string): void {
    if (this.disposed) return
    this.currentSessionKey = sessionKey
    this.refresh()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.observer?.disconnect()
    this.removeIndicators()
    this.rows.clear()
  }

  private refresh(): void {
    if (this.disposed) return
    const selected = selectedSessionRow()
    if (selected !== undefined && this.currentSessionKey !== undefined) {
      this.rows.set(this.currentSessionKey, selected)
    }

    if (this.activeSessionKey === undefined) {
      this.removeIndicators()
      return
    }
    let row = this.rows.get(this.activeSessionKey)
    if (row?.isConnected !== true) {
      this.rows.delete(this.activeSessionKey)
      row = this.currentSessionKey === this.activeSessionKey ? selected : undefined
      if (row !== undefined) this.rows.set(this.activeSessionKey, row)
    }
    if (row === undefined) {
      this.removeIndicators()
      return
    }

    const existing = document.querySelector<HTMLElement>(`.${INDICATOR_CLASS}`)
    if (existing?.parentElement === row) return
    this.removeIndicators()

    row.setAttribute(ROW_ATTRIBUTE, '')
    const indicator = document.createElement('span')
    indicator.className = INDICATOR_CLASS
    indicator.setAttribute('role', 'img')
    indicator.setAttribute('aria-label', 'Playing spoken summary')
    indicator.setAttribute('title', 'Playing spoken summary')
    indicator.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.25v9.5L12.5 8 5 3.25Z"/></svg>'
    row.append(indicator)
  }

  private removeIndicators(): void {
    if (typeof document === 'undefined') return
    for (const row of document.querySelectorAll<HTMLElement>(`[${ROW_ATTRIBUTE}]`)) row.removeAttribute(ROW_ATTRIBUTE)
    for (const indicator of document.querySelectorAll<HTMLElement>(`.${INDICATOR_CLASS}`)) indicator.remove()
  }
}
