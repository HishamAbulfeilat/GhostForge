const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_BODY_LIMIT = 1024 * 1024
const AGENT_TEAM_COMMAND_TIMEOUT_MS = 15_000
const AGENT_SESSION_CONNECTOR_VERSION = 1
const AGENT_SESSION_CONNECTOR_MAX_BYTES = 65536
const AGENT_SESSION_CONNECTOR_TIMEOUT_MS = 5000
const VALID_ACTIONS = Object.freeze(['status', 'start', 'stop', 'say', 'add', 'dispatch'])
const TEAM_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'agents', 'team.mjs')

function repoRootFromLib() {
  return path.resolve(__dirname, '..', '..')
}

function sanitizeConnectorString(value, fallback = null) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
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

function normalizeStringList(value) {
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

  if (action === 'add' || action === 'dispatch') {
    const title = String(source.title ?? source.task ?? source.name ?? '').trim()
    if (!title) {
      throw new Error('Agent team add requires a title')
    }
    const kind = String(source.kind ?? 'feature').trim() || 'feature'
    const area = normalizeAreaValue(source.area)
    const agent = String(source.agent ?? source.assignee ?? 'any').trim() || 'any'
    const leader = String(source.leader ?? source.boss ?? '').trim() || null
    const workflowMode = String(source.workflow ?? source.mode ?? source.workflowMode ?? 'parallel').trim() || 'parallel'
    const dependencies = normalizeStringList(source.dependencies)
    const acceptanceCriteria = normalizeStringList(source.acceptanceCriteria)
    const from = String(source.from ?? source.sender ?? 'human').trim() || 'human'
    return {
      action: action === 'dispatch' ? 'dispatch' : 'add',
      title,
      kind,
      area,
      agent,
      assignee: agent,
      leader,
      workflow: workflowMode,
      dependencies,
      acceptanceCriteria,
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
      if (normalized.leader) args.push('--leader', normalized.leader)
      if (normalized.assignee && String(normalized.assignee) !== String(normalized.agent)) args.push('--assignee', normalized.assignee)
      if (normalized.workflow) args.push('--workflow', normalized.workflow)
      if (normalized.dependencies && normalized.dependencies.length) args.push('--dependencies', normalized.dependencies.join(','))
      if (normalized.acceptanceCriteria && normalized.acceptanceCriteria.length) args.push('--acceptance-criteria', normalized.acceptanceCriteria.join(';'))
      if (normalized.from) args.push('--from', normalized.from)
      return args
    }
    case 'dispatch': {
      return buildAgentTeamCliArgs('add', { ...params, action: 'add', workflow: String((params.workflow ?? params.mode ?? params.workflowMode ?? 'parallel') || 'parallel') })
    }
    default:
      return [normalized.action]
  }
}

function getStateDirectory(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const rawStateDir = stateDirOverride && String(stateDirOverride).trim()
    ? String(stateDirOverride).trim()
    : path.join(root, '.agent-sync', 'state')

  if (rawStateDir === path.join(root, '.agent-sync', 'state')) {
    return rawStateDir
  }

  try {
    return resolveWorkspaceRoot(root, rawStateDir)
  } catch {
    return path.join(root, '.agent-sync', 'state')
  }
}

function readAgentTeamSnapshot(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const stateDir = getStateDirectory(root, stateDirOverride)
  const status = readJsonFile(path.join(stateDir, 'status.json'), null)
  const board = readJsonFile(path.join(stateDir, 'board.json'), { phase: 1, tasks: [] })
  const teamConfig = readJsonFile(path.join(root, '.agent-sync', 'team.json'), {})
  const configuredAgents = teamConfig && typeof teamConfig.agents === 'object' && !Array.isArray(teamConfig.agents)
    ? teamConfig.agents
    : {}
  const reportedAgents = status && typeof status.agents === 'object' && !Array.isArray(status.agents)
    ? status.agents
    : {}
  const agentIds = new Set([...Object.keys(configuredAgents), ...Object.keys(reportedAgents)])
  const bossConfig = teamConfig && typeof teamConfig.boss === 'object' ? teamConfig.boss : {}
  const statusBoss = status && typeof status.boss === 'object' ? status.boss : {}
  const workloadLeader = (typeof statusBoss.leader === 'string' ? statusBoss.leader.trim() : '') || (typeof statusBoss.id === 'string' ? statusBoss.id.trim() : '') || (typeof bossConfig.leader === 'string' ? bossConfig.leader.trim() : '') || (typeof bossConfig.id === 'string' ? bossConfig.id.trim() : '') || (typeof bossConfig.agent === 'string' ? bossConfig.agent.trim() : '') || null
  const workflowLeader = workloadLeader || [...agentIds].find(agentId => /boss|lead|manager/i.test(agentId)) || null
  const workflowMode = (typeof board.workflow?.mode === 'string' ? board.workflow.mode.trim() : '') || (typeof status.workflow?.mode === 'string' ? status.workflow.mode.trim() : '') || (typeof teamConfig.workflow?.mode === 'string' ? teamConfig.workflow.mode.trim() : '') || 'parallel'
  const agents = {}

  for (const agentId of agentIds) {
    const config = configuredAgents[agentId] && typeof configuredAgents[agentId] === 'object'
      ? configuredAgents[agentId]
      : {}
    const info = reportedAgents[agentId] && typeof reportedAgents[agentId] === 'object'
      ? reportedAgents[agentId]
      : {}
    const configuredProvider = typeof config.provider === 'string' ? config.provider.trim() : ''
    const reportedProvider = typeof info.provider === 'string' ? info.provider.trim() : ''
    const strengths = Array.isArray(config.strengths) ? config.strengths.map(strength => String(strength).trim()).filter(Boolean) : []
    const role = typeof config.role === 'string' && config.role.trim() ? config.role.trim() : (agentId === workflowLeader ? 'leader' : (strengths.length ? 'specialist' : 'agent'))
    agents[agentId] = {
      provider: configuredProvider || reportedProvider || null,
      state: typeof info.state === 'string' && info.state.trim() ? info.state.trim() : 'unknown',
      task: typeof info.task === 'string' && info.task.trim() ? info.task.trim() : null,
      model: typeof info.model === 'string' && info.model.trim() ? info.model.trim() : null,
      since: typeof info.since === 'string' && info.since.trim() ? info.since.trim() : null,
      cooldownUntil: typeof info.cooldownUntil === 'string' && info.cooldownUntil.trim() ? info.cooldownUntil.trim() : null,
      leader: agentId === workflowLeader,
      assignee: typeof info.assignee === 'string' && info.assignee.trim() ? info.assignee.trim() : (typeof info.owner === 'string' && info.owner.trim() ? info.owner.trim() : null),
      role,
      strengths,
    }
  }

  const tasks = Array.isArray(board.tasks) ? board.tasks.map(task => {
    const info = task && typeof task === 'object' ? task : {}
    const owner = typeof info.owner === 'string' && info.owner.trim() ? info.owner.trim() : (typeof info.agent === 'string' ? info.agent.trim() : null)
    const dependencies = Array.isArray(info.dependencies) ? info.dependencies.map(entry => String(entry).trim()).filter(Boolean) : normalizeStringList(info.dependsOn)
    const acceptanceCriteria = Array.isArray(info.acceptanceCriteria)
      ? info.acceptanceCriteria.map(entry => String(entry).trim()).filter(Boolean)
      : (typeof info.acceptanceCriteria === 'string' && info.acceptanceCriteria.trim() ? [info.acceptanceCriteria.trim()] : [])
    return {
      id: typeof info.id === 'string' && info.id.trim() ? info.id.trim() : null,
      title: typeof info.title === 'string' ? info.title : '',
      kind: typeof info.kind === 'string' && info.kind.trim() ? info.kind.trim() : 'feature',
      status: typeof info.status === 'string' && info.status.trim() ? info.status.trim() : 'todo',
      owner,
      assignee: typeof info.assignee === 'string' && info.assignee.trim() ? info.assignee.trim() : owner,
      leader: typeof info.leader === 'string' && info.leader.trim() ? info.leader.trim() : workflowLeader,
      dependencies,
      acceptanceCriteria,
    }
  }) : []

  const specialists = [...agentIds].filter(agentId => agentId !== workflowLeader)

  return {
    snapshot: {
      health: status?.health ?? null,
      running: Boolean(status && status.pid && isProcessRunning(status.pid)),
      agents,
      tasks,
      messages: readMessages(stateDir),
      phase: Number(board.phase ?? status?.phase ?? 1) || 1,
      workflow: {
        leader: workflowLeader,
        mode: workflowMode,
        specialists,
      },
    },
  }
}

function normalizeSessionConnectorConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = sanitizeConnectorString(value.id) ?? sanitizeConnectorString(value.name)
  if (!id) return null

  const source = value.source === 'cloud' || value.source === 'device' ? value.source : 'local'
  const provider = sanitizeConnectorString(value.provider)
  const project = sanitizeConnectorString(value.project)
  const device = sanitizeConnectorString(value.device)
  const rawUrl = sanitizeConnectorString(value.url)
  let url = null
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl)
      parsed.username = ''
      parsed.password = ''
      url = /^https?:\/\//i.test(parsed.toString()) ? parsed.toString() : null
    } catch {
      return null
    }
  }

  const timeoutMs = Number.isFinite(value.timeoutMs) && value.timeoutMs != null
    ? Math.max(250, Math.min(60_000, Number(value.timeoutMs)))
    : AGENT_SESSION_CONNECTOR_TIMEOUT_MS
  const staleAfterMs = Number.isFinite(value.staleAfterMs) && value.staleAfterMs != null
    ? Math.max(1_000, Math.min(86_400_000, Number(value.staleAfterMs)))
    : 30_000
  const allow = value.allow === true

  const headers = value.headers && typeof value.headers === 'object' && !Array.isArray(value.headers)
    ? Object.fromEntries(Object.entries(value.headers).map(([key, inner]) => {
        const normalizedKey = String(key).toLowerCase()
        const safeValue = typeof inner === 'string' ? inner : String(inner)
        if (/authorization|cookie|set-cookie|api[-_ ]?key|token|secret/i.test(normalizedKey)) {
          return [String(key), '[redacted]']
        }
        return [String(key), safeValue]
      }))
    : {}

  const cleaned = { id, source, project: project ?? undefined, device: device ?? undefined, provider: provider ?? undefined, url: url ?? undefined, timeoutMs, staleAfterMs, allow, headers }
  if (cleaned.url && !/^https?:\/\//i.test(cleaned.url)) return null
  return cleaned
}

function normalizeSessionConnectorConfigs(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(item => normalizeSessionConnectorConfig(item)).filter(Boolean)
  }
  const single = normalizeSessionConnectorConfig(value)
  return single ? [single] : []
}

function resolveSafeProjectPath(root, project) {
  if (!project) return '.'
  const trimmed = project.trim()
  if (!trimmed || trimmed === '.') return '.'
  if (path.isAbsolute(trimmed)) return null
  const segments = trimmed.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.some(segment => segment === '..')) return null
  const candidate = path.resolve(root, ...segments)
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return path.relative(root, candidate).replace(/\\/g, '/') || '.'
}

function readConnectorSnapshot(connectorConfig, workspaceRoot = repoRootFromLib()) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const configs = normalizeSessionConnectorConfigs(connectorConfig)
  const mode = configs.some(config => config.allow) ? 'allowlisted' : 'local-only'
  const connectors = [{
    id: 'ghostforge-local',
    version: AGENT_SESSION_CONNECTOR_VERSION,
    source: 'local',
    project: '.',
    device: null,
    provider: 'ghostforge',
    status: 'online',
    heartbeat: new Date().toISOString(),
    staleAfterMs: 30_000,
    stale: false,
    online: true,
    error: null,
    agents: [{ id: 'ghostforge', state: 'online', provider: 'ghostforge' }],
    tasks: [{ id: 'T-local', title: 'GhostForge runtime', status: 'ready', dependencies: [] }],
    events: [{ ts: new Date().toISOString(), type: 'runtime.heartbeat', source: 'local', project: '.' }],
  }]

  if (!configs.some(config => config.allow)) {
    return { version: AGENT_SESSION_CONNECTOR_VERSION, mode, connectors }
  }

  for (const config of configs.filter(config => config.allow)) {
    const threshold = Math.max(1_000, Math.min(86_400_000, config.staleAfterMs ?? 30_000))
    const heartbeat = new Date().toISOString()
    const projectValue = resolveSafeProjectPath(root, config.project)

    if (!projectValue) {
      connectors.push({
        id: config.id,
        version: AGENT_SESSION_CONNECTOR_VERSION,
        source: config.source,
        project: null,
        device: config.device ?? null,
        provider: config.provider ?? null,
        status: 'offline',
        heartbeat,
        staleAfterMs: threshold,
        stale: true,
        online: false,
        error: 'Connector project path escapes the workspace root',
        agents: [],
        tasks: [],
        events: [{ ts: heartbeat, type: 'connector.error', source: config.source, error: 'Connector project path escapes the workspace root' }],
      })
      continue
    }

    connectors.push({
      id: config.id,
      version: AGENT_SESSION_CONNECTOR_VERSION,
      source: config.source,
      project: projectValue,
      device: config.device ?? null,
      provider: config.provider ?? null,
      status: 'online',
      heartbeat,
      staleAfterMs: threshold,
      stale: false,
      online: true,
      error: null,
      agents: [{ id: config.provider ?? config.id, state: 'ready', provider: config.provider ?? config.source }],
      tasks: [{ id: `T-${config.id}`, title: `${config.source} session`, status: 'ready', dependencies: [] }],
      events: [{ ts: heartbeat, type: 'session.heartbeat', source: config.source, project: projectValue, device: config.device ?? null }],
    })
  }

  return { version: AGENT_SESSION_CONNECTOR_VERSION, mode, connectors }
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
  AGENT_SESSION_CONNECTOR_VERSION,
  AGENT_SESSION_CONNECTOR_MAX_BYTES,
  AGENT_SESSION_CONNECTOR_TIMEOUT_MS,
  VALID_ACTIONS,
  repoRootFromLib,
  resolveWorkspaceRoot,
  readAgentTeamSnapshot,
  readRequestJsonWithLimit,
  normalizeAgentTeamAction,
  buildAgentTeamCliArgs,
  runAgentTeamCommand,
  getStateDirectory,
  normalizeSessionConnectorConfig,
  normalizeSessionConnectorConfigs,
  readConnectorSnapshot,
}
