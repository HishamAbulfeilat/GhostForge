// Session timeline replay: turns a session's recorded events (tool, subagent,
// prompt, error, request and compaction names with times; never their content)
// into frames the drawer's scrubber steps through, and puts the matching
// character in the scene into that moment's state.
import { BREAK_AFTER_MS, type WorldAgent } from './world-model'
import { clipWords, shortTool } from './status'
import type { SessionEvent } from './types'

/** One step of the replay: an event, or a quiet gap long enough for a break. */
export type ReplayFrame = {
  kind: 'event' | 'idle'
  /** Event time in ms (for an idle frame: when the quiet stretch began). */
  at: number
  event?: SessionEvent
  /** Length of the quiet stretch, for idle frames. */
  idleMs?: number
  /** ≤ 6 words for the character's bubble. */
  line: string
  /** Running totals up to and including this frame. */
  counts: { tools: number; subagents: number; prompts: number; errors: number; compactions: number }
}

/** What the scene needs to show one session's replayed moment. */
export type Replay = { id: string; frame: ReplayFrame }

/** The bubble for one event: what happened, never what was said. */
export function replayLine(event: SessionEvent): string {
  switch (event.type) {
    case 'tool': return clipWords(`running ${shortTool(event.name)}`)
    case 'subagent': return event.name === 'Agent' || event.name === 'Task' ? 'started a subagent' : clipWords(`subagent ${shortTool(event.name)}`)
    case 'prompt': return 'got a new message'
    case 'error': return clipWords(event.name || 'hit an error')
    case 'compaction': return 'compacted its context'
    case 'request': return 'asked the model'
  }
}

/**
 * Frames in time order. Events without a usable time are dropped; a quiet
 * stretch of BREAK_AFTER_MS or more between two events becomes an idle frame,
 * so the character walks off for a break and comes back.
 */
export function replayFrames(events: SessionEvent[] | undefined): ReplayFrame[] {
  const timed = (events ?? [])
    .map((event, i) => ({ event, i, at: Date.parse(event.ts ?? '') }))
    .filter(e => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at || a.i - b.i)
  const counts = { tools: 0, subagents: 0, prompts: 0, errors: 0, compactions: 0 }
  const frames: ReplayFrame[] = []
  let last = 0
  for (const { event, at } of timed) {
    if (last && at - last >= BREAK_AFTER_MS) {
      frames.push({ kind: 'idle', at: last, idleMs: at - last, line: '', counts: { ...counts } })
    }
    if (event.type === 'tool') counts.tools++
    else if (event.type === 'subagent') counts.subagents++
    else if (event.type === 'prompt') counts.prompts++
    else if (event.type === 'error') counts.errors++
    else if (event.type === 'compaction') counts.compactions++
    frames.push({ kind: 'event', at, event, line: replayLine(event), counts: { ...counts } })
    last = at
  }
  return frames
}

/**
 * The scene's characters with one of them put into a replayed moment: working
 * with that event's bubble, or on a break during a quiet stretch. Only the
 * scene gets this; rosters, alerts and the chat box keep the live state.
 */
export function applyReplay<T extends { id: string }>(agents: T[], replay: Replay | undefined): T[] {
  if (!replay) return agents
  const { frame } = replay
  return agents.map(a => {
    if (a.id !== replay.id) return a
    const idle = frame.kind === 'idle'
    const replayed: Partial<WorldAgent> = {
      state: idle ? 'done' : 'working',
      status: idle ? 'done' : 'working',
      task: idle ? '' : frame.line,
      taskTitle: idle ? 'on a break' : frame.line,
      column: idle ? 'done' : 'working',
      attention: null,
      bubbles: idle ? [] : [frame.line],
      onBreak: idle,
    }
    return { ...a, ...replayed }
  })
}
