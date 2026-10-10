// Claude Code / Copilot CLI session model for Agent World. This folder
// (agent-world/shared) is byte-identical in the external Agent World app and in
// GhostForge's web-ui; change both together (see SHARED.md).

export type Provider = 'claude-code' | 'copilot-cli'
export type Status = 'working' | 'active' | 'idle'
export type Health = 'ok' | 'stalled' | 'rate-limited' | 'erroring'

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }

export type Session = {
  /** Unique row id: the session id, plus ":<n>" for an older duplicate transcript. */
  id: string
  /** The real Claude Code / Copilot session id. */
  sessionId?: string
  provider: Provider
  name?: string
  projectSlug?: string
  cwd?: string
  repository?: string
  gitBranch?: string
  model?: string
  version?: string
  entrypoint?: string
  createdAt?: string
  updatedAt?: string
  prompts: number
  messages: number
  tokens: Tokens
  costUSD?: number
  aiu?: number
  linesAdded?: number
  linesRemoved?: number
  toolCalls: number
  topTool?: { name: string; count: number }
  lastTool?: { name: string; ts?: string }
  subagents: number
  errors: number
  health: Health
  context?: Context
  open?: boolean
  working?: boolean
  timeline: number[]
  status: Status
}

export type SessionEvent = {
  ts?: string
  type: 'tool' | 'subagent' | 'prompt' | 'error' | 'request' | 'compaction'
  name: string
}

/** How full the session's context window is, for the compaction animation. */
export type Context = { used: number; limit: number; pct: number | null; compactions: number }

export type SessionDetail = Session & {
  models: Record<string, number>
  modelUsage: Record<string, { input: number; output: number; thinking: number; cacheRead: number; cacheWrite: number; costUSD: number }>
  tools: { name: string; count: number }[]
  toolErrors: number
  apiErrors: Record<string, number>
  lastError?: { ts?: string; kind: string; status?: string; type?: string }
  apiMs?: number
  toolMs?: number
  reasoningTokens?: number
  contentFiltered?: number
  subagentList: { id: string; type: string; depth: number; background: boolean; updatedAt?: string }[]
  /** Newest first, the last 25. */
  events: SessionEvent[]
  /** Oldest first, up to 200, for the replay scrubber (absent from older servers). */
  replay?: SessionEvent[]
}

export type AgentGroup = {
  id: string
  provider: Provider
  model?: string
  sessions: number
  working: number
  tokens: number
  costUSD: number
  toolCalls: number
  projects: string[]
}

export type World = {
  version: number
  heartbeat: string
  device: string
  counts: {
    sessions: number; active: number; working: number; agents: number
    claude: number; copilot: number; claudeShown: number; copilotShown: number; unhealthy: number
  }
  totals: {
    today: { costUSD: number; aiu: number; tokens: number; toolCalls: number; errors: number }
    topTools: { name: string; count: number }[]
    timeline: number[]
    timelineBucketMinutes: number
  }
  agents: AgentGroup[]
  sessions: Session[]
  events: { ts: string; type: string; error?: string }[]
}
