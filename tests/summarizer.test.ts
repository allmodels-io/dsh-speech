import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import {
  SUMMARY_SYSTEM_PROMPT,
  boundSummarySource,
  summarizeAnswer,
  validateSummarizeRequest,
} from '../src/summarizer.ts'

function llmWith(chunks: readonly StreamChunk[], resolve = vi.fn(async (value: GenerateOptions) => value)) {
  let captured: GenerateOptions | undefined
  const llm = {
    resolveCallConfig: resolve,
    stream(options: GenerateOptions) {
      captured = options
      return (async function* () { for (const chunk of chunks) yield chunk })()
    },
  } as unknown as LlmRuntime
  return { llm, captured: () => captured }
}

const responseChunks: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'The change is complete. Restart the app.' },
  { type: 'finish', reason: { kind: 'stop' } },
]

describe('spoken-summary LLM call', () => {
  it('uses the exact recorded route and a tool-free prompt without an artificial output cap', async () => {
    const resolve = vi.fn(async value => value)
    const target = llmWith(responseChunks, resolve)
    const summary = await summarizeAnswer(target.llm, {
      request: 'Implement the change', answer: 'Implemented with tests.', locale: 'en-US',
      route: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' },
    })
    expect(summary).toBe('The change is complete. Restart the app.')
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' }), undefined)
    expect(target.captured()).toMatchObject({ provider: 'openai', model: 'gpt-5', system: SUMMARY_SYSTEM_PROMPT })
    expect(target.captured()?.maxTokens).toBeUndefined()
    expect(target.captured()?.tools).toBeUndefined()
    const block = target.captured()?.messages[0]?.content[0]
    const payload = JSON.parse(block?.type === 'text' ? block.text : '')
    expect(payload).toMatchObject({ locale: 'en-US', userRequest: 'Implement the change', agentAnswer: 'Implemented with tests.' })
    expect(target.captured()?.sessionId).toBeUndefined()
  })

  it('drops an invalid recorded reasoning effort but never changes route', async () => {
    const resolve = vi.fn(async value => {
      if (value.reasoningEffort !== undefined) throw new Error('invalid effort')
      return value
    })
    await summarizeAnswer(llmWith(responseChunks, resolve).llm, {
      request: 'Do it', answer: 'Done', locale: 'en', route: { provider: 'p', model: 'm', reasoningEffort: 'obsolete' },
    })
    expect(resolve).toHaveBeenNthCalledWith(2, { provider: 'p', model: 'm' }, undefined)
  })

  it('preserves the beginning and end when bounding source prose', () => {
    const bounded = boundSummarySource(`BEGIN${'x'.repeat(200)}END`, 80)
    expect(bounded).toHaveLength(80)
    expect(bounded.startsWith('BEGIN')).toBe(true)
    expect(bounded.endsWith('END')).toBe(true)
    expect(bounded).toContain('middle omitted')
    const request = validateSummarizeRequest({
      request: `first${'r'.repeat(20_000)}last`, answer: `head${'a'.repeat(70_000)}tail`, locale: 'en',
      route: { provider: 'p', model: 'm' },
    })
    expect(request.request).toHaveLength(16_000)
    expect(request.answer).toHaveLength(64_000)
    expect(request.answer.endsWith('tail')).toBe(true)
  })

  it('rejects empty output and surfaces terminal provider failures without provider secrets', async () => {
    await expect(summarizeAnswer(llmWith([{ type: 'finish', reason: { kind: 'stop' } }]).llm, {
      request: 'Do it', answer: 'Done', locale: 'en', route: { provider: 'p', model: 'm' },
    })).rejects.toThrow('empty summary')
    await expect(summarizeAnswer(llmWith([{ type: 'finish', reason: {
      kind: 'error', failure: { code: 'AUTH', message: 'Bearer sk-secret' },
    } }]).llm, {
      request: 'Do it', answer: 'Done', locale: 'en', route: { provider: 'p', model: 'm' },
    })).rejects.toThrow('recorded LLM route')
  })

  it('does not impose an arbitrary word ceiling on a valid speakable summary', async () => {
    const long = Array.from({ length: 120 }, (_, index) => `word${String(index)}`).join(' ')
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: `${long} https://secret.example` },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await summarizeAnswer(llmWith(chunks).llm, {
      request: 'Do it', answer: 'Done', locale: 'en', route: { provider: 'p', model: 'm' },
    })
    expect(result.split(/\s+/u)).toHaveLength(120)
    expect(result).not.toContain('http')
  })

  it('uses a complete sentence at the provider character boundary', async () => {
    const complete = `${Array.from({ length: 350 }, (_, index) => `complete${String(index)}`).join(' ')}.`
    const unfinished = Array.from({ length: 400 }, (_, index) => `unfinished${String(index)}`).join(' ')
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: `${complete} ${unfinished}` },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await summarizeAnswer(llmWith(chunks).llm, {
      request: 'Do it', answer: 'Done', locale: 'en', route: { provider: 'p', model: 'm' },
    })
    expect(result).toBe(complete)
    expect(result.length).toBeLessThanOrEqual(4_096)
  })

  it('passes cancellation to route resolution and generation', async () => {
    const abort = new AbortController()
    const target = llmWith(responseChunks)
    await summarizeAnswer(target.llm, {
      request: 'Do it', answer: 'Done', locale: 'en', route: { provider: 'p', model: 'm' },
    }, abort.signal)
    expect(target.captured()?.signal).toBe(abort.signal)
  })
})
