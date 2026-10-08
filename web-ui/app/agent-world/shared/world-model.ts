import { activity, modelShort, project, providerLabel, waitsOnYou } from './format'
import { attentionOf, bubbleLines, columnOf, type Attention, type Column } from './status'
import type { Session, World } from './types'

/** A world character: the record shape the town/office adapters read. */
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
  column: Column
  attention: Attention | null
  /** Short (≤ 6 words) phrases the world bubbles rotate through. */
  bubbles: string[]
  context?: Session['context']
  updatedAt?: string
  /** Idle long enough to wander off to the break area. */
  onBreak: boolean
}

export type WorldScope = 'live' | 'today'

/** Done/ended characters drift to the break area after this long without activity. */
export const BREAK_AFTER_MS = 3 * 60_000

/**
 * Turn sessions into world characters. "live" = working or recently active;
 * "today" adds sessions that were idle less than 12 hours.
 */
export function worldAgents(world: World | undefined, scope: WorldScope, now = Date.now()): WorldAgent[] {
  if (!world) return []
  const horizon = now - 12 * 60 * 60_000
  // Oldest first, then by id: the town and office adapters give characters
  // their slot, sprite and desk by position, and the snapshot is sorted by
  // recent activity, so its order would reshuffle them on every refresh.
  const picked = world.sessions
    .filter(s => s.status !== 'idle' || (scope === 'today' && Date.parse(s.updatedAt ?? '') >= horizon))
    .sort((a, b) => ((Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

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
    const column = columnOf(s)
    const quietFor = now - (Date.parse(s.updatedAt ?? '') || now)
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
      column,
      attention: attentionOf(s),
      bubbles: bubbleLines(s),
      context: s.context,
      updatedAt: s.updatedAt,
      onBreak: (column === 'done' || column === 'ended') && quietFor >= BREAK_AFTER_MS,
    }
  })
}

/** "You" stand in the middle of every world: the person these agents work for. */
export function youRecord(world: World | undefined) {
  const c = world?.counts
  return {
    id: 'you',
    name: 'You',
    role: 'boss',
    state: c?.working ? 'working' : 'idle',
    status: c ? `${c.working} working · ${c.active - c.working} recently active` : 'connecting',
    task: '',
    taskTitle: world ? `$${world.totals.today.costUSD.toFixed(2)} spent today · ${c?.active ?? 0} live sessions` : '',
    model: world?.device,
  }
}
