import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  LIVE_SECRET_NAMES,
  assertNoLiveSecrets,
  parseLiveSecretFile,
  stripLiveSecrets,
  takeLiveSecrets,
} from './e2e-secrets.mjs'

const mode = process.argv[2]
if (mode !== 'mock' && mode !== 'live') throw new Error('Expected E2E mode: mock or live')

// Capture secrets in this dependency-free coordinator, then remove them from the
// ambient environment before any package manager, build, pack, or browser process starts.
const inheritedLiveSecrets = takeLiveSecrets(process.env)
for (const name of LIVE_SECRET_NAMES) delete process.env[name]

const root = resolve(import.meta.dirname, '..')
const runRoot = mkdtempSync(join(tmpdir(), `dsh-speech-e2e-${mode}-`))
const dshHome = join(runRoot, 'dsh-home')
const packageDir = join(runRoot, 'package')
const workspaceDir = join(runRoot, 'workspace')
const audioFile = join(runRoot, 'microphone.wav')
const dshVersion = '0.1.1-rc.2'
const children = []
let interrupted = false

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true
    for (const child of children) {
      if (child.exitCode === null) child.kill(signal)
    }
  })
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('Unable to allocate an E2E port'))
        return
      }
      probe.close(error => { error === undefined ? resolvePromise(address.port) : reject(error) })
    })
  })
}

function createAudioFixture(path) {
  const sampleRate = 48_000
  const seconds = 8
  const samples = sampleRate * seconds
  const dataBytes = samples * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples; index += 1) {
    const envelope = 0.25 + 0.65 * Math.abs(Math.sin(2 * Math.PI * index / sampleRate / 1.4))
    const value = Math.sin(2 * Math.PI * 220 * index / sampleRate) * envelope
    wav.writeInt16LE(Math.round(value * 24_000), 44 + index * 2)
  }
  writeFileSync(path, wav)
}

function createWorkspaceFixture() {
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  const storageDir = join(dshHome, 'storages')
  mkdirSync(workspaceDir)
  mkdirSync(storageDir)
  const canonicalWorkspaceDir = realpathSync(workspaceDir)
  writeFileSync(join(workspaceDir, 'README.md'), '# Disposable dsh-speech E2E workspace\n')
  writeFileSync(join(storageDir, 'workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [workspaceId]: {
          path: canonicalWorkspaceDir,
          title: 'dsh-speech E2E',
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }, null, 2)}\n`)
}

function loadLocalSecrets(initial) {
  const path = join(root, '.secrets')
  let contents
  try {
    contents = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return initial
    throw error
  }
  return parseLiveSecretFile(contents, initial)
}

function childEnvironment(options = {}) {
  const env = stripLiveSecrets({ ...process.env, CI: process.env.CI ?? 'true', ...options.env })
  if (options.allowSecrets === true) Object.assign(env, options.secrets)
  else assertNoLiveSecrets(env, options.label ?? 'child process')
  for (const key of options.unsetEnv ?? []) delete env[key]
  return env
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: childEnvironment({ ...options, label: command }) })
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnvironment({ ...options, label: command }),
  })
  children.push(child)
  if (options.quiet === true) {
    child.stdout.resume()
    child.stderr.resume()
  } else {
    child.stdout.on('data', chunk => { process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { process.stderr.write(chunk) })
  }
  return child
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) { lastError = error }
    await new Promise(resolvePromise => { setTimeout(resolvePromise, 200) })
  }
  throw new Error(`${label} did not become ready`, { cause: lastError })
}

async function main() {
  const harnessPort = await freePort()
  const mockPort = await freePort()
  const baseURL = `http://127.0.0.1:${String(harnessPort)}`
  const patchFile = join(runRoot, 'mock.patch.yml')
  mkdirSync(packageDir)
  mkdirSync(dshHome)
  createWorkspaceFixture()
  createAudioFixture(audioFile)
  if (mode === 'mock') {
    writeFileSync(patchFile, [
      '- id: ui-speech',
      '  config:',
      '    apiKeyEnv: ALLMODELS_API_KEY',
      `    baseURL: http://127.0.0.1:${String(mockPort)}`,
      '    lowBalanceUsd: 0.5',
      '    defaultTopUpUsd: 10',
      '',
    ].join('\n'))
  }
  run('pnpm', ['build'])
  const packResult = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packageDir], {
    cwd: root,
    encoding: 'utf8',
    env: childEnvironment({ label: 'npm pack' }),
  })
  const pack = JSON.parse(packResult)
  const filename = pack?.[0]?.filename
  if (typeof filename !== 'string' || basename(filename) !== filename) throw new Error('npm pack did not return a safe tarball filename')
  const tarball = join(packageDir, filename)
  readFileSync(tarball)

  run('pnpm', [`--package=@deepseek-ai/dsh@${dshVersion}`, 'dlx', 'dsh', 'plugin', '--profile', 'web', 'add', tarball], {
    env: { DSH_HOME: dshHome },
  })

  let mock
  let liveSecrets = {}
  if (mode === 'mock') {
    mock = start(process.execPath, ['tests/e2e/mock-allmodels.mjs'], {
      env: { DSH_SPEECH_MOCK_PORT: String(mockPort) },
    })
    await waitFor(`http://127.0.0.1:${String(mockPort)}/health`, mock, 'mock AllModels server')
  } else {
    liveSecrets = loadLocalSecrets(inheritedLiveSecrets)
    if (!liveSecrets.ALLMODELS_API_KEY) throw new Error('ALLMODELS_API_KEY is required for live E2E tests')
    if (!liveSecrets.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required for live E2E tests')
  }

  const dshArgs = [
    `--package=@deepseek-ai/dsh@${dshVersion}`, 'dlx', 'dsh', '--profile', 'web',
    ...(mode === 'mock' ? ['--patch', patchFile] : []),
    '--port', String(harnessPort), '--no-open',
  ]
  const harness = start('pnpm', dshArgs, {
    env: {
      DSH_HOME: dshHome,
      DSH_TELEMETRY_MODE: 'DISABLED',
    },
    allowSecrets: true,
    secrets: mode === 'mock' ? { DEEPSEEK_API_KEY: 'mock-deepseek-key' } : liveSecrets,
    quiet: mode === 'live',
    unsetEnv: mode === 'mock' ? ['ALLMODELS_API_KEY'] : [],
  })
  await waitFor(baseURL, harness, 'DeepSeek Harness')

  run('pnpm', ['exec', 'playwright', 'test', ...(process.env.DSH_SPEECH_E2E_TEST_ARGS?.split(/\s+/).filter(Boolean) ?? [])], {
    env: {
      DSH_SPEECH_E2E_MODE: mode,
      DSH_SPEECH_E2E_BASE_URL: baseURL,
      DSH_SPEECH_E2E_AUDIO_FILE: audioFile,
      CI: process.env.CI ?? 'false',
    },
  })
}

let exitCode = 0
try {
  await main()
} catch (error) {
  exitCode = 1
  console.error(error)
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await Promise.all(children.map(child => child.exitCode !== null ? undefined : new Promise(resolvePromise => {
    child.once('exit', resolvePromise)
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolvePromise() }, 3_000).unref()
  })))
  if (process.env.DSH_SPEECH_E2E_KEEP === '1') {
    console.error(`Preserved E2E directory: ${runRoot}`)
  } else if (runRoot.startsWith(`${tmpdir()}/dsh-speech-e2e-${mode}-`)) {
    rmSync(runRoot, { recursive: true, force: true })
  }
}

process.exitCode = interrupted ? 130 : exitCode
