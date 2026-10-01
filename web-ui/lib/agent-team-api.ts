import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const DEFAULT_BODY_LIMIT = 1024 * 1024
export const AGENT_TEAM_COMMAND_TIMEOUT_MS = 15_000
export const VALID_ACTIONS = ['status', 'start', 'stop', 'say', 'add'] as const

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
  [key: string]: unknown
}

interface AgentTeamCommandResult {
  ok: boolean
  action: string
  output: string
  code: number | null
}

export interface AgentTeamAgentSnapshot {
  provider: string | null
  state: string
  task: string | null
  model: string | null
  since: string | null
  cooldownUntil: string | null
  enabled: boolean
  role: string
  strengths: string[]
  branch: string | null
}

export interface AgentTeamTaskSnapshot {
  id: string | null
  title: string
  kind: string
  status: string
  owner: string | null
}

export interface AgentTeamSnapshot {
  health: number | null
  running: boolean
  agents: Record<string, AgentTeamAgentSnapshot>
  tasks: AgentTeamTaskSnapshot[]
  messages: Array<Record<string, unknown>>
  phase: number
}

export interface AgentTeamSnapshotEnvelope {
  snapshot: AgentTeamSnapshot
}

export function repoRootFromLib(): string {
  return path.resolve(__dirname, '..', '..')
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

function normalizedStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(entry => normalizedString(entry)).filter((entry): entry is string => entry !== null)
    : []
}

function sanitizePublicText(value: string | null): string | null {
  if (!value) return null
  const sanitized = value
    .replace(/(token|secret|api[_-]?key|password|authorization)\s*[:=]\s*[^\s\n]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z]:\\[^\s\n]+/g, '[local path redacted]')
    .replace(/(?:^|\s)\/(?:Users|home|var|tmp)\/[^\s\n]+/g, ' [local path redacted]')
    .trim()
  return sanitized || null
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

  if (action === 'add') {
    const title = String(source.title ?? source.task ?? source.name ?? '').trim()
    if (!title) {
      throw new Error('Agent team add requires a title')
    }
    const kind = String(source.kind ?? 'feature').trim() || 'feature'
    const area = normalizeAreaValue(source.area as string[] | string | undefined)
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
      if (normalized.from) args.push('--from', String(normalized.from))
      return args
    }
    default:
      return [String(normalized.action)]
  }
}

export function getStateDirectory(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE): string {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const stateDir = stateDirOverride && String(stateDirOverride).trim() ? stateDirOverride : path.join(root, '.agent-sync', 'state')
  return resolveWorkspaceRoot(root, stateDir)
}

export function readAgentTeamSnapshot(workspaceRoot = repoRootFromLib(), stateDirOverride = process.env.GF_AGENT_STATE): AgentTeamSnapshotEnvelope {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const stateDir = getStateDirectory(root, stateDirOverride)
  const status = asRecord(readJsonFile<unknown>(path.join(stateDir, 'status.json'), null))
  const board = asRecord(readJsonFile<unknown>(path.join(stateDir, 'board.json'), {}))
  const teamConfig = asRecord(readJsonFile<unknown>(path.join(root, '.agent-sync', 'team.json'), {}))
  const configuredAgents = asRecord(teamConfig.agents)
  const reportedAgents = asRecord(status.agents)
  const agentIds = new Set([...Object.keys(configuredAgents), ...Object.keys(reportedAgents)])
  const bossConfig = asRecord(teamConfig.boss)
  if (Object.keys(bossConfig).length > 0) agentIds.add('boss')

  const agents = Object.fromEntries([...agentIds].map(agentId => {
    const config = agentId === 'boss' ? bossConfig : asRecord(configuredAgents[agentId])
    const info = asRecord(reportedAgents[agentId])
    const enabled = agentId === 'boss' || config.enabled !== false
    return [agentId, {
      provider: normalizedString(config.provider) ?? normalizedString(info.provider),
      state: normalizedString(info.state) ?? (enabled ? 'unknown' : 'disabled'),
      task: normalizedString(info.task),
      model: normalizedString(info.model),
      since: normalizedString(info.since),
      cooldownUntil: normalizedString(info.cooldownUntil),
      enabled,
      role: normalizedString(config.role) ?? (agentId === 'boss' ? 'coordinator' : 'worker'),
      strengths: normalizedStrings(config.strengths),
      branch: normalizedString(config.branch),
    }]
  }))

  const tasks = Array.isArray(board.tasks) ? board.tasks.map(task => {
    const info = asRecord(task)
    const owner = normalizedString(info.owner) ?? normalizedString(info.agent)
    return {
      id: normalizedString(info.id),
      title: typeof info.title === 'string' ? info.title : '',
      kind: normalizedString(info.kind) ?? 'feature',
      status: normalizedString(info.status) ?? 'todo',
      owner,
    }
  }) : []

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
    },
  }
}

export function toPublicAgentTeamSnapshot(envelope: AgentTeamSnapshotEnvelope): AgentTeamSnapshotEnvelope {
  const source = envelope.snapshot
  const agents = Object.fromEntries(
    Object.entries(source.agents)
      .filter(([, agent]) => agent.enabled && agent.state !== 'disabled')
      .map(([id, agent]) => [id, {
        provider: agent.provider,
        state: agent.state,
        task: sanitizePublicText(agent.task),
        model: null,
        since: agent.since,
        cooldownUntil: null,
        enabled: true,
        role: 'agent',
        strengths: [],
        branch: null,
      }]),
  )
  const publicAgentIds = new Set(Object.keys(agents))
  const tasks = source.tasks.map(task => ({
    id: task.id,
    title: sanitizePublicText(task.title) ?? 'Untitled task',
    kind: task.kind,
    status: task.status,
    owner: task.owner && publicAgentIds.has(task.owner) ? task.owner : null,
  }))

  return {
    snapshot: {
      health: source.health,
      running: source.running,
      agents,
      tasks,
      messages: [],
      phase: source.phase,
    },
  }
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
