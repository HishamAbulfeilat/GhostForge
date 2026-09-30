const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_BODY_LIMIT = 1024 * 1024
const AGENT_TEAM_COMMAND_TIMEOUT_MS = 15_000
const VALID_ACTIONS = Object.freeze(['status', 'start', 'stop', 'say', 'add'])
const TEAM_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'agents', 'team.mjs')

function repoRootFromLib() {
  return path.resolve(__dirname, '..', '..')
}

function realpathIfExists(target) {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

function resolveWorkspaceRoot(workspaceRoot = repoRootFromLib(), targetPath) {
  const root = realpathIfExists(workspaceRoot)
  const candidate = targetPath === undefined ? root : path.isAbsolute(targetPath) ? targetPath : path.resolve(root, targetPath)

  let resolvedCandidate = candidate
  try {
    resolvedCandidate = fs.realpathSync.native(candidate)
  } catch {
    let cursor = candidate
    let parent = path.dirname(cursor)
    while (parent && parent !== path.dirname(parent)) {
      try {
        const realParent = fs.realpathSync.native(parent)
        resolvedCandidate = path.join(realParent, path.relative(parent, cursor))
        break
      } catch {
        if (parent === root || parent === path.dirname(parent)) break
        cursor = parent
        parent = path.dirname(parent)
      }
    }
    if (!resolvedCandidate) resolvedCandidate = path.resolve(candidate)
  }

  const relative = path.relative(root, resolvedCandidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedCandidate
  }
  throw new Error(`Workspace escape detected: ${resolvedCandidate} is outside ${root}`)
}

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function readMessages(stateDir) {
  const file = path.join(stateDir, 'messages.jsonl')
  if (!fs.existsSync(file)) return []
  const text = fs.readFileSync(file, 'utf8')
  const entries = []
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line)
      entries.push(parsed)
    } catch {
      // ignore malformed or partial lines
    }
  }
  return entries
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function normalizeAreaValue(value) {
  if (Array.isArray(value)) return value.map(entry => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(entry => entry.trim()).filter(Boolean)
  return []
}

function normalizeAgentTeamAction(input = {}) {
  const source = input && typeof input === 'object' ? { ...input } : {}
  const actionName = String(source.action ?? '').trim().toLowerCase()
  const action = actionName === 'add_task' ? 'add' : actionName

  if (action === 'status' || action === 'start' || action === 'stop') {
    return { action, ...source }
  }

  if (action === 'say') {
    const from = String(source.from ?? source.sender ?? 'boss').trim() || 'boss'
    const to = String(source.to ?? source.target ?? 'all').trim() || 'all'
    const message = String(source.message ?? source.text ?? '').trim()
    if (!message) {
      throw new Error('Agent team say requires a message value')
    }
    return { action: 'say', from, to, message }
  }

  if (action === 'add') {
    const title = String(source.title ?? source.task ?? source.name ?? '').trim()
    if (!title) {
      throw new Error('Agent team add requires a title')
    }
    const kind = String(source.kind ?? 'feature').trim() || 'feature'
    const area = normalizeAreaValue(source.area)
    const agent = String(source.agent ?? source.assignee ?? 'any').trim() || 'any'
    const from = String(source.from ?? source.sender ?? 'human').trim() || 'human'
    return {
      action: 'add',
      title,
      kind,
      area,
      agent,
      from,
    }
  }

  if (!action) {
    throw new Error('Agent team action is required')
  }

  if (VALID_ACTIONS.includes(action)) {
    return { action, ...source }
  }

  throw new Error(`Unsupported agent team action: "${action}"`)
}

function buildAgentTeamCliArgs(action, params = {}) {
  const normalized = normalizeAgentTeamAction({ action, ...params })
  switch (normalized.action) {
    case 'status':
      return ['status']
    case 'start':
      return ['start']
    case 'stop':
      return ['stop']
    case 'say':
      return ['say', '--from', normalized.from, '--to', normalized.to, normalized.message]
    case 'add': {
      const args = ['add', normalized.title, '--kind', normalized.kind]
      if (normalized.area.length) args.push('--area', normalized.area.join(','))
      if (normalized.agent) args.push('--agent', normalized.agent)
      if (normalized.from) args.push('--from', normalized.from)
      return args
    }
    default:
      return [normalized.action]
  }
}

function getStateDirectory(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const stateDir = stateDirOverride && String(stateDirOverride).trim()
    ? stateDirOverride
    : path.join(root, '.agent-sync', 'state')
  return resolveWorkspaceRoot(root, stateDir)
}

function readAgentTeamSnapshot(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const stateDir = getStateDirectory(root, stateDirOverride)
  const status = readJsonFile(path.join(stateDir, 'status.json'), null)
  const board = readJsonFile(path.join(stateDir, 'board.json'), { phase: 1, tasks: [] })
  const teamConfig = readJsonFile(path.join(root, '.agent-sync', 'team.json'), {})
  const agents = {}

  for (const [agentId, agentStatus] of Object.entries(status?.agents ?? {})) {
    const info = agentStatus && typeof agentStatus === 'object' ? agentStatus : {}
    agents[agentId] = {
      provider: teamConfig?.agents?.[agentId]?.provider ?? info.provider ?? null,
      state: info.state ?? 'unknown',
      task: info.task ?? null,
      model: info.model ?? null,
      cooldownUntil: info.cooldownUntil ?? null,
    }
  }

  const tasks = Array.isArray(board.tasks) ? board.tasks.map(task => ({
    id: task.id ?? null,
    title: task.title ?? '',
    kind: task.kind ?? 'feature',
    status: task.status ?? 'todo',
    owner: task.owner ?? task.agent ?? null,
  })) : []

  return {
    snapshot: {
      health: status?.health ?? null,
      running: Boolean(status && status.pid && isProcessRunning(status.pid)),
      agents,
      tasks,
      messages: readMessages(stateDir),
      phase: Number(board.phase ?? status?.phase ?? 1) || 1,
    },
  }
}

async function readRequestJsonWithLimit(request, limit = DEFAULT_BODY_LIMIT) {
  if (!request || !request.body) return {}
  const reader = request.body.getReader ? request.body.getReader() : null
  if (!reader) return {}

  const chunks = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    total += bytes.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error(`Request body exceeds the ${limit} byte limit`)
    }
    chunks.push(bytes)
  }

  if (!chunks.length) return {}
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(merged)
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    throw new Error('Request body must be valid JSON')
  }
}

function runAgentTeamCommand(action, params = {}, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot || repoRootFromLib())
  const env = { ...process.env, ...(options.env || {}) }
  const stateDir = getStateDirectory(workspaceRoot, env.GF_AGENT_STATE || options.stateDirOverride)
  env.GF_AGENT_STATE = stateDir

  try {
    const args = buildAgentTeamCliArgs(action, params)
    const result = (options.runner || spawnSync)(process.execPath, [TEAM_SCRIPT, ...args], {
      cwd: workspaceRoot,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: AGENT_TEAM_COMMAND_TIMEOUT_MS,
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()

    if (result.error) {
      const failure = result.error.message || 'Unknown child_process error'
      const timedOut = /timed out|ETIMEDOUT/i.test(failure)
      return {
        ok: false,
        action: normalizeAgentTeamAction({ action, ...params }).action,
        output: timedOut
          ? `Agent-team command timed out after ${AGENT_TEAM_COMMAND_TIMEOUT_MS}ms: ${failure}`
          : `Agent-team command failed: ${failure}`,
        code: null,
      }
    }

    return {
      ok: result.status === 0,
      action: normalizeAgentTeamAction({ action, ...params }).action,
      output: output || (result.status === 0 ? 'Command completed.' : `Agent-team command failed with exit code ${result.status ?? 'unknown'}.`),
      code: result.status ?? null,
    }
  } catch (error) {
    return {
      ok: false,
      action: normalizeAgentTeamAction({ action, ...params }).action,
      output: `Agent-team command failed: ${error.message}`,
      code: null,
    }
  }
}

module.exports = {
  DEFAULT_BODY_LIMIT,
  AGENT_TEAM_COMMAND_TIMEOUT_MS,
  VALID_ACTIONS,
  repoRootFromLib,
  resolveWorkspaceRoot,
  readAgentTeamSnapshot,
  readRequestJsonWithLimit,
  normalizeAgentTeamAction,
  buildAgentTeamCliArgs,
  runAgentTeamCommand,
  getStateDirectory,
}
