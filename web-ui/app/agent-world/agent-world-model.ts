export type AgentWorldRecord = Record<string, unknown>

export type AgentWorldData = {
  connectors: AgentWorldRecord[]
  sessions: AgentWorldRecord[]
  agents: AgentWorldRecord[]
  tasks: AgentWorldRecord[]
  events: AgentWorldRecord[]
}

export type AgentWorldLoadResult =
  | { status: 'loaded'; snapshot: AgentWorldRecord; connectorSummary?: AgentWorldRecord }
  | { status: 'denied'; message: string }
  | { status: 'redirecting' }

function asRecord(value: unknown): AgentWorldRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AgentWorldRecord
    : null
}

function recordList(value: unknown): AgentWorldRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((record): record is AgentWorldRecord => record !== null)
    : []
}

function isAdminUser(value: unknown): boolean {
  const user = asRecord(value)
  if (!user) return false
  return user.role === 'admin'
    || (Array.isArray(user.permissions) && user.permissions.includes('admin_tools'))
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = asRecord(await response.json())
    if (typeof body?.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Use the HTTP status when the response has no readable error body.
  }
  return `Request failed (${response.status})`
}

export async function loadAgentWorld(
  fetcher: typeof fetch,
  onLoginRedirect: () => void,
  variant: 'product' | 'maintainer' = 'maintainer',
): Promise<AgentWorldLoadResult> {
  const response = await fetcher(variant === 'product' ? '/api/agents?view=public' : '/api/agents')
  if (response.status === 401 || response.status === 403) {
    const authResponse = await fetcher('/api/auth/me')
    if (authResponse.status === 401) {
      onLoginRedirect()
      return { status: 'redirecting' }
    }
    if (!authResponse.ok) {
      throw new Error(`Unable to verify access (${authResponse.status})`)
    }

    const authData = asRecord(await authResponse.json())
    if (!authData?.user) {
      onLoginRedirect()
      return { status: 'redirecting' }
    }
    if (!isAdminUser(authData.user)) {
      return {
        status: 'denied',
        message: 'Your account needs the admin_tools permission to access Agent World.',
      }
    }
  }

  if (!response.ok) throw new Error(await responseError(response))

  const payload = asRecord(await response.json())
  const snapshot = asRecord(payload?.snapshot)
  if (!snapshot) throw new Error('The agents API returned an invalid snapshot.')
  const connectorSummary = asRecord(payload?.connectorSnapshot) ?? undefined
  return { status: 'loaded', snapshot, connectorSummary }
}

function withConnectorSource(record: AgentWorldRecord, connector: AgentWorldRecord): AgentWorldRecord {
  return {
    ...record,
    source: connector.id,
    connectorSource: connector.source,
  }
}

function connectorIsStale(connector: AgentWorldRecord): boolean {
  return connector.stale === true || connector.status === 'stale'
}

export function collectAgentWorldData(
  snapshot: AgentWorldRecord,
  connectorSummary?: AgentWorldRecord,
): AgentWorldData {
  const connectors = recordList(connectorSummary?.connectors)
  const sessions = [
    ...recordList(snapshot.sessions).map(session => ({
      ...session,
      source: typeof session.source === 'string' && session.source.trim()
        ? session.source
        : 'ghostforge-runtime',
    })),
    ...connectors.flatMap(connector => recordList(connector.sessions).map(session => ({
      ...withConnectorSource(session, connector),
      connectorId: connector.id,
      stale: session.stale === true || connectorIsStale(connector),
    }))),
  ]
  const runtimeAgents = asRecord(snapshot.agents)
  const runtimeTasks = recordList(snapshot.tasks)
  const runtimeAgentIds = new Set(Object.keys(runtimeAgents ?? {}))
  const runtimeTaskIds = new Set(runtimeTasks.flatMap(task =>
    typeof task.id === 'string' ? [task.id] : [],
  ))
  const agents = [
    ...Object.entries(runtimeAgents ?? {}).map(([id, agent]) => ({
      ...asRecord(agent),
      id,
      source: 'ghostforge-runtime',
    })),
    ...connectors.flatMap(connector => recordList(connector.agents)
      .filter(agent => connector.id !== 'ghostforge-local'
        || typeof agent.id !== 'string'
        || !runtimeAgentIds.has(agent.id))
      .map(agent => connector.id === 'ghostforge-local'
        ? { ...agent, source: connector.id }
        : withConnectorSource(agent, connector))),
  ]
  const tasks = [
    ...runtimeTasks.map(task => ({ ...task, source: 'ghostforge-runtime' })),
    ...connectors.flatMap(connector => recordList(connector.tasks)
      .filter(task => connector.id !== 'ghostforge-local'
        || typeof task.id !== 'string'
        || !runtimeTaskIds.has(task.id))
      .map(task => connector.id === 'ghostforge-local'
        ? { ...task, source: connector.id }
        : withConnectorSource(task, connector))),
  ]
  const events = [
    ...recordList(snapshot.messages).map(message => ({
      ...message,
      type: 'team.message',
      source: 'ghostforge-runtime',
    })),
    ...connectors.flatMap(connector => recordList(connector.events)
      .map(event => withConnectorSource(event, connector))),
  ]

  return { connectors, sessions, agents, tasks, events }
}

export function recordText(record: AgentWorldRecord, fields: string[]): string[] {
  return fields.flatMap(field => {
    const value = record[field]
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? [`${field}: ${String(value)}`]
      : []
  })
}
