import type { IncomingMessage } from 'node:http'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

export function hostname(value: string | undefined): string {
  if (value === undefined) return ''
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? '' : trimmed.slice(1, end)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Restrict privileged plugin routes to the loopback Harness page. */
export function isTrustedRequest(req: Pick<IncomingMessage, 'method' | 'headers' | 'socket'>, method?: string): boolean {
  if (method !== undefined && req.method !== method) return false
  const peer = req.socket.remoteAddress
  if (peer === undefined || !LOOPBACK.has(peer)) return false
  const host = typeof req.headers.host === 'string' ? hostname(req.headers.host) : ''
  if (!LOOPBACK.has(host)) return false
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin === 'string') {
    try {
      if (hostname(new URL(origin).host) !== host) return false
    } catch {
      return false
    }
  }
  return true
}
