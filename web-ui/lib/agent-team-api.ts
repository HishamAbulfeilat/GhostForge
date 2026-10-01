import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const DEFAULT_BODY_LIMIT = 1024 * 1024
export const AGENT_TEAM_COMMAND_TIMEOUT_MS = 15_000
export const AGENT_SESSION_CONNECTOR_VERSION = 1
export const AGENT_SESSION_CONNECTOR_MAX_BYTES = 65_536
export const AGENT_SESSION_CONNECTOR_TIMEOUT_MS = 5_000
export const VALID_ACTIONS = ['status', 'start', 'stop', 'say', 'add', 'dispatch'] as const
const AGENT_SESSION_CONNECTOR_MAX_COUNT = 20
const AGENT_SESSION_CONNECTOR_MAX_RECORDS = 100
const AGENT_SESSION_CONNECTOR_MAX_STRING_LENGTH = 256
const AGENT_SESSION_CONNECTOR_MAX_LIST_ITEMS = 10

export type AgentSessionConnectorSource = 'local' | 'cloud' | 'device'

export interface AgentSessionConnectorConfig {
  id: string
  source: AgentSessionConnectorSource
  project?: string
  device?: string
  provider?: string
  url?: string
  timeoutMs?: number
  staleAfterMs?: number
  allow?: boolean
  headers?: Record<string, string>
}

export interface AgentSessionConnectorRecord {
  id: string
  version: number
  source: AgentSessionConnectorSource
  project: string | null
  device: string | null
  provider: string | null
  status: 'online' | 'stale' | 'offline'
  heartbeat: string | null
  staleAfterMs: number
  stale: boolean
  online: boolean
  error: string | null
  agents: Array<Record<string, unknown>>
  tasks: Array<Record<string, unknown>>
  sessions: AgentSessionConnectorSessionRecord[]
  events: Array<Record<string, unknown>>
}

export interface AgentSessionConnectorSessionRecord {
  id: string
  source: AgentSessionConnectorSource
  project: string | null
  device: string | null
  provider: string | null
  name?: string
  status?: string
  state?: string
  agent?: string
  task?: string
  createdAt?: string
  updatedAt?: string
  startedAt?: string
  endedAt?: string
}

export interface AgentSessionConnectorSummary {
  version: number
  mode: 'local-only' | 'allowlisted'
  connectors: AgentSessionConnectorRecord[]
}

type AgentTeamActionName = (typeof VALID_ACTIONS)[number]

interface AgentTeamRequestPayload {
  action?: string
  from?: string
  sender?: string
  to?: string
  target?: string
  message?: string
  text?: string
  title?: string
  task?: string
  name?: string
  kind?: string
  area?: string[] | string
  agent?: string
  assignee?: string
  leader?: string
  workflow?: string
  mode?: string
  workflowMode?: string
  dependencies?: string[] | string
  acceptanceCriteria?: string[] | string
  [key: string]: unknown
}

interface AgentTeamCommandResult {
  ok: boolean
  action: string
  output: string
  code: number | null
}

export function repoRootFromLib(): string {
  return path.resolve(__dirname, '..', '..')
}

export function sanitizeConnectorString(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function realpathIfExists(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

export function resolveWorkspaceRoot(workspaceRoot = repoRootFromLib(), targetPath?: string): string {
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

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function readMessages(stateDir: string) {
  const file = path.join(stateDir, 'messages.jsonl')
  if (!fs.existsSync(file)) return []
  const text = fs.readFileSync(file, 'utf8')
  const entries: Array<Record<string, unknown>> = []
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      entries.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // ignore malformed/partial lines
    }
  }
  return entries
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function normalizeAreaValue(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map(entry => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(entry => entry.trim()).filter(Boolean)
  return []
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(entry => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(entry => entry.trim()).filter(Boolean)
  return []
}

export function normalizeAgentTeamAction(input: AgentTeamRequestPayload = {}): { action: string; [key: string]: unknown } {
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
    const area = normalizeAreaValue(source.area as string[] | string | undefined)
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

  if (VALID_ACTIONS.includes(action as AgentTeamActionName)) {
    return { action, ...source }
  }

  throw new Error(`Unsupported agent team action: "${action}"`)
}

function buildAgentTeamCliArgs(action: string, params: AgentTeamRequestPayload = {}): string[] {
  const normalized = normalizeAgentTeamAction({ action, ...params })
  switch (normalized.action) {
    case 'status':
      return ['status']
    case 'start':
      return ['start']
    case 'stop':
      return ['stop']
    case 'say':
      return ['say', '--from', String(normalized.from), '--to', String(normalized.to), String(normalized.message)]
    case 'add': {
      const args = ['add', String(normalized.title), '--kind', String(normalized.kind)]
      const area = Array.isArray(normalized.area) ? normalized.area : []
      if (area.length) args.push('--area', area.join(','))
      if (normalized.agent) args.push('--agent', String(normalized.agent))
      if (normalized.leader) args.push('--leader', String(normalized.leader))
      if (normalized.assignee && String(normalized.assignee) !== String(normalized.agent)) args.push('--assignee', String(normalized.assignee))
      if (normalized.workflow) args.push('--workflow', String(normalized.workflow))
      if (normalized.dependencies && Array.isArray(normalized.dependencies) && normalized.dependencies.length) args.push('--dependencies', normalized.dependencies.join(','))
      if (normalized.acceptanceCriteria && Array.isArray(normalized.acceptanceCriteria) && normalized.acceptanceCriteria.length) args.push('--acceptance-criteria', normalized.acceptanceCriteria.join(';'))
      if (normalized.from) args.push('--from', String(normalized.from))
      return args
    }
    case 'dispatch': {
      return buildAgentTeamCliArgs('add', { ...params, action: 'add', workflow: String((params.workflow ?? params.mode ?? params.workflowMode ?? 'parallel') || 'parallel') })
    }
    default:
      return [String(normalized.action)]
  }
}

export function getStateDirectory(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE): string {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const rawStateDir = stateDirOverride && String(stateDirOverride).trim() ? String(stateDirOverride).trim() : path.join(root, '.agent-sync', 'state')

  if (rawStateDir === path.join(root, '.agent-sync', 'state')) {
    return rawStateDir
  }

  try {
    return resolveWorkspaceRoot(root, rawStateDir)
  } catch {
    return path.join(root, '.agent-sync', 'state')
  }
}

export function readAgentTeamSnapshot(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE): { snapshot: { health: number | null; running: boolean; agents: Record<string, { provider: string | null; state: string; task: string | null; model: string | null; since: string | null; cooldownUntil: string | null; leader: boolean; assignee: string | null; role: string | null; strengths: string[] }>; tasks: Array<{ id: string | null; title: string; kind: string; status: string; owner: string | null; assignee: string | null; leader: string | null; dependencies: string[]; acceptanceCriteria: string[] }>; messages: Array<Record<string, unknown>>; phase: number; workflow: { leader: string | null; mode: string; specialists: string[] } } } {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const stateDir = getStateDirectory(root, stateDirOverride)
  const status = asRecord(readJsonFile<unknown>(path.join(stateDir, 'status.json'), null))
  const board = asRecord(readJsonFile<unknown>(path.join(stateDir, 'board.json'), {}))
  const teamConfig = asRecord(readJsonFile<unknown>(path.join(root, '.agent-sync', 'team.json'), {}))
  const configuredAgents = asRecord(teamConfig.agents)
  const reportedAgents = asRecord(status.agents)
  const agentIds = new Set([...Object.keys(configuredAgents), ...Object.keys(reportedAgents)])
  const configuredLeader = normalizedString(asRecord(status.boss).leader) ?? normalizedString(asRecord(status.boss).id) ?? normalizedString(asRecord(teamConfig.boss).leader) ?? normalizedString(asRecord(teamConfig.boss).id) ?? normalizedString(asRecord(teamConfig.boss).agent) ?? null
  const workflowLeader = configuredLeader || Object.keys(configuredAgents).find(agentId => /boss|lead|manager/i.test(agentId)) || null
  const workflowMode = normalizedString(asRecord(board.workflow).mode) ?? normalizedString(asRecord(status.workflow).mode) ?? normalizedString(asRecord(teamConfig.workflow).mode) ?? 'parallel'

  const agents = Object.fromEntries([...agentIds].map(agentId => {
    const config = asRecord(configuredAgents[agentId])
    const info = asRecord(reportedAgents[agentId])
    const strengths = Array.isArray(config.strengths) ? config.strengths.map(strength => String(strength).trim()).filter(Boolean) : []
    const role = normalizedString(config.role) ?? (
      agentId === workflowLeader ? 'leader' : (strengths.length ? 'specialist' : 'agent')
    )
    const assignee = normalizedString(info.assignee) ?? normalizedString(info.owner) ?? null
    return [agentId, {
      provider: normalizedString(config.provider) ?? normalizedString(info.provider),
      state: normalizedString(info.state) ?? 'unknown',
      task: normalizedString(info.task),
      model: normalizedString(info.model),
      since: normalizedString(info.since),
      cooldownUntil: normalizedString(info.cooldownUntil),
      leader: agentId === workflowLeader,
      assignee,
      role,
      strengths,
    }]
  }))

  const tasks = Array.isArray(board.tasks) ? board.tasks.map(task => {
    const info = asRecord(task)
    const owner = normalizedString(info.owner) ?? normalizedString(info.agent)
    const assignee = normalizedString(info.assignee) ?? owner
    const dependencies = Array.isArray(info.dependencies) ? info.dependencies.map(entry => String(entry).trim()).filter(Boolean) : normalizeStringList(info.dependsOn)
    const acceptanceCriteria = Array.isArray(info.acceptanceCriteria)
      ? info.acceptanceCriteria.map(entry => String(entry).trim()).filter(Boolean)
      : typeof info.acceptanceCriteria === 'string'
        ? [info.acceptanceCriteria.trim()].filter(Boolean)
        : []
    return {
      id: normalizedString(info.id),
      title: typeof info.title === 'string' ? info.title : '',
      kind: normalizedString(info.kind) ?? 'feature',
      status: normalizedString(info.status) ?? 'todo',
      owner,
      assignee,
      leader: normalizedString(info.leader) ?? workflowLeader,
      dependencies,
      acceptanceCriteria,
    }
  }) : []

  const specialists = [...agentIds].filter(agentId => agentId !== workflowLeader)
  const health = status.health
  const validHealth = typeof health === 'number' && Number.isFinite(health) ? health : null
  const pid = status.pid
  const statusPhase = status.phase
  const boardPhase = board.phase
  const phaseValue = Number(boardPhase ?? statusPhase ?? 1)
  const phase = Number.isFinite(phaseValue) && phaseValue > 0 ? phaseValue : 1

  return {
    snapshot: {
      health: validHealth,
      running: isProcessRunning(typeof pid === 'number' ? pid : Number.NaN),
      agents,
      tasks,
      messages: readMessages(stateDir),
      phase,
      workflow: {
        leader: workflowLeader,
        mode: workflowMode,
        specialists,
      },
    },
  }
}

export function normalizeSessionConnectorConfig(value: unknown): AgentSessionConnectorConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const id = boundedConnectorString(record.id, 128) ?? boundedConnectorString(record.name, 128)
  if (!id) return null

  const source = record.source === 'cloud' || record.source === 'device' ? record.source : 'local'
  const provider = boundedConnectorString(record.provider)
  const project = boundedConnectorString(record.project)
  const device = boundedConnectorString(record.device)
  const rawUrl = boundedConnectorString(record.url, 2048)
  let url: string | null = null
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

  const timeoutMs = typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs)
    ? Math.max(250, Math.min(60_000, record.timeoutMs))
    : AGENT_SESSION_CONNECTOR_TIMEOUT_MS
  const staleAfterMs = typeof record.staleAfterMs === 'number' && Number.isFinite(record.staleAfterMs)
    ? Math.max(1_000, Math.min(86_400_000, record.staleAfterMs))
    : 30_000
  const allow = record.allow === true

  const headers: Record<string, string> = {}
  if (record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)) {
    for (const [key, inner] of Object.entries(record.headers as Record<string, unknown>).slice(0, 32)) {
      const normalizedKey = String(key).toLowerCase()
      const rendered = boundedConnectorString(typeof inner === 'string' ? inner : String(inner), 2048) ?? ''
      headers[String(key)] = /authorization|cookie|set-cookie|api[-_ ]?key|token|secret/i.test(normalizedKey) ? '[redacted]' : rendered
    }
  }

  const cleaned: AgentSessionConnectorConfig = {
    id,
    source,
    project: project ?? undefined,
    device: device ?? undefined,
    provider: provider ?? undefined,
    url: url ?? undefined,
    timeoutMs,
    staleAfterMs,
    allow,
    headers,
  }

  return cleaned
}

function boundedConnectorString(value: unknown, maxLength = AGENT_SESSION_CONNECTOR_MAX_STRING_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function rawConnectorEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

function connectorRequestHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const headers: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    const name = key.trim()
    const rendered = typeof rawValue === 'string' ? rawValue : String(rawValue)
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(rendered)) continue
    if (/^(host|content-length|connection|transfer-encoding)$/i.test(name)) continue
    headers[name] = rendered.slice(0, 2048)
  }
  return headers
}

export function normalizeSessionConnectorConfigs(value: unknown): AgentSessionConnectorConfig[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeSessionConnectorConfig(item))
      .filter((item): item is AgentSessionConnectorConfig => Boolean(item))
  }

  const single = normalizeSessionConnectorConfig(value)
  return single ? [single] : []
}

function resolveSafeProjectPath(root: string, project: string | undefined): string | null {
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

function projectedString(value: unknown, maxLength = AGENT_SESSION_CONNECTOR_MAX_STRING_LENGTH): string | null {
  return boundedConnectorString(value, maxLength)
}

function projectedStringList(value: unknown, maxItems = AGENT_SESSION_CONNECTOR_MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, maxItems)
    .map(item => projectedString(item, 160))
    .filter((item): item is string => Boolean(item))
}

function projectAgentRecords(agents: unknown): Array<Record<string, unknown>> {
  if (!agents || typeof agents !== 'object') return []
  const entries: Array<[unknown, unknown]> = Array.isArray(agents)
    ? agents.slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS).map(item => [asRecord(item).id, item])
    : Object.entries(agents as Record<string, unknown>).slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS)
  return entries.flatMap(([key, rawValue]) => {
    const value = asRecord(rawValue)
    if (!Object.keys(value).length) return []
    const id = projectedString(typeof key === 'string' ? key : value.id, 128)
    if (!id) return []
    const result: Record<string, unknown> = { id }
    for (const field of ['state', 'provider', 'task', 'model', 'since', 'cooldownUntil', 'assignee', 'role']) {
      const fieldValue = projectedString(value[field])
      if (fieldValue) result[field] = fieldValue
    }
    if (typeof value.leader === 'boolean') result.leader = value.leader
    if (Array.isArray(value.strengths)) result.strengths = projectedStringList(value.strengths)
    return [result]
  })
}

function projectTaskRecords(tasks: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(tasks)) return []
  return tasks.slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS).flatMap(rawValue => {
    const value = asRecord(rawValue)
    if (!Object.keys(value).length) return []
    const result: Record<string, unknown> = {}
    for (const field of ['id', 'title', 'kind', 'status', 'owner', 'assignee', 'leader']) {
      const fieldValue = projectedString(value[field], field === 'title' ? 512 : 128)
      if (fieldValue) result[field] = fieldValue
    }
    if (Array.isArray(value.dependencies)) result.dependencies = projectedStringList(value.dependencies)
    if (Array.isArray(value.acceptanceCriteria)) result.acceptanceCriteria = projectedStringList(value.acceptanceCriteria)
    return [result]
  })
}

function projectSessionRecords(
  sessions: unknown,
  source: AgentSessionConnectorSource,
  project: string | null,
  device: string | null,
  provider: string | null,
): AgentSessionConnectorSessionRecord[] {
  if (!Array.isArray(sessions)) return []
  return sessions.slice(0, AGENT_SESSION_CONNECTOR_MAX_RECORDS).flatMap(rawValue => {
    const value = asRecord(rawValue)
    const id = projectedString(value.id ?? value.sessionId, 128)
    if (!id) return []
    const result: AgentSessionConnectorSessionRecord = { id, source, project, device, provider }
    for (const field of ['name', 'status', 'state', 'agent', 'task'] as const) {
      const fieldValue = projectedString(value[field], field === 'name' ? 512 : 256)
      if (fieldValue) result[field] = fieldValue
    }
    for (const field of ['createdAt', 'updatedAt', 'startedAt', 'endedAt'] as const) {
      const fieldValue = normalizedHeartbeat(value[field])
      if (fieldValue) result[field] = fieldValue
    }
    return [result]
  })
}

function projectEventRecords(events: unknown, source: AgentSessionConnectorSource): Array<Record<string, unknown>> {
  if (!Array.isArray(events)) return []
  return events.slice(-AGENT_SESSION_CONNECTOR_MAX_RECORDS).flatMap(rawValue => {
    const value = asRecord(rawValue)
    const ts = normalizedHeartbeat(value.ts)
    const type = projectedString(value.type, 128)
    if (!ts || !type) return []
    const result: Record<string, unknown> = { ts, type, source }
    for (const field of ['project', 'device', 'from', 'to', 'text', 'error']) {
      const fieldValue = projectedString(value[field], field === 'text' ? 512 : 256)
      if (fieldValue) result[field] = fieldValue
    }
    return [result]
  })
}

function normalizedHeartbeat(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function connectorStatus(heartbeat: string | null, staleAfterMs: number, active = true): AgentSessionConnectorRecord['status'] {
  if (!heartbeat || !active) return 'offline'
  const age = Date.now() - Date.parse(heartbeat)
  if (!Number.isFinite(age) || age < -60_000) return 'offline'
  return age > staleAfterMs ? 'stale' : 'online'
}

function offlineConnector(config: AgentSessionConnectorConfig, project: string | null, error: string): AgentSessionConnectorRecord {
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
    sessions: [],
    events: [{ ts: eventTime, type: 'connector.error', source: config.source, error }],
  }
}

function projectLocalConnector(root: string, stateDirOverride?: string): AgentSessionConnectorRecord {
  const stateDir = getStateDirectory(root, stateDirOverride)
  const snapshot = readAgentTeamSnapshot(root, stateDir).snapshot
  const statusFile = path.join(stateDir, 'status.json')
  let heartbeat: string | null = null
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
    sessions: [],
    events: projectEventRecords(messages, 'local'),
  }
}

async function readConnectorPayload(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Connector returned HTTP status ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > AGENT_SESSION_CONNECTOR_MAX_BYTES) {
    throw new Error('Connector response exceeded the size limit')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Connector response body is unavailable')
  const chunks: Uint8Array[] = []
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
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('Connector response was not valid JSON')
  }
  const record = asRecord(payload)
  if (!Object.keys(record).length) throw new Error('Connector snapshot must be an object')
  const nested = asRecord(record.snapshot)
  return Object.keys(nested).length ? nested : record
}

function validateConnectorPayload(payload: Record<string, unknown>): string {
  const heartbeat = normalizedHeartbeat(payload.heartbeat)
  if (!heartbeat) throw new Error('Connector heartbeat is missing or invalid')
  for (const field of ['agents', 'tasks', 'sessions', 'events']) {
    if (payload[field] !== undefined && !Array.isArray(payload[field])) {
      throw new Error(`Connector ${field} must be an array`)
    }
  }
  if (payload.status !== undefined && !['online', 'stale', 'offline'].includes(String(payload.status))) {
    throw new Error('Connector status is invalid')
  }
  if (payload.online !== undefined && typeof payload.online !== 'boolean') {
    throw new Error('Connector online status is invalid')
  }
  return heartbeat
}

async function readRemoteConnector(
  config: AgentSessionConnectorConfig,
  headers: Record<string, string>,
  project: string | null,
): Promise<AgentSessionConnectorRecord> {
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
    const sessions = projectSessionRecords(
      payload.sessions ?? [],
      config.source,
      project,
      config.device ?? null,
      config.provider ?? null,
    )
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
      sessions,
      events,
    }
  } catch (error) {
    const message = controller.signal.aborted
      ? 'Connector request timed out'
      : error instanceof Error && /^Connector (?:returned HTTP status \d+|response exceeded the size limit|response body is unavailable|response was not valid JSON|snapshot must be an object|heartbeat is missing or invalid|agents must be an array|tasks must be an array|sessions must be an array|events must be an array|status is invalid|online status is invalid)/.test(error.message)
        ? error.message
        : 'Connector request failed'
    return offlineConnector(config, project, message)
  } finally {
    clearTimeout(timer)
  }
}

export async function readConnectorSnapshot(connectorConfig: unknown, workspaceRoot: string = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE): Promise<AgentSessionConnectorSummary> {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const rawConfigs = rawConnectorEntries(connectorConfig)
  if (rawConfigs.length > AGENT_SESSION_CONNECTOR_MAX_COUNT) {
    throw new Error(`Connector configuration exceeds the ${AGENT_SESSION_CONNECTOR_MAX_COUNT} connector limit`)
  }
  const configs = rawConfigs.map(raw => ({
    config: normalizeSessionConnectorConfig(raw),
    headers: connectorRequestHeaders(asRecord(raw).headers),
  })).filter((entry): entry is { config: AgentSessionConnectorConfig; headers: Record<string, string> } => Boolean(entry.config))
  const seen = new Set<string>()
  for (const { config } of configs) {
    const normalizedId = config.id.toLowerCase()
    if (normalizedId === 'ghostforge-local') throw new Error('Connector ID "ghostforge-local" is reserved')
    if (seen.has(normalizedId)) throw new Error('Duplicate connector IDs are not allowed')
    seen.add(normalizedId)
  }
  const mode = configs.some(({ config }) => config.allow) ? 'allowlisted' : 'local-only'
  const local = projectLocalConnector(root, stateDirOverride)
  const remotes = await Promise.all(configs
    .filter(({ config }) => config.allow && (config.source === 'cloud' || config.source === 'device'))
    .map(({ config, headers }) => readRemoteConnector(
      config,
      headers,
      resolveSafeProjectPath(root, config.project),
    )))

  return { version: AGENT_SESSION_CONNECTOR_VERSION, mode, connectors: [local, ...remotes] }
}

export async function readRequestJsonWithLimit(request: { body?: ReadableStream<Uint8Array> | null }, limit = DEFAULT_BODY_LIMIT): Promise<Record<string, unknown>> {
  if (!request || !request.body) return {}
  const reader = request.body.getReader ? request.body.getReader() : null
  if (!reader) return {}

  const chunks: Uint8Array[] = []
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
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('Request body must be valid JSON')
  }
}

export function runAgentTeamCommand(action: string, params: AgentTeamRequestPayload = {}, options: { workspaceRoot?: string; stateDirOverride?: string; env?: NodeJS.ProcessEnv; runner?: typeof spawnSync } = {}): AgentTeamCommandResult {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot || repoRootFromLib())
  const env = { ...process.env, ...(options.env || {}) }
  const stateDir = getStateDirectory(workspaceRoot, env.GF_AGENT_STATE || options.stateDirOverride)
  env.GF_AGENT_STATE = stateDir

  try {
    const args = buildAgentTeamCliArgs(action, params)
    const result = (options.runner || spawnSync)(process.execPath, [path.resolve(workspaceRoot, 'scripts', 'agents', 'team.mjs'), ...args], {
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
      output: `Agent-team command failed: ${error instanceof Error ? error.message : String(error)}`,
      code: null,
    }
  }
}
