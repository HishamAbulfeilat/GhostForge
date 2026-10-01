import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const ECC_DEFAULT_REF = 'v2.2.2'
export const ECC_OFFICIAL_REPOSITORY = 'https://github.com/affaan-m/ECC.git'

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function loadECCConfig(root) {
  const file = path.join(root, '.agent-sync', 'ecc.json')
  if (!fs.existsSync(file)) return { enabled: false }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    enabled: config.enabled !== false,
    repository: config.repository || ECC_OFFICIAL_REPOSITORY,
    ref: config.ref || ECC_DEFAULT_REF,
    maxContextBytes: Number(config.maxContextBytes) || 48_000,
    coreSkills: Array.isArray(config.coreSkills) ? config.coreSkills : [],
    taskSkills: config.taskSkills && typeof config.taskSkills === 'object' ? config.taskSkills : {},
    reviewSkills: Array.isArray(config.reviewSkills) ? config.reviewSkills : [],
    planningSkills: Array.isArray(config.planningSkills) ? config.planningSkills : [],
  }
}

export function eccCacheDir(stateDirectory) {
  return path.join(stateDirectory, 'ecc', 'source')
}

export function ensureECC(config, stateDirectory, { offline = false } = {}) {
  if (!config.enabled) return { enabled: false, cache: null, ref: null }
  if (config.repository !== ECC_OFFICIAL_REPOSITORY) {
    throw new Error(`ECC repository must be the official source: ${ECC_OFFICIAL_REPOSITORY}`)
  }

  const cache = eccCacheDir(stateDirectory)
  if (!fs.existsSync(path.join(cache, '.git'))) {
    if (offline) throw new Error(`ECC ${config.ref} is not cached and offline setup was requested`)
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    git(path.dirname(cache), 'clone', '--depth', '1', '--branch', config.ref, config.repository, cache)
  } else if (!offline) {
    git(cache, 'fetch', '--depth', '1', 'origin', config.ref)
    git(cache, 'checkout', '--detach', 'FETCH_HEAD')
  }

  const installedRef = git(cache, 'describe', '--tags', '--exact-match', 'HEAD')
  if (installedRef !== config.ref) {
    throw new Error(`ECC cache is ${installedRef || 'unversioned'}, expected ${config.ref}`)
  }
  return { enabled: true, cache, ref: installedRef }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))]
}

export function skillsFor(config, { kind = 'feature', mode = 'work', area = [] } = {}) {
  const selected = [...config.coreSkills]
  if (mode === 'review') selected.push(...config.reviewSkills)
  else if (mode === 'planning') selected.push(...config.planningSkills)
  else selected.push(...(config.taskSkills[kind] ?? []))

  const areaText = area.join('/').toLowerCase()
  if (areaText.includes('web-ui') || areaText.includes('frontend')) selected.push('frontend-patterns')
  if (areaText.includes('api') || areaText.includes('bridge') || areaText.includes('mcp')) selected.push('backend-patterns')
  return unique(selected)
}

export function buildECCContext(config, cache, options = {}) {
  if (!config.enabled || !cache) return ''
  const names = skillsFor(config, options)
  const sections = [
    `# ECC ${config.ref} task context`,
    '',
    'Source: official affaan-m/ECC release. Repository rules and the current task override this supplementary guidance.',
    'Apply only the relevant guidance; do not invent unavailable hooks, commands, or tools.',
  ]
  let bytes = Buffer.byteLength(sections.join('\n'))

  for (const name of names) {
    const candidates = [
      path.join(cache, '.agents', 'skills', name, 'SKILL.md'),
      path.join(cache, 'skills', name, 'SKILL.md'),
    ]
    const file = candidates.find(candidate => fs.existsSync(candidate))
    if (!file) throw new Error(`ECC skill "${name}" is missing from ${config.ref}`)
    const content = fs.readFileSync(file, 'utf8')
    const section = `\n\n---\n\n## ${name}\n\n${content}`
    const size = Buffer.byteLength(section)
    if (bytes + size > config.maxContextBytes) {
      sections.push(`\n\n> Context limit reached; omitted remaining ECC skills after "${name}".`)
      break
    }
    sections.push(section)
    bytes += size
  }
  return sections.join('\n')
}

export function stageECCContext(worktree, content) {
  if (!content) return null
  const file = path.join(worktree, '.agent-sync', 'state', 'ecc-context.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

export function clearECCContext(file) {
  if (file) fs.rmSync(file, { force: true })
}
