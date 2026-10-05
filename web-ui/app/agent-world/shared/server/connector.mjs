// The CLI-session snapshot in GhostForge's /api/agents connector format, so the
// external Agent World can be registered as a GhostForge "device" connector
// (GF_AGENT_SESSION_CONNECTORS) and GhostForge can serve the same shape.
//
// GhostForge rejects a connector response over 65,536 bytes (and it then looks
// like "no activity"), so lists are capped and trimmed until the JSON fits.
export const CONNECTOR_MAX_BYTES = 65_536
const TARGET_BYTES = 60_000 // headroom below the hard limit
const MAX_RECORDS = 100 // GhostForge keeps at most 100 per list anyway
const MAX_STRING = 200

const clip = (value, max = MAX_STRING) => (typeof value === 'string' && value ? value.slice(0, max) : undefined)
const RANK = { needs: 0, working: 1, done: 2, ended: 3 }

function state(s) {
  if (s.status === 'idle') return 'idle'
  if (s.health && s.health !== 'ok') return s.health
  if (s.status === 'working') return 'working'
  const waits = s.provider === 'claude-code' ? s.entrypoint === 'cli' : !!s.open
  return waits ? 'waiting' : 'done'
}

function column(st) {
  if (st === 'working') return 'working'
  if (st === 'done') return 'done'
  if (st === 'idle') return 'ended'
  return 'needs'
}

function name(s) {
  const p = s.cwd || s.projectSlug || ''
  return p.split(/[\\/]+/).filter(Boolean).at(-1) || s.id.slice(0, 8)
}

function task(s, st) {
  if (st === 'waiting') return 'waiting for you'
  if (st === 'stalled') return `stalled on ${s.lastTool?.name ?? 'a tool call'}`
  if (st === 'working') return s.lastTool?.name ? `using ${s.lastTool.name}` : 'thinking'
  return st
}

/**
 * @param {{ heartbeat: string, sessions?: any[], events?: any[], device?: string }} world
 * @param {{ maxBytes?: number }} [options]
 */
export function connectorSnapshot(world, { maxBytes = TARGET_BYTES } = {}) {
  const sessions = [...(world?.sessions ?? [])]
    .map(s => ({ s, st: state(s) }))
    .sort((a, b) => RANK[column(a.st)] - RANK[column(b.st)] || (Date.parse(b.s.updatedAt ?? '') || 0) - (Date.parse(a.s.updatedAt ?? '') || 0))
    .slice(0, MAX_RECORDS)
  const agents = sessions.filter(({ st }) => st !== 'idle').map(({ s, st }) => ({
    id: clip(s.id, 128),
    state: st,
    provider: s.provider,
    task: clip(task(s, st)),
    model: clip(s.model),
    role: s.provider === 'claude-code' ? 'Claude Code CLI' : 'Copilot CLI',
  }))
  const records = sessions.map(({ s, st }) => ({
    id: clip(s.id, 128),
    name: clip(name(s)),
    status: column(st),
    state: st,
    agent: s.provider,
    task: clip(task(s, st)),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }))
  const events = (world?.events ?? []).slice(-MAX_RECORDS).map(e => ({ ts: e.ts, type: clip(e.type, 128), text: clip(e.error) }))
  const payload = {
    version: 1,
    heartbeat: world?.heartbeat ?? new Date().toISOString(),
    status: 'online',
    online: true,
    device: clip(world?.device, 128),
    agents,
    tasks: [],
    sessions: records,
    events,
  }
  // Trim the least important records until the JSON fits.
  const size = () => Buffer.byteLength(JSON.stringify(payload), 'utf8')
  while (size() > maxBytes && (payload.sessions.length || payload.events.length)) {
    if (payload.events.length) payload.events = payload.events.slice(Math.ceil(payload.events.length / 2))
    else payload.sessions = payload.sessions.slice(0, Math.floor(payload.sessions.length / 2))
    const kept = new Set(payload.sessions.map(r => r.id))
    payload.agents = payload.agents.filter(a => kept.has(a.id))
  }
  return payload
}
