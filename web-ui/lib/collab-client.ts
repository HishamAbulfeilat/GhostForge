/**
 * Browser-side helpers for shared JARVIS sessions (/jarvis?session=<id>).
 *
 * Sessions live in the mark-l-bridge collab store (the TUI creates them there);
 * /api/jarvis/collab proxies to it. The page loads a session's transcript,
 * posts its own turns, and polls for turns other participants add.
 */

export interface CollabMessage {
  role: string
  content: string
  ts: number
}

/** Same rule as the API route and the TUI: 8–64 letters or digits. */
export const COLLAB_SESSION_ID_RE = /^[a-z0-9]{8,64}$/i

/** The session id from a page URL's query string, or null when absent/invalid. */
export function sessionIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('session')?.trim() ?? ''
  return COLLAB_SESSION_ID_RE.test(id) ? id : null
}

/** Only well-formed user/assistant turns are shown. */
export function sanitizeCollabMessages(raw: unknown): CollabMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is CollabMessage =>
      Boolean(m) && typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length > 0)
    .map(m => ({ role: m.role, content: m.content, ts: Number.isFinite(m.ts) ? Number(m.ts) : Date.now() }))
}

export function ownKey(role: string, content: string): string {
  return `${role}\u0000${content}`
}

/**
 * Given the session transcript and how many entries were already seen, return
 * the entries to show. Entries this page posted itself (`ownPending`, keys from
 * ownKey) are skipped once each, since the page already shows them.
 */
export function takeNewCollabMessages(
  transcript: CollabMessage[],
  seen: number,
  ownPending: string[],
): { fresh: CollabMessage[]; seen: number; ownPending: string[] } {
  const pending = [...ownPending]
  const fresh: CollabMessage[] = []
  const start = Math.min(Math.max(0, seen), transcript.length)
  for (const message of transcript.slice(start)) {
    const at = pending.indexOf(ownKey(message.role, message.content))
    if (at >= 0) {
      pending.splice(at, 1)
      continue
    }
    fresh.push(message)
  }
  return { fresh, seen: transcript.length, ownPending: pending }
}
