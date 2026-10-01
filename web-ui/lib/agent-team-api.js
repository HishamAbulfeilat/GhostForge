const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_BODY_LIMIT = 1024 * 1024
const AGENT_TEAM_COMMAND_TIMEOUT_MS = 15_000
const AGENT_SESSION_CONNECTOR_VERSION = 1
const AGENT_SESSION_CONNECTOR_MAX_BYTES = 65536
const AGENT_SESSION_CONNECTOR_TIMEOUT_MS = 5000
const AGENT_SESSION_CONNECTOR_MAX_COUNT = 20
const AGENT_SESSION_CONNECTOR_MAX_RECORDS = 100
const AGENT_SESSION_CONNECTOR_MAX_STRING_LENGTH = 256
const AGENT_SESSION_CONNECTOR_MAX_LIST_ITEMS = 10
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
  const workflowMode = (typeof board.workflow?.mode === 'string' ? board.workflow.mode.trim() : '') || (typeof status?.workflow?.mode === 'string' ? status.workflow.mode.trim() : '') || (typeof teamConfig.workflow?.mode === 'string' ? teamConfig.workflow.mode.trim() : '') || 'parallel'
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
  const id = boundedConnectorString(value.id, 128) ?? boundedConnectorString(value.name, 128)
  if (!id) return null

  const source = value.source === 'cloud' || value.source === 'device' ? value.source : 'local'
  const provider = boundedConnectorString(value.provider)
  const project = boundedConnectorString(value.project)
  const device = boundedConnectorString(value.device)
  const rawUrl = boundedConnectorString(value.url, 2048)
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
    ? Object.fromEntries(Object.entries(value.headers).slice(0, 32).map(([key, inner]) => {
        const normalizedKey = String(key).toLowerCase()
        const safeValue = boundedConnectorString(typeof inner === 'string' ? inner : String(inner), 2048) ?? ''
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

function boundedConnectorString(value, maxLength = AGENT_SESSION_CONNECTOR_MAX_STRING_LENGTH) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function rawConnectorEntries(value) {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

function connectorRequestHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const headers = {}
  for (const [key, rawValue] of Object.entries(value).slice(0, 32)) {
    const name = key.trim()
    const rendered = typeof rawValue === 'string' ? rawValue : String(rawValue)
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(rendered)) continue
    if (/^(host|content-length|connection|transfer-encoding)$/i.test(name)) continue
    headers[name] = rendered.slice(0, 2048)
  }
  return headers
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

function projectedString(value, maxLength = AGENT_SESSION_CONNECTOR_MAX_STRING_LENGTH) {
  return boundedConnectorString(value, maxLength)
}

function projectedStringList(value, maxItems = AGENT_SESSION_CONNECTOR_MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return []
  return value.slice(0, maxItems)
    .map(item => projectedString(item, 160))
    .filter(Boolean)
}

function projectAgentRecords(agents) {
  if (!agents || typeof agents !== 'object') return []
  const entries = Array.isArray(agents)
    ? agents.slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS).map(item => [item?.id, item])
    : Object.entries(agents).slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS)
  return entries.flatMap(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    if (!Object.keys(value).length) return []
    const id = projectedString(typeof key === 'string' ? key : value.id, 128)
    if (!id) return []
    const result = { id }
    for (const field of ['state', 'provider', 'task', 'model', 'since', 'cooldownUntil', 'assignee', 'role']) {
      const fieldValue = projectedString(value[field])
      if (fieldValue) result[field] = fieldValue
    }
    if (typeof value.leader === 'boolean') result.leader = value.leader
    if (Array.isArray(value.strengths)) result.strengths = projectedStringList(value.strengths)
    return [result]
  })
}

function projectTaskRecords(tasks) {
  if (!Array.isArray(tasks)) return []
  return tasks.slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    if (!Object.keys(value).length) return []
    const result = {}
    for (const field of ['id', 'title', 'kind', 'status', 'owner', 'assignee', 'leader']) {
      const fieldValue = projectedString(value[field], field === 'title' ? 512 : 128)
      if (fieldValue) result[field] = fieldValue
    }
    if (Array.isArray(value.dependencies)) result.dependencies = projectedStringList(value.dependencies)
    if (Array.isArray(value.acceptanceCriteria)) result.acceptanceCriteria = projectedStringList(value.acceptanceCriteria)
    return [result]
  })
}

function projectEventRecords(events, source) {
  if (!Array.isArray(events)) return []
  return events.slice(-AGENT_SESSION_CONNECTOR_MAX_RECORDS).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const result = {}
    const ts = normalizedHeartbeat(value.ts)
    const type = projectedString(value.type, 128)
    if (!ts || !type) return []
    result.ts = ts
    result.type = type
    result.source = source
    for (const field of ['project', 'device', 'from', 'to', 'text', 'error']) {
      const fieldValue = projectedString(value[field], field === 'text' ? 512 : 256)
      if (fieldValue) result[field] = fieldValue
    }
    return [result]
  })
}

function normalizedHeartbeat(value) {
  if (typeof value !== 'string' || value.length > 64) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function connectorStatus(heartbeat, staleAfterMs, active = true) {
  if (!heartbeat || !active) return 'offline'
  const age = Date.now() - Date.parse(heartbeat)
  if (!Number.isFinite(age) || age < -60_000) return 'offline'
  return age > staleAfterMs ? 'stale' : 'online'
}

function offlineConnector(config, project, error) {
  const eventTime = new Date().toISOString()
  return {
    id: config.id,
    version: AGENT_SESSION_CONNECTOR_VERSION,
    source: config.source,
    project,
    device: config.device ?? null,
    provider: config.provider ?? null,
    status: 'offline',
    heartbeat: null,
    staleAfterMs: config.staleAfterMs ?? 30_000,
    stale: true,
    online: false,
    error,
    agents: [],
    tasks: [],
    events: [{ ts: eventTime, type: 'connector.error', source: config.source, error }],
  }
}

function projectLocalConnector(root) {
  const snapshot = readAgentTeamSnapshot(root).snapshot
  const statusFile = path.join(getStateDirectory(root), 'status.json')
  let heartbeat = null
  try {
    heartbeat = new Date(fs.statSync(statusFile).mtimeMs).toISOString()
  } catch {
    // Missing/unreadable runtime status is represented explicitly as offline below.
  }
  const staleAfterMs = 30_000
  const status = connectorStatus(heartbeat, staleAfterMs, snapshot.running)
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages.slice(-AGENT_SESSION_CONNECTOR_MAX_RECORDS).map(message => ({
    ts: message?.ts,
    type: 'runtime.message',
    from: message?.from,
    to: message?.to,
    text: message?.text,
  })) : []
  const events = projectEventRecords(messages, 'local')
  return {
    id: 'ghostforge-local',
    version: AGENT_SESSION_CONNECTOR_VERSION,
    source: 'local',
    project: '.',
    device: null,
    provider: 'ghostforge',
    status,
    heartbeat,
    staleAfterMs,
    stale: status !== 'online',
    online: status === 'online',
    error: status === 'offline'
      ? !heartbeat
        ? 'Runtime status is unavailable'
        : !snapshot.running
          ? 'Runtime process is not running'
          : 'Runtime heartbeat is outside the valid time range'
      : null,
    agents: projectAgentRecords(snapshot.agents),
    tasks: projectTaskRecords(snapshot.tasks),
    events,
  }
}

async function readConnectorPayload(response) {
  if (!response.ok) throw new Error(`Connector returned HTTP status ${response.status}`)
  const declaredLength = Number(response.headers?.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > AGENT_SESSION_CONNECTOR_MAX_BYTES) {
    throw new Error('Connector response exceeded the size limit')
  }
  const reader = response.body?.getReader?.()
  if (!reader) throw new Error('Connector response body is unavailable')
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > AGENT_SESSION_CONNECTOR_MAX_BYTES) {
      await reader.cancel()
      throw new Error('Connector response exceeded the size limit')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('Connector response was not valid JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Connector snapshot must be an object')
  }
  return payload.snapshot && typeof payload.snapshot === 'object' && !Array.isArray(payload.snapshot)
    ? payload.snapshot
    : payload
}

function validateConnectorPayload(payload) {
  const heartbeat = normalizedHeartbeat(payload.heartbeat)
  if (!heartbeat) throw new Error('Connector heartbeat is missing or invalid')
  for (const field of ['agents', 'tasks', 'events']) {
    if (payload[field] !== undefined && !Array.isArray(payload[field])) {
      throw new Error(`Connector ${field} must be an array`)
    }
  }
  if (payload.status !== undefined && !['online', 'stale', 'offline'].includes(payload.status)) {
    throw new Error('Connector status is invalid')
  }
  if (payload.online !== undefined && typeof payload.online !== 'boolean') {
    throw new Error('Connector online status is invalid')
  }
  return heartbeat
}

async function readRemoteConnector(config, headers, project) {
  const staleAfterMs = config.staleAfterMs ?? 30_000
  if (!project) return offlineConnector(config, null, 'Connector project path escapes the workspace root')
  if (!config.url) return offlineConnector(config, project, 'Connector URL is not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? AGENT_SESSION_CONNECTOR_TIMEOUT_MS)
  try {
    const response = await fetch(config.url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'error',
    })
    const payload = await readConnectorPayload(response)
    const heartbeat = validateConnectorPayload(payload)
    const reportedOffline = payload.status === 'offline' || payload.online === false
    const heartbeatStatus = connectorStatus(heartbeat, staleAfterMs)
    const status = reportedOffline || heartbeatStatus === 'offline'
      ? 'offline'
      : payload.status === 'stale'
        ? 'stale'
        : heartbeatStatus
    const agents = projectAgentRecords(payload.agents ?? [])
    const tasks = projectTaskRecords(payload.tasks ?? [])
    const events = projectEventRecords(payload.events ?? [], config.source)
    if (status === 'offline') {
      const error = reportedOffline ? 'Connector reports offline' : 'Connector heartbeat is outside the valid time range'
      return { ...offlineConnector(config, project, error), heartbeat }
    }
    return {
      id: config.id,
      version: AGENT_SESSION_CONNECTOR_VERSION,
      source: config.source,
      project,
      device: config.device ?? null,
      provider: config.provider ?? null,
      status,
      heartbeat,
      staleAfterMs,
      stale: status === 'stale',
      online: status === 'online',
      error: null,
      agents,
      tasks,
      events,
    }
  } catch (error) {
    const message = controller.signal.aborted
      ? 'Connector request timed out'
      : error instanceof Error && /^Connector (?:returned HTTP status \d+|response exceeded the size limit|response body is unavailable|response was not valid JSON|snapshot must be an object|heartbeat is missing or invalid|agents must be an array|tasks must be an array|events must be an array|status is invalid|online status is invalid)/.test(error.message)
        ? error.message
        : 'Connector request failed'
    return offlineConnector(config, project, message)
  } finally {
    clearTimeout(timer)
  }
}

async function readConnectorSnapshot(connectorConfig, workspaceRoot = repoRootFromLib()) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const rawConfigs = rawConnectorEntries(connectorConfig)
  if (rawConfigs.length > AGENT_SESSION_CONNECTOR_MAX_COUNT) {
    throw new Error(`Connector configuration exceeds the ${AGENT_SESSION_CONNECTOR_MAX_COUNT} connector limit`)
  }
  const configs = rawConfigs.map(raw => ({
    config: normalizeSessionConnectorConfig(raw),
    headers: connectorRequestHeaders(raw?.headers),
  })).filter(entry => entry.config)
  const seen = new Set()
  for (const { config } of configs) {
    const normalizedId = config.id.toLowerCase()
    if (normalizedId === 'ghostforge-local') throw new Error('Connector ID "ghostforge-local" is reserved')
    if (seen.has(normalizedId)) throw new Error('Duplicate connector IDs are not allowed')
    seen.add(normalizedId)
  }
  const mode = configs.some(({ config }) => config.allow) ? 'allowlisted' : 'local-only'
  const local = projectLocalConnector(root)
  const remotes = await Promise.all(configs
    .filter(({ config }) => config.allow && (config.source === 'cloud' || config.source === 'device'))
    .map(({ config, headers }) => readRemoteConnector(
      config,
      headers,
      resolveSafeProjectPath(root, config.project),
    )))

  return { version: AGENT_SESSION_CONNECTOR_VERSION, mode, connectors: [local, ...remotes] }
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
