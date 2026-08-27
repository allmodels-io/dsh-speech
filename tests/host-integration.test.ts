import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, apply, inject } from '../src/index.ts'

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface UpgradeRoute {
  path: string
  handler: (...args: never[]) => unknown
}

function request(method: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    method,
    url: '/api/dsh-speech/status',
    headers: { host: '127.0.0.1:31415', origin: 'http://127.0.0.1:31415', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

function response(): { res: ServerResponse; read: () => { status: number; body: unknown } } {
  let status = 0
  const chunks: Buffer[] = []
  const res = Object.assign(new EventEmitter(), {
    writeHead(next: number) { status = next; return this },
    end(value?: string | Uint8Array) { if (value !== undefined) chunks.push(Buffer.from(value)); return this },
  }) as unknown as ServerResponse
  return {
    res,
    read: () => ({ status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }),
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('host Cordis composition', () => {
  it('registers only plugin-local routes and reports credential state without session services', async () => {
    const ctx = new Context()
    const routes: Route[] = []
    const upgrades: UpgradeRoute[] = []
    ctx.provide('webServer', {
      register(route: Route) { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
      registerUpgrade(route: UpgradeRoute) { upgrades.push(route); return () => { upgrades.splice(upgrades.indexOf(route), 1) } },
    } as never)
    ctx.provide('credentials', {
      resolve: vi.fn(async () => undefined),
      describe: vi.fn(async () => ({ configured: false, writable: true })),
      set: vi.fn(),
      unset: vi.fn(),
    } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply }, Config({} as never))
    await fiber.await()
    expect(routes.map(route => route.path).sort()).toEqual([
      '/api/dsh-speech/auth/key',
      '/api/dsh-speech/auth/logout',
      '/api/dsh-speech/auth/start',
      '/api/dsh-speech/auth/verify',
      '/api/dsh-speech/catalog',
      '/api/dsh-speech/status',
      '/api/dsh-speech/top-up',
    ])
    expect(upgrades.map(route => route.path)).toEqual(['/api/dsh-speech/stt'])

    const target = routes.find(route => route.path === '/api/dsh-speech/status')
    expect(target).toBeDefined()
    const output = response()
    await target?.handler(request('GET'), output.res)
    expect(output.read()).toEqual({
      status: 200,
      body: {
        credential: { configured: false, writable: true },
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10 },
      },
    })

    await fiber.dispose()
    expect(routes).toEqual([])
    expect(upgrades).toEqual([])
  })
})
