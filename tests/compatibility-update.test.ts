import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const servers: Server[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })))
})

async function registryWith(versions: Record<string, string[]>): Promise<string> {
  const server = createServer((request, response) => {
    const match = Object.entries(versions).find(([name, published]) => published.some(version =>
      request.url === `/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    ))
    if (match === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not_found"}')
      return
    }
    const [, published] = match
    const version = published.find(candidate => request.url?.endsWith(`/${encodeURIComponent(candidate)}`))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ version }))
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/`
}

async function runUpdater(directory: string, version: string, registry: string): Promise<void> {
  await execFileAsync(process.execPath, ['scripts/update-dsh-version.mjs', version], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DSH_SPEECH_UPDATE_ROOT: directory,
      DSH_SPEECH_NPM_REGISTRY: registry,
    },
  })
}

describe('DeepSeek Harness compatibility updater', () => {
  it('updates only published Harness dependency pins and compatibility documentation', async () => {
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

    const registry = await registryWith({
      '@deepseek-ai/dsh': ['0.1.2-rc.1'],
      '@deepseek-ai/dsh-client-runtime': ['0.1.2-rc.1'],
    })
    await runUpdater(directory, '0.1.2-rc.1', registry)

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

  it('rejects versions that cannot be safely used in dependency metadata', async () => {
    await expect(execFileAsync(process.execPath, ['scripts/update-dsh-version.mjs', 'latest; echo unsafe'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, DSH_SPEECH_UPDATE_ROOT: tmpdir() },
    })).rejects.toThrow()
  })

  it('reports removed Harness packages without changing compatibility files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-speech-compatibility-'))
    directories.push(directory)
    const originalPackage = `${JSON.stringify({
      name: '@allmodels/dsh-speech',
      peerDependencies: {
        '@deepseek-ai/dsh-client-runtime': '0.1.1-rc.2',
        '@deepseek-ai/dsh-client-ui-settings': '0.1.1-rc.2',
      },
      devDependencies: {
        '@deepseek-ai/dsh-client-runtime': '0.1.1-rc.2',
        '@deepseek-ai/dsh-client-ui-settings': '0.1.1-rc.2',
      },
    }, null, 2)}\n`
    const originalCompatibility = '{"testedVersion":"0.1.1-rc.2"}\n'
    const originalReadme = 'DeepSeek Harness web profile `0.1.1-rc.2`\n'
    writeFileSync(join(directory, 'package.json'), originalPackage)
    writeFileSync(join(directory, 'dsh-compatibility.json'), originalCompatibility)
    writeFileSync(join(directory, 'README.md'), originalReadme)
    const registry = await registryWith({
      '@deepseek-ai/dsh': ['0.1.2-alpha.3'],
      '@deepseek-ai/dsh-client-ui-settings': ['0.1.2-alpha.3'],
    })

    const update = runUpdater(directory, '0.1.2-alpha.3', registry)
    await expect(update).rejects.toMatchObject({
      stderr: expect.stringContaining('@deepseek-ai/dsh-client-runtime@0.1.2-alpha.3'),
    })
    await expect(update).rejects.toMatchObject({
      stderr: expect.stringContaining('No compatibility files were changed.'),
    })
    expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe(originalPackage)
    expect(readFileSync(join(directory, 'dsh-compatibility.json'), 'utf8')).toBe(originalCompatibility)
    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toBe(originalReadme)
  })
})
