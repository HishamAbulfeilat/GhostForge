/**
 * Client helper for the marketplace page's "Mark installed" / "Unmark" calls.
 *
 * The web UI never runs an install command; it only records a mark in the
 * shared registry. Every failure (401 after a session expires, 403 for a
 * non-admin, 500 when registry.json can't be written, a network error) comes
 * back as { ok: false } with a message the page shows, instead of the button
 * silently snapping back to its old label.
 */

export type MarkResult =
  | { ok: true; installed: string[]; marked: string[] }
  | { ok: false; status: number; unauthorized: boolean; error: string }

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** Request body for POST /api/marketplace. */
export function markRequestBody(id: string, mark: boolean): string {
  return JSON.stringify({ action: mark ? 'mark' : 'unmark', id })
}

export const NETWORK_FAILURE: MarkResult = {
  ok: false,
  status: 0,
  unauthorized: false,
  error: 'Could not reach the server. Check your connection and try again.',
}

/** Turn the POST response into a result the page can show; never throws. */
export async function readMarkResponse(res: Pick<Response, 'ok' | 'status' | 'json'>): Promise<MarkResult> {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = await res.json()
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch { /* non-JSON body: fall through to the status message */ }

  if (res.status === 401) {
    return { ok: false, status: 401, unauthorized: true, error: 'Your session has expired. Sign in again.' }
  }
  if (!res.ok) {
    const message = typeof data.error === 'string' && data.error ? data.error : `Request failed (HTTP ${res.status}).`
    return { ok: false, status: res.status, unauthorized: false, error: message }
  }
  return { ok: true, installed: strings(data.installed), marked: strings(data.marked) }
}
