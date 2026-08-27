import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { hostname, isTrustedRequest } from '../src/security.ts'

function request(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: 'POST',
    headers: { host: '127.0.0.1:31415', origin: 'http://127.0.0.1:31415', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as IncomingMessage
}

describe('loopback request boundary', () => {
  it('parses hostnames without trusting ports', () => {
    expect(hostname('127.0.0.1:3000')).toBe('127.0.0.1')
    expect(hostname('[::1]:3000')).toBe('::1')
  })

  it('accepts a same-origin loopback request', () => {
    expect(isTrustedRequest(request(), 'POST')).toBe(true)
  })

  it('rejects remote peers, cross-site fetches, forged hosts, and wrong methods', () => {
    expect(isTrustedRequest(request({ socket: { remoteAddress: '10.0.0.3' } as never }), 'POST')).toBe(false)
    expect(isTrustedRequest(request({ headers: { host: '127.0.0.1:1', 'sec-fetch-site': 'cross-site' } }), 'POST')).toBe(false)
    expect(isTrustedRequest(request({ headers: { host: 'example.com', origin: 'http://example.com' } }), 'POST')).toBe(false)
    expect(isTrustedRequest(request({ method: 'GET' }), 'POST')).toBe(false)
  })
})
