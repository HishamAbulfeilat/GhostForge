# Agent World visualization

Agent World is the reusable visualization layer for GhostForge agent operations:

- `/agents` embeds the visualization with the existing authenticated controls.
- `/agent-world` provides a focused standalone operations-center route.
- Both routes consume the same `GET /api/agents` response and require the existing
  `admin_tools` permission.

The visual forge, workflow topology, counts, board, table, filters, source
badges, stale state, and event log are all derived from the snapshot. The UI
does not create demo workers or inferred “live” counts.

## Embedding

`web-ui/app/agents/AgentWorldShell.tsx` owns authentication, safe polling,
commands, and notices. It builds a normalized model and renders
`AgentWorld.tsx`. For a read-only embed that already has data, use the lower
level component:

```tsx
import AgentWorld from '@/app/agents/AgentWorld'
import { buildAgentWorld } from '@/app/agents/agent-world-model'

const world = buildAgentWorld(snapshot)

<AgentWorld world={world} lastUpdatedAt={new Date()} />
```

The component contains spatial, board, and table views and does not call the
API itself.

## Frontend federation contract

The current agent-team fields remain valid. Future project connectors may add
optional `sources`, `sessions`, and `updatedAt` fields to the snapshot. The
normalizer intentionally ignores unknown fields.

```ts
type SnapshotExtension = {
  updatedAt?: string
  sources?: Array<{
    id: string
    label?: string
    kind?: 'local' | 'app' | 'cloud' | 'remote' | 'unknown'
    status?: 'online' | 'degraded' | 'offline' | 'unknown'
    project?: string
    workspace?: string
    device?: string
    provider?: string
    updatedAt?: string
  }>
  sessions?: Array<{
    id: string
    name?: string
    sourceId?: string
    sourceKind?: 'local' | 'app' | 'cloud' | 'remote' | 'unknown'
    state?: string
    taskId?: string
    role?: string
    leader?: boolean
    progress?: number
    project?: string
    workspace?: string
    device?: string
    provider?: string
    model?: string
    since?: string
    updatedAt?: string
  }>
}
```

Connector output must contain display-safe metadata only. Never include access
tokens, credential paths, environment values, raw provider configuration, or
secret-bearing URLs. Server adapters remain responsible for authorization,
redaction, and workspace confinement.

When explicit sessions are absent, configured/reported `agents` become local
agent-team sessions. If a connector timestamp is older than the frontend
freshness window, its source and sessions render as stale/degraded. Missing
timestamps remain unknown rather than being invented.

## Polling and failure behavior

The shell polls every eight seconds only while the document is visible,
prevents overlapping requests, and aborts its initial request during unmount.
Failures remain visible as alerts while the last successful snapshot stays on
screen. A manual refresh uses the same guarded loader.

This frontend contract is additive. Runtime federation and the server-side
agent-team snapshot implementation remain owned by `scripts/agents` and
`web-ui/lib/agent-team-api.*`.

## Inspiration and attribution

The in-product About surface links to:

- [TaskVille](https://taskville.co/#)
- [a16z AI Town](https://github.com/a16z-infra/ai-town)
- [Agent Office](https://github.com/harishkotra/agent-office)

Agent World uses an original GhostForge virtual-forge design and does not copy
their assets or interface implementations.
