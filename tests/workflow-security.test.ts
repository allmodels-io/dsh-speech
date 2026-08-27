import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

describe('GitHub Actions credential boundary', () => {
  it('injects live API keys only into the single live runner step', () => {
    const liveJob = ci.slice(ci.indexOf('  live-browser-e2e:'))
    expect(liveJob).not.toMatch(/^ {4}env:/mu)
    expect(liveJob.match(/\$\{\{ secrets\.(?:ALLMODELS_API_KEY|DEEPSEEK_API_KEY) \}\}/gu)).toHaveLength(2)
    expect(liveJob).toContain('run: node scripts/run-e2e.mjs live')
    expect(liveJob).not.toContain('upload-artifact')
  })

  it('pins every external action to an immutable full commit SHA', () => {
    const uses = [...`${ci}\n${release}`.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)]
    expect(uses.length).toBeGreaterThan(0)
    for (const match of uses) expect(match[1]).toMatch(/^[a-f0-9]{40}$/u)
  })
})
