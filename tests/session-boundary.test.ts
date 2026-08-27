import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function sourceFiles(dir: string): Promise<string[]> {
  const paths: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) paths.push(...await sourceFiles(path))
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) paths.push(path)
  }
  return paths
}

describe('session persistence boundary', () => {
  it('does not import session or filesystem persistence APIs', async () => {
    const forbidden = [/@deepseek-ai\/dsh-session/u, /ctx\.sessions\b/u, /sessionStorage\b/u, /node:fs/u]
    const violations: string[] = []
    for (const path of await sourceFiles(join(process.cwd(), 'src'))) {
      const source = await readFile(path, 'utf8')
      for (const pattern of forbidden) if (pattern.test(source)) violations.push(`${path}: ${String(pattern)}`)
    }
    expect(violations).toEqual([])
  })
})
