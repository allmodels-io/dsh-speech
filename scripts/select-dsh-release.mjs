import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RELEASE_PATTERN = /^\d+\.\d+\.\d+(?:-rc(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z.-]+)?$/iu

export function isSupportedHarnessRelease(version) {
  return typeof version === 'string' && RELEASE_PATTERN.test(version)
}

export function selectHarnessRelease(time, requested = '') {
  if (requested !== '') {
    if (!isSupportedHarnessRelease(requested)) {
      throw new Error(`Unsupported DeepSeek Harness release "${requested}". Compatibility tests target stable and rc releases only.`)
    }
    return requested
  }

  if (time === null || typeof time !== 'object' || Array.isArray(time)) {
    throw new Error('DeepSeek Harness release history is not an object')
  }
  const releases = Object.entries(time)
    .filter(([name, publishedAt]) => isSupportedHarnessRelease(name) && !Number.isNaN(Date.parse(publishedAt)))
    .sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))
  if (releases.length === 0) throw new Error('No stable or rc DeepSeek Harness release was found')
  return releases[0][0]
}

async function main() {
  const requested = process.argv[2]?.trim() ?? ''
  const time = requested === '' ? JSON.parse(readFileSync(0, 'utf8')) : {}
  process.stdout.write(selectHarnessRelease(time, requested))
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
