import { MAX_TTS_CHARACTERS, SUMMARY_PROMPT_VERSION, type SummarizeRequest } from '../shared.ts'

export const SUMMARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000
export const SUMMARY_CACHE_MAX_ENTRIES = 500

const DATABASE_NAME = 'dsh-speech-summary-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'summaries'

export interface SummaryCacheRecord {
  key: string
  summary: string
  expiresAt: number
  accessedAt: number
}

export interface SummaryCacheStore {
  get(key: string): Promise<SummaryCacheRecord | undefined>
  put(record: SummaryCacheRecord): Promise<void>
  delete(key: string): Promise<void>
  all(): Promise<SummaryCacheRecord[]>
  clear(): Promise<void>
  close(): void
}

class IndexedDbSummaryCacheStore implements SummaryCacheStore {
  private database: Promise<IDBDatabase | undefined> | undefined

  async get(key: string): Promise<SummaryCacheRecord | undefined> {
    const database = await this.open()
    if (database === undefined) return undefined
    return await new Promise(resolve => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => { resolve(request.result as SummaryCacheRecord | undefined) }
      request.onerror = () => { resolve(undefined) }
    })
  }

  async put(record: SummaryCacheRecord): Promise<void> {
    const database = await this.open()
    if (database === undefined) return
    await new Promise<void>(resolve => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record)
      transaction.oncomplete = () => { resolve() }
      transaction.onerror = () => { resolve() }
      transaction.onabort = () => { resolve() }
    })
  }

  async delete(key: string): Promise<void> {
    const database = await this.open()
    if (database === undefined) return
    await new Promise<void>(resolve => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(key)
      transaction.oncomplete = () => { resolve() }
      transaction.onerror = () => { resolve() }
      transaction.onabort = () => { resolve() }
    })
  }

  async all(): Promise<SummaryCacheRecord[]> {
    const database = await this.open()
    if (database === undefined) return []
    return await new Promise(resolve => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => { resolve(request.result as SummaryCacheRecord[]) }
      request.onerror = () => { resolve([]) }
    })
  }

  async clear(): Promise<void> {
    const database = await this.open()
    if (database === undefined) return
    await new Promise<void>(resolve => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      transaction.oncomplete = () => { resolve() }
      transaction.onerror = () => { resolve() }
      transaction.onabort = () => { resolve() }
    })
  }

  close(): void {
    void this.database?.then(database => { database?.close() })
    this.database = undefined
  }

  private open(): Promise<IDBDatabase | undefined> {
    if (this.database !== undefined) return this.database
    if (typeof indexedDB === 'undefined') return Promise.resolve(undefined)
    this.database = new Promise(resolve => {
      let settled = false
      const finish = (database: IDBDatabase | undefined): void => {
        if (settled) {
          database?.close()
          return
        }
        settled = true
        resolve(database)
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      request.onsuccess = () => { finish(request.result) }
      request.onerror = () => { finish(undefined) }
      request.onblocked = () => { finish(undefined) }
    })
    return this.database
  }
}

export async function summaryCacheKey(input: SummarizeRequest): Promise<string | undefined> {
  if (globalThis.crypto?.subtle === undefined) return undefined
  const canonical = JSON.stringify({
    version: SUMMARY_PROMPT_VERSION,
    request: input.request,
    answer: input.answer,
    locale: input.locale,
    route: {
      provider: input.route.provider,
      model: input.route.model,
      reasoningEffort: input.route.reasoningEffort ?? null,
    },
  })
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Browser-local, fail-open cache. It never stores session or message identity. */
export class SummaryCache {
  constructor(
    private readonly store: SummaryCacheStore = new IndexedDbSummaryCacheStore(),
    private readonly now: () => number = Date.now,
    private readonly ttlMs = SUMMARY_CACHE_TTL_MS,
    private readonly maximumEntries = SUMMARY_CACHE_MAX_ENTRIES,
  ) {}

  async get(input: SummarizeRequest): Promise<string | undefined> {
    try {
      const key = await summaryCacheKey(input)
      if (key === undefined) return undefined
      const record = await this.store.get(key)
      if (record === undefined) return undefined
      const now = this.now()
      if (record.expiresAt <= now || record.summary.length === 0 || record.summary.length > MAX_TTS_CHARACTERS) {
        await this.store.delete(key)
        return undefined
      }
      await this.store.put({ ...record, accessedAt: now })
      return record.summary
    } catch {
      return undefined
    }
  }

  async set(input: SummarizeRequest, summary: string): Promise<void> {
    if (summary.length === 0 || summary.length > MAX_TTS_CHARACTERS) return
    try {
      const key = await summaryCacheKey(input)
      if (key === undefined) return
      const now = this.now()
      await this.store.put({ key, summary, expiresAt: now + this.ttlMs, accessedAt: now })
      await this.prune(now)
    } catch {
      // Caching is an optimization and must never block spoken summaries.
    }
  }

  async clear(): Promise<void> {
    try { await this.store.clear() } catch { /* fail open */ }
  }

  dispose(): void {
    this.store.close()
  }

  private async prune(now: number): Promise<void> {
    const records = await this.store.all()
    const live: SummaryCacheRecord[] = []
    for (const record of records) {
      if (record.expiresAt <= now) await this.store.delete(record.key)
      else live.push(record)
    }
    live.sort((a, b) => b.accessedAt - a.accessedAt)
    for (const record of live.slice(this.maximumEntries)) await this.store.delete(record.key)
  }
}
