import { activity, waitsOnYou } from './format'
import type { Session } from './types'

/** The four roster columns. */
export type Column = 'needs' | 'working' | 'done' | 'ended'

export const COLUMNS: { id: Column; label: string; empty: string }[] = [
  { id: 'needs', label: 'Needs you', empty: 'Nothing is waiting on you.' },
  { id: 'working', label: 'Working', empty: 'No session is working right now.' },
  { id: 'done', label: 'Done', empty: 'No finished turns.' },
  { id: 'ended', label: 'Ended', empty: 'No ended sessions in view.' },
]

/** Why a session needs the user, or null. Ended (idle) sessions never do. */
export type Attention = 'waiting' | 'stalled' | 'rate-limited' | 'erroring'

export function attentionOf(s: Session): Attention | null {
  if (s.status === 'idle') return null
  if (s.health !== 'ok') return s.health
  if (s.status === 'active' && waitsOnYou(s)) return 'waiting'
  return null
}

export function columnOf(s: Session): Column {
  if (attentionOf(s)) return 'needs'
  if (s.status === 'working') return 'working'
  if (s.status === 'active') return 'done'
  return 'ended'
}

export const ATTENTION_LABEL: Record<Attention, string> = {
  waiting: 'waiting for you',
  stalled: 'stalled',
  'rate-limited': 'rate limited',
  erroring: 'hitting API errors',
}

/** Max words in a world bubble. Bubbles never carry message text. */
export const BUBBLE_WORDS = 6

export function clipWords(text: string, max = BUBBLE_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length > max ? `${words.slice(0, max).join(' ')}…` : words.join(' ')
}

/** "mcp__github__create_pull_request" -> "create_pull_request"; long names are cut. */
export function shortTool(name: string): string {
  const bare = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')
  return bare.length > 22 ? `${bare.slice(0, 21)}…` : bare
}

/**
 * Short phrases a character rotates through in its bubble: the current tool
 * or state, never prompts or output. Quiet (empty) for done/ended sessions.
 */
export function bubbleLines(s: Session): string[] {
  const attention = attentionOf(s)
  if (attention === 'waiting') return ['waiting for you']
  if (attention === 'stalled') return [clipWords(`stalled on ${shortTool(s.lastTool?.name ?? 'a tool')}`)]
  if (attention) return [ATTENTION_LABEL[attention]]
  if (s.status !== 'working') return []
  const lines: string[] = []
  if (s.lastTool?.name) lines.push(`running ${shortTool(s.lastTool.name)}`)
  lines.push(clipWords(activity(s)))
  if (s.subagents > 0) lines.push(`${s.subagents} ${s.subagents === 1 ? 'subagent' : 'subagents'} so far`)
  if (s.context?.pct !== null && s.context?.pct !== undefined) lines.push(`context ${s.context.pct}% full`)
  return [...new Set(lines.map(line => clipWords(line)))]
}
