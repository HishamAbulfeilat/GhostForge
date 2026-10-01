import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const DEFAULT_BODY_LIMIT = 1024 * 1024
export const AGENT_TEAM_COMMAND_TIMEOUT_MS = 15_000
export const AGENT_SESSION_CONNECTOR_VERSION = 1
export const AGENT_SESSION_CONNECTOR_MAX_BYTES = 65_536
export const AGENT_SESSION_CONNECTOR_TIMEOUT_MS = 5_000
export const VALID_ACTIONS = ['status', 'start', 'stop', 'say', 'add', 'dispatch'] as const

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
  events: Array<Record<string, unknown>>
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
  const id = sanitizeConnectorString(record.id) ?? sanitizeConnectorString(record.name)
  if (!id) return null

  const source = record.source === 'cloud' || record.source === 'device' ? record.source : 'local'
  const provider = sanitizeConnectorString(record.provider)
  const project = sanitizeConnectorString(record.project)
  const device = sanitizeConnectorString(record.device)
  const rawUrl = sanitizeConnectorString(record.url)
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
    for (const [key, inner] of Object.entries(record.headers as Record<string, unknown>)) {
      const normalizedKey = String(key).toLowerCase()
      const rendered = typeof inner === 'string' ? inner : String(inner)
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

export function readConnectorSnapshot(connectorConfig: unknown, workspaceRoot: string = repoRootFromLib()): AgentSessionConnectorSummary {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const configs = normalizeSessionConnectorConfigs(connectorConfig)
  const mode = configs.some(config => config.allow) ? 'allowlisted' : 'local-only'
  const connectors: AgentSessionConnectorRecord[] = [{
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
