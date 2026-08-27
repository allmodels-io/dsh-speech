import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { speechApi } from '../src/client/api.ts'
import { inject } from '../src/index.ts'

async function sourceFiles(dir: string): Promise<string[]> {
  const paths: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) paths.push(...await sourceFiles(path))
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) paths.push(path)
  }
  return paths
}

describe('session persistence boundary', () => {
  it('does not import session or filesystem persistence APIs', async () => {
    const forbidden = [/@deepseek-ai\/dsh-session/u, /ctx\.sessions\b/u, /sessionStorage\b/u, /node:fs/u]
    const violations: string[] = []
    for (const path of await sourceFiles(join(process.cwd(), 'src'))) {
      const source = await readFile(path, 'utf8')
      for (const pattern of forbidden) if (pattern.test(source)) violations.push(`${path}: ${String(pattern)}`)
    }
    expect(violations).toEqual([])
  })

  it('injects no session service and sends no conversation identity to host speech endpoints', async () => {
    expect(inject).toEqual(['webServer', 'credentials', 'llm'])
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => new Response('{"summary":"Done"}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await speechApi.summarize({
      request: 'Request', answer: 'Answer', locale: 'en', route: { provider: 'p', model: 'm' },
    })
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(payload).toEqual({ request: 'Request', answer: 'Answer', locale: 'en', route: { provider: 'p', model: 'm' } })
    expect(JSON.stringify(payload)).not.toMatch(/sessionId|messageId|sessionPath/u)
    vi.unstubAllGlobals()
  })
})
