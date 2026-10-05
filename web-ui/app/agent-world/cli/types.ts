// Claude Code / Copilot CLI session model for Agent World. The external Agent
// World app (outside this repo) carries the same types, helpers and mapping.

export type Provider = 'claude-code' | 'copilot-cli'
export type Status = 'working' | 'active' | 'idle'
export type Health = 'ok' | 'stalled' | 'rate-limited' | 'erroring'

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }

export type Session = {
  id: string
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
  open?: boolean
  working?: boolean
  timeline: number[]
  status: Status
}

export type SessionEvent = { ts?: string; type: 'tool' | 'subagent' | 'prompt' | 'error' | 'request'; name: string }

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
  events: SessionEvent[]
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
