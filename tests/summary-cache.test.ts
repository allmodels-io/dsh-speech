import { describe, expect, it } from 'vitest'
import type { SummarizeRequest } from '../src/shared.ts'
import { SummaryCache, summaryCacheKey, type SummaryCacheRecord, type SummaryCacheStore } from '../src/client/summary-cache.ts'

class MemoryStore implements SummaryCacheStore {
  readonly records = new Map<string, SummaryCacheRecord>()
  closed = false

  async get(key: string): Promise<SummaryCacheRecord | undefined> { return this.records.get(key) }
  async put(record: SummaryCacheRecord): Promise<void> { this.records.set(record.key, record) }
  async delete(key: string): Promise<void> { this.records.delete(key) }
  async all(): Promise<SummaryCacheRecord[]> { return [...this.records.values()] }
  async clear(): Promise<void> { this.records.clear() }
  close(): void { this.closed = true }
}

function input(answer = 'Agent answer', model = 'model'): SummarizeRequest {
  return {
    request: 'User request', answer, locale: 'en',
    route: { provider: 'provider', model, reasoningEffort: 'high' },
  }
}

describe('spoken summary cache', () => {
  it('uses deterministic content-addressed keys without storing source text in the key', async () => {
    const first = await summaryCacheKey(input())
    const repeated = await summaryCacheKey(input())
    const changed = await summaryCacheKey(input('Different answer'))
    expect(first).toBe(repeated)
    expect(first).not.toBe(changed)
    expect(first).toMatch(/^[a-f0-9]{64}$/u)
    expect(first).not.toContain('Agent answer')
  })

  it('returns a cached summary within 30 days and expires it afterward', async () => {
    const store = new MemoryStore()
    let now = 1_000
    const cache = new SummaryCache(store, () => now)
    await cache.set(input(), 'Cached summary')
    expect(await cache.get(input())).toBe('Cached summary')

    now += 30 * 24 * 60 * 60 * 1_000
    expect(await cache.get(input())).toBeUndefined()
    expect(store.records.size).toBe(0)
  })

  it('caps entries by least-recent access and supports explicit clearing', async () => {
    const store = new MemoryStore()
    let now = 1_000
    const cache = new SummaryCache(store, () => now, 10_000, 2)
    await cache.set(input('one'), 'One')
    now += 1
    await cache.set(input('two'), 'Two')
    now += 1
    expect(await cache.get(input('one'))).toBe('One')
    now += 1
    await cache.set(input('three'), 'Three')

    expect(await cache.get(input('one'))).toBe('One')
    expect(await cache.get(input('two'))).toBeUndefined()
    expect(await cache.get(input('three'))).toBe('Three')
    await cache.clear()
    expect(store.records.size).toBe(0)
    cache.dispose()
    expect(store.closed).toBe(true)
  })
})
