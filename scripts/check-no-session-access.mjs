import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const forbidden = [
  /@deepseek-ai\/dsh-session/,
  /@deepseek-ai\/dsh-client-runtime\/client\/sessions/,
  /ctx\.sessions\b/,
  /sessionStorage\b/,
  /node:fs/,
]

async function files(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await files(path))
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

const violations = []
for (const path of await files(fileURLToPath(new URL('../src', import.meta.url)))) {
  const source = await readFile(path, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(source)) violations.push(`${path}: ${String(pattern)}`)
  }
}
if (violations.length > 0) {
  console.error('Session/file persistence boundary violated:\n' + violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('Session persistence boundary: clean')
}
