export const LIVE_SECRET_NAMES = Object.freeze(['ALLMODELS_API_KEY', 'DEEPSEEK_API_KEY'])

export function takeLiveSecrets(environment) {
  const secrets = {}
  for (const name of LIVE_SECRET_NAMES) {
    const value = environment[name]
    if (typeof value === 'string' && value.length > 0) secrets[name] = value
  }
  return secrets
}

export function stripLiveSecrets(environment) {
  const clean = { ...environment }
  for (const name of LIVE_SECRET_NAMES) delete clean[name]
  return clean
}

export function parseLiveSecretFile(contents, initial = {}) {
  const secrets = { ...initial }
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?(ALLMODELS_API_KEY|DEEPSEEK_API_KEY)\s*=\s*(.*?)\s*$/u)
    if (!match || secrets[match[1]]) continue
    const raw = match[2]
    secrets[match[1]] = raw.length >= 2 && raw[0] === raw.at(-1) && (raw[0] === '"' || raw[0] === "'")
      ? raw.slice(1, -1)
      : raw
  }
  return secrets
}

export function assertNoLiveSecrets(environment, label) {
  for (const name of LIVE_SECRET_NAMES) {
    if (environment[name] !== undefined) throw new Error(`${label} must not receive ${name}`)
  }
}
