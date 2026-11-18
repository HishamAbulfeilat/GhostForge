/**
 * Pending JARVIS tool confirmations.
 *
 * When the model proposes a dangerous (or confirm-first) tool, the server keeps
 * the exact tool + params it showed the user under a random confirmation id,
 * bound to that user and to an expiry. "Yes" executes only that stored entry,
 * once, for that user; it never re-runs the model with the gate switched off.
 */
import { randomBytes } from 'crypto'

export interface PendingConfirmation {
  userId: string
  tool: string
  toolParams: Record<string, string>
  expiresAt: number
}

export const CONFIRMATION_TTL_MS = 5 * 60_000
const MAX_PENDING = 200

const pending = new Map<string, PendingConfirmation>()

function sweep(now: number) {
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(id)
  }
}

/** Store the action shown to `userId`; returns the id the client must send back. */
export function createPendingConfirmation(
  userId: string,
  tool: string,
  toolParams: Record<string, string>,
  now = Date.now(),
): string {
  sweep(now)
  const id = randomBytes(18).toString('base64url')
  pending.set(id, { userId, tool, toolParams: { ...toolParams }, expiresAt: now + CONFIRMATION_TTL_MS })
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value
    if (oldest === undefined) break
    pending.delete(oldest)
  }
  return id
}

/**
 * Take (and remove) the pending action for `id` if it belongs to `userId` and
 * has not expired. Another user's id is left untouched and yields null.
 */
export function takePendingConfirmation(id: unknown, userId: string, now = Date.now()): PendingConfirmation | null {
  if (typeof id !== 'string' || !id) return null
  const entry = pending.get(id)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    pending.delete(id)
    return null
  }
  if (entry.userId !== userId) return null
  pending.delete(id)
  return entry
}

/** Test helper. */
export function clearPendingConfirmations() {
  pending.clear()
}
