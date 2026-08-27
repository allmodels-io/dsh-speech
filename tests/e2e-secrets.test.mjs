import { describe, expect, it } from 'vitest'
import {
  LIVE_SECRET_NAMES,
  assertNoLiveSecrets,
  parseLiveSecretFile,
  stripLiveSecrets,
  takeLiveSecrets,
} from '../scripts/e2e-secrets.mjs'

describe('live E2E secret boundary', () => {
  it('extracts both credentials and removes them from every ordinary child environment', () => {
    const source = { PATH: '/bin', ALLMODELS_API_KEY: 'allmodels-secret', DEEPSEEK_API_KEY: 'deepseek-secret' }
    expect(takeLiveSecrets(source)).toEqual({
      ALLMODELS_API_KEY: 'allmodels-secret',
      DEEPSEEK_API_KEY: 'deepseek-secret',
    })
    const clean = stripLiveSecrets(source)
    expect(clean).toEqual({ PATH: '/bin' })
    expect(() => { assertNoLiveSecrets(clean, 'browser') }).not.toThrow()
    expect(() => { assertNoLiveSecrets(source, 'browser') }).toThrow(/must not receive ALLMODELS_API_KEY/u)
  })

  it('parses only the two supported local secret names without overriding environment values', () => {
    const parsed = parseLiveSecretFile([
      'ALLMODELS_API_KEY=file-allmodels',
      'DEEPSEEK_API_KEY="file-deepseek"',
      'UNRELATED_SECRET=do-not-load',
    ].join('\n'), { ALLMODELS_API_KEY: 'environment-allmodels' })
    expect(parsed).toEqual({
      ALLMODELS_API_KEY: 'environment-allmodels',
      DEEPSEEK_API_KEY: 'file-deepseek',
    })
    expect(Object.keys(parsed).sort()).toEqual([...LIVE_SECRET_NAMES].sort())
  })
})
