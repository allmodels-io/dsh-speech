import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error('Usage: node scripts/update-dsh-version.mjs <semver>')
}

const root = process.env.DSH_SPEECH_UPDATE_ROOT === undefined
  ? resolve(import.meta.dirname, '..')
  : resolve(process.env.DSH_SPEECH_UPDATE_ROOT)
const packagePath = resolve(root, 'package.json')
const compatibilityPath = resolve(root, 'dsh-compatibility.json')
const readmePath = resolve(root, 'README.md')
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const compatibility = JSON.parse(readFileSync(compatibilityPath, 'utf8'))
const previousVersion = compatibility.testedVersion

if (typeof previousVersion !== 'string') throw new Error('dsh-compatibility.json is missing testedVersion')

const dependencyNames = Object.keys(packageJson.peerDependencies ?? {})
  .filter(name => name.startsWith('@deepseek-ai/dsh-'))

for (const name of dependencyNames) {
  packageJson.peerDependencies[name] = version
  if (packageJson.devDependencies?.[name] !== undefined) packageJson.devDependencies[name] = version
}

compatibility.testedVersion = version
let readme = readFileSync(readmePath, 'utf8')
readme = readme.replace(
  /DeepSeek Harness web profile `[^`]+`/u,
  `DeepSeek Harness web profile \`${version}\``,
)
readme = readme.replace(
  /disposable DeepSeek Harness `[^`]+` web profile/u,
  `disposable DeepSeek Harness \`${version}\` web profile`,
)

writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
writeFileSync(compatibilityPath, `${JSON.stringify(compatibility, null, 2)}\n`)
writeFileSync(readmePath, readme)

console.log(`Updated DeepSeek Harness compatibility from ${previousVersion} to ${version}`)
