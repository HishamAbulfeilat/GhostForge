type AgentRecord = Record<string, unknown>

function asRecord(value: unknown): AgentRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AgentRecord
    : {}
}

function publicText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sanitized = value
    .replace(/(token|secret|api[_-]?key|password|authorization)\s*[:=]\s*[^\s\n]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z]:\\[^\s\n]+/g, '[local path redacted]')
    .replace(/(?:^|\s)\/(?:Users|home|var|tmp)\/[^\s\n]+/g, ' [local path redacted]')
    .trim()
  return sanitized || null
}

function publicStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(publicText).filter((entry): entry is string => entry !== null)
    : []
}

function publicAgent(value: unknown, fallbackId?: string): AgentRecord {
  const source = asRecord(value)
  return Object.fromEntries(Object.entries({
    id: publicText(source.id) ?? publicText(fallbackId),
    provider: publicText(source.provider),
    state: publicText(source.state) ?? 'unknown',
    task: publicText(source.task),
    since: publicText(source.since),
    leader: source.leader === true,
    assignee: publicText(source.assignee),
    role: publicText(source.role),
  }).filter(([, entry]) => entry !== null && entry !== undefined))
}

function publicTask(value: unknown): AgentRecord {
  const source = asRecord(value)
  return Object.fromEntries(Object.entries({
    id: publicText(source.id),
    title: publicText(source.title) ?? 'Untitled task',
    kind: publicText(source.kind) ?? 'task',
    status: publicText(source.status) ?? 'unknown',
    owner: publicText(source.owner),
    assignee: publicText(source.assignee),
    leader: publicText(source.leader),
    dependencies: publicStringList(source.dependencies),
  }).filter(([, entry]) => entry !== null && entry !== undefined))
}

export function sanitizePublicAgentResponse(
  teamEnvelope: AgentRecord,
  connectorSummary: AgentRecord,
): AgentRecord {
  const snapshot = asRecord(teamEnvelope.snapshot)
  const agents = asRecord(snapshot.agents)
  const workflow = asRecord(snapshot.workflow)
  const connectors = Array.isArray(connectorSummary.connectors)
    ? connectorSummary.connectors.map(value => {
        const connector = asRecord(value)
        return {
          id: publicText(connector.id) ?? 'unknown-source',
          version: connector.version,
          source: publicText(connector.source) ?? 'local',
          project: publicText(connector.project),
          device: null,
          provider: null,
          status: publicText(connector.status) ?? 'offline',
          heartbeat: publicText(connector.heartbeat),
          staleAfterMs: connector.staleAfterMs,
          stale: connector.stale === true,
          online: connector.online === true,
          error: connector.error ? 'Connector unavailable.' : null,
          agents: Array.isArray(connector.agents) ? connector.agents.map(agent => publicAgent(agent)) : [],
          tasks: Array.isArray(connector.tasks) ? connector.tasks.map(publicTask) : [],
          sessions: [],
          events: [],
        }
      })
    : []

  return {
    snapshot: {
      health: snapshot.health,
      running: snapshot.running === true,
      agents: Object.fromEntries(Object.entries(agents).map(([id, agent]) => [id, publicAgent(agent, id)])),
      tasks: Array.isArray(snapshot.tasks) ? snapshot.tasks.map(publicTask) : [],
      messages: [],
      phase: snapshot.phase,
      workflow: {
        leader: publicText(workflow.leader),
        mode: publicText(workflow.mode) ?? 'parallel',
        specialists: [],
      },
    },
    connectorSnapshot: {
      version: connectorSummary.version,
      mode: connectorSummary.mode,
      connectors,
    },
  }
}
