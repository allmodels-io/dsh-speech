import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const compatibility = readFileSync(new URL('../.github/workflows/harness-compatibility.yml', import.meta.url), 'utf8')

describe('GitHub Actions credential boundary', () => {
  it('injects live API keys only into the single live runner step', () => {
    const liveJob = ci.slice(ci.indexOf('  live-browser-e2e:'))
    expect(liveJob).not.toMatch(/^ {4}env:/mu)
    expect(liveJob.match(/\$\{\{ secrets\.(?:ALLMODELS_API_KEY|DEEPSEEK_API_KEY) \}\}/gu)).toHaveLength(2)
    expect(liveJob).toContain('run: node scripts/run-e2e.mjs live')
    expect(liveJob).not.toContain('upload-artifact')
  })

  it('pins every external action to an immutable full commit SHA', () => {
    const uses = [...`${ci}\n${release}\n${compatibility}`.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)]
    expect(uses.length).toBeGreaterThan(0)
    for (const match of uses) expect(match[1]).toMatch(/^[a-f0-9]{40}$/u)
  })

  it('runs compatibility checks daily without live credentials and deduplicates failure issues', () => {
    expect(compatibility).toContain("cron: '27 3 * * *'")
    expect(compatibility).toContain('workflow_dispatch:')
    expect(compatibility).toContain('npm view @deepseek-ai/dsh time --json')
    expect(compatibility).toContain('node scripts/select-dsh-release.mjs')
    expect(compatibility).toContain('DSH_SPEECH_DSH_VERSION: ${{ needs.discover.outputs.candidate }}')
    expect(compatibility).toContain('gh issue list --repo "$GITHUB_REPOSITORY" --state open')
    expect(compatibility).toContain('gh issue create --repo "$GITHUB_REPOSITORY"')
    expect(compatibility).toContain('permissions:\n      contents: read\n      issues: write')
    expect(compatibility).not.toMatch(/secrets\.(?:ALLMODELS_API_KEY|DEEPSEEK_API_KEY)/u)
    expect(compatibility).not.toContain('test:e2e:live')
  })
})
