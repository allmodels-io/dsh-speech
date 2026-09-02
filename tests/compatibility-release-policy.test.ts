import { describe, expect, it } from 'vitest'
import { isSupportedHarnessRelease, selectHarnessRelease } from '../scripts/select-dsh-release.mjs'

describe('DeepSeek Harness compatibility release policy', () => {
  it.each([
    '0.1.2',
    '1.0.0',
    '0.1.2-rc',
    '0.1.2-rc.1',
    '0.1.2-RC.2',
    '0.1.2-rc.2+build.7',
  ])('accepts stable and rc release %s', version => {
    expect(isSupportedHarnessRelease(version)).toBe(true)
  })

  it.each([
    '0.1.2-alpha.3',
    '0.1.2-beta.1',
    '0.1.2-canary.4',
    '0.1.2-dev.1',
    '0.1.2-next.1',
    'latest',
  ])('rejects non-release version %s', version => {
    expect(isSupportedHarnessRelease(version)).toBe(false)
  })

  it('selects the newest stable or rc publication while ignoring newer alphas', () => {
    expect(selectHarnessRelease({
      created: '2026-08-01T00:00:00.000Z',
      modified: '2026-09-01T00:00:00.000Z',
      '0.1.1-rc.2': '2026-08-21T12:42:19.422Z',
      '0.1.2-alpha.3': '2026-08-31T16:20:52.856Z',
      '0.1.1': '2026-08-25T10:00:00.000Z',
    })).toBe('0.1.1')
  })

  it('rejects a manually requested alpha release', () => {
    expect(() => selectHarnessRelease({}, '0.1.2-alpha.3'))
      .toThrow('Compatibility tests target stable and rc releases only')
  })
})
