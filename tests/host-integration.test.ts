import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AllModelsClient } from '../src/allmodels.ts'
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

function bodyRequest(method: string, url: string, body?: unknown): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
    method,
    url,
    headers: { host: '127.0.0.1:31415', origin: 'http://127.0.0.1:31415', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

function binaryResponse(): {
  res: ServerResponse
  read: () => { status: number; headers: Record<string, string>; bytes: Buffer }
} {
  let status = 0
  let headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  const res = Object.assign(new EventEmitter(), {
    writeHead(next: number, nextHeaders: Record<string, string>) { status = next; headers = nextHeaders; return this },
    write(value: string | Uint8Array) { chunks.push(Buffer.from(value)); return true },
    end(value?: string | Uint8Array) { if (value !== undefined) chunks.push(Buffer.from(value)); return this },
    destroy() { return this },
  }) as unknown as ServerResponse
  Object.defineProperty(res, 'headersSent', { get: () => status !== 0 })
  return { res, read: () => ({ status, headers, bytes: Buffer.concat(chunks) }) }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    ctx.provide('llm', {} as never)

    const fiber = ctx.plugin({ inject: [...inject], apply }, Config({} as never))
    await fiber.await()
    expect(routes.map(route => route.path).sort()).toEqual([
      '/api/dsh-speech/auth/key',
      '/api/dsh-speech/auth/logout',
      '/api/dsh-speech/auth/start',
      '/api/dsh-speech/auth/verify',
      '/api/dsh-speech/catalog',
      '/api/dsh-speech/status',
      '/api/dsh-speech/summarize',
      '/api/dsh-speech/top-up',
      '/api/dsh-speech/tts',
      '/api/dsh-speech/tts/audio',
      '/api/dsh-speech/tts/prepare',
      '/api/dsh-speech/voices',
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
        settings: { lowBalanceUsd: 0.5, defaultTopUpUsd: 10, autoPlay: true },
      },
    })

    await fiber.dispose()
    expect(routes).toEqual([])
    expect(upgrades).toEqual([])
  })

  it('streams live chunks from a lease and retains them for deterministic replay', async () => {
    const firstChunk = new Uint8Array([0x49, 0x44, 0x33])
    const secondChunk = new Uint8Array([0x04, 0x55])
    let writeChunk: ((chunk: Uint8Array) => void | Promise<void>) | undefined
    let finish: (() => void) | undefined
    vi.spyOn(AllModelsClient.prototype, 'streamSpeech').mockImplementation(async (_settings, _credential, _request, write) => {
      writeChunk = write
      await new Promise<void>(resolve => { finish = resolve })
    })
    const ctx = new Context()
    const routes: Route[] = []
    ctx.provide('webServer', {
      register(route: Route) { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
      registerUpgrade() { return () => {} },
    } as never)
    ctx.provide('credentials', {
      resolve: vi.fn(async () => ({ value: 'secret-value' })),
      describe: vi.fn(async () => ({ configured: true, writable: true })),
      set: vi.fn(),
      unset: vi.fn(),
    } as never)
    ctx.provide('llm', {} as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, Config({} as never))
    await fiber.await()

    const prepare = routes.find(route => route.path === '/api/dsh-speech/tts/prepare')
    const prepared = response()
    await prepare?.handler(bodyRequest('POST', '/api/dsh-speech/tts/prepare', {
      text: 'Live summary.', model: 'fish/s2.1-pro', provider: 'fish', voice: 'voice',
    }), prepared.res)
    const lease = prepared.read().body as { url: string }
    expect(AllModelsClient.prototype.streamSpeech).toHaveBeenCalledOnce()

    const audio = routes.find(route => route.path === '/api/dsh-speech/tts/audio')
    const first = binaryResponse()
    const live = audio?.handler(bodyRequest('GET', lease.url), first.res)
    await writeChunk?.(firstChunk)
    await Promise.resolve()
    await Promise.resolve()
    expect(first.read()).toMatchObject({ status: 200, headers: { 'content-type': 'audio/mpeg' } })
    expect(first.read().headers['content-length']).toBeUndefined()
    expect([...first.read().bytes]).toEqual([...firstChunk])
    await writeChunk?.(secondChunk)
    finish?.()
    await live
    expect([...first.read().bytes]).toEqual([...firstChunk, ...secondChunk])

    const replay = binaryResponse()
    await audio?.handler(bodyRequest('GET', lease.url), replay.res)
    expect(replay.read().headers['content-length']).toBe(String(firstChunk.byteLength + secondChunk.byteLength))
    expect([...replay.read().bytes]).toEqual([...firstChunk, ...secondChunk])
    expect(AllModelsClient.prototype.streamSpeech).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
})
