import { activity, modelShort, project, providerLabel, waitsOnYou } from './format'
import type { Session, World } from './types'

/** A world character: the record shape the GhostForge-derived adapters read. */
export type WorldAgent = {
  id: string
  name: string
  role: string
  provider: Session['provider']
  model?: string
  /** Adapter status: "working" makes characters work/think, anything else rests. */
  state: string
  status: string
  /**
   * Shown as the thought/speech bubble, so only set while there is something
   * to say (working, or in trouble). Resting characters stay quiet.
   */
  task: string
  /** Always set: what the session is doing, for rosters and furnace cards. */
  taskTitle: string
  health: Session['health']
  /** Shown in Forge World's details; marks the character as a CLI session. */
  source: string
  cli: true
}

export type WorldScope = 'live' | 'today'

/**
 * Turn sessions into world characters. "live" = working or recently active;
 * "today" adds sessions that were idle less than 12 hours.
 */
export function worldAgents(world: World | undefined, scope: WorldScope): WorldAgent[] {
  if (!world) return []
  const horizon = Date.now() - 12 * 60 * 60_000
  const picked = world.sessions.filter(s =>
    s.status !== 'idle' || (scope === 'today' && Date.parse(s.updatedAt ?? '') >= horizon))

  // Two sessions in one folder get "#2", "#3" so their name tags differ.
  const seen = new Map<string, number>()
  return picked.map(s => {
    const base = project(s).name
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const state = s.status === 'working' ? 'working'
      : s.status === 'active' ? (waitsOnYou(s) ? 'waiting' : 'done')
      : 'idle'
    const what = activity(s)
    return {
      id: s.id,
      name: n > 1 ? `${base} #${n}` : base,
      role: `${providerLabel(s.provider)} · ${modelShort(s.model)}`,
      provider: s.provider,
      model: s.model,
      state,
      status: s.health !== 'ok' ? s.health : state,
      task: state === 'working' || s.health !== 'ok' ? what : '',
      taskTitle: what,
      health: s.health,
      source: s.provider === 'claude-code' ? 'Claude Code CLI' : 'Copilot CLI',
      cli: true,
    }
  })
}
