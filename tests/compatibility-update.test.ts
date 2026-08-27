import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DeepSeek Harness compatibility updater', () => {
  it('updates only Harness dependency pins and compatibility documentation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-speech-compatibility-'))
    directories.push(directory)
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
      name: '@allmodels/dsh-speech',
      version: '0.1.2',
      peerDependencies: {
        '@deepseek-ai/cordis': '^4.0.1',
        '@deepseek-ai/dsh-client-runtime': '0.1.1-rc.2',
        react: '^18.3.1',
      },
      devDependencies: {
        '@deepseek-ai/cordis': '4.0.1',
        '@deepseek-ai/dsh-client-runtime': '0.1.1-rc.2',
        react: '^18.3.1',
      },
    }, null, 2)}\n`)
    writeFileSync(join(directory, 'dsh-compatibility.json'), '{"testedVersion":"0.1.1-rc.2"}\n')
    writeFileSync(join(directory, 'README.md'), [
      '- DeepSeek Harness web profile `0.1.1-rc.2`',
      'A disposable DeepSeek Harness `0.1.1-rc.2` web profile.',
      '',
    ].join('\n'))

    execFileSync(process.execPath, ['scripts/update-dsh-version.mjs', '0.1.2-rc.1'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, DSH_SPEECH_UPDATE_ROOT: directory },
    })

    const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    expect(packageJson).toMatchObject({
      version: '0.1.2',
      peerDependencies: {
        '@deepseek-ai/cordis': '^4.0.1',
        '@deepseek-ai/dsh-client-runtime': '0.1.2-rc.1',
        react: '^18.3.1',
      },
      devDependencies: {
        '@deepseek-ai/cordis': '4.0.1',
        '@deepseek-ai/dsh-client-runtime': '0.1.2-rc.1',
        react: '^18.3.1',
      },
    })
    expect(JSON.parse(readFileSync(join(directory, 'dsh-compatibility.json'), 'utf8')))
      .toEqual({ testedVersion: '0.1.2-rc.1' })
    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toContain('Harness web profile `0.1.2-rc.1`')
    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toContain('Harness `0.1.2-rc.1` web profile')
  })

  it('rejects versions that cannot be safely used in dependency metadata', () => {
    expect(() => execFileSync(process.execPath, ['scripts/update-dsh-version.mjs', 'latest; echo unsafe'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, DSH_SPEECH_UPDATE_ROOT: tmpdir() },
      stdio: 'pipe',
    })).toThrow()
  })
})
