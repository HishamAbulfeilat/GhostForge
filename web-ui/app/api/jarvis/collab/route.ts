import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { getLiveBridgeToken } from '@/lib/bridge-token'
import { BridgeUrlError, getMarkLBridgeUrl } from '@/lib/bridge-url'
import { ensureMarkLivBridge } from '@/lib/mark-liv-bridge'

/**
 * Shared JARVIS sessions. The store is mark-l-bridge's collab store (the same
 * one the TUI creates sessions in), so a share link from either side opens
 * the same session. This route keeps the sign-in check and payload
 * validation, then proxies to the bridge with the bridge token.
 */

const ROLE_WHITELIST = ['user', 'assistant']
const SESSION_ID_RE = /^[a-z0-9]{8,64}$/i
const MAX_CONTENT_LENGTH = 10_000

function isValidSessionId(id: string) {
  return SESSION_ID_RE.test(id)
}

class BridgeDown extends Error {}

async function bridgeCall(pathname: string, init: RequestInit = {}): Promise<Response> {
  let base: string
  try {
    base = getMarkLBridgeUrl()
  } catch (error) {
    if (error instanceof BridgeUrlError) throw new BridgeDown(error.message)
    throw error
  }
  const attempt = () => fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getLiveBridgeToken()}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  try {
    return await attempt()
  } catch {
    // Nothing listening: start the bridge once and retry.
    if (!(await ensureMarkLivBridge())) throw new BridgeDown('The GhostForge bridge is not running')
    try {
      return await attempt()
    } catch {
      throw new BridgeDown('The GhostForge bridge is not reachable')
    }
  }
}

/** Map a bridge reply to this route's reply. */
async function relay(res: Response): Promise<NextResponse> {
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.ok) return NextResponse.json(data)
  if (res.status === 404) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ error: 'The bridge rejected its token. Restart the bridge and try again.' }, { status: 502 })
  }
  if (res.status === 400 || res.status === 422) {
    return NextResponse.json({ error: typeof data.detail === 'string' ? data.detail : 'Invalid session request' }, { status: 400 })
  }
  if (res.status === 503) return NextResponse.json({ error: 'The bridge is not ready' }, { status: 503 })
  return NextResponse.json({ error: `Bridge error (${res.status})` }, { status: 502 })
}

function bridgeDown(error: unknown) {
  const message = error instanceof BridgeDown ? error.message : 'The GhostForge bridge is not reachable'
  return NextResponse.json({ error: message }, { status: 503 })
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id && !isValidSessionId(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  try {
    return await relay(await bridgeCall(id ? `/api/jarvis/collab?id=${encodeURIComponent(id)}` : '/api/jarvis/collab'))
  } catch (error) {
    return bridgeDown(error)
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: unknown; role?: unknown; content?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, role, content } = body ?? {}
  if (!id || !role || !content) {
    return NextResponse.json({ error: 'Missing session payload' }, { status: 400 })
  }

  if (typeof id !== 'string' || !isValidSessionId(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  if (typeof role !== 'string' || !ROLE_WHITELIST.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: `Content must be a string of at most ${MAX_CONTENT_LENGTH} characters` }, { status: 400 })
  }

  try {
    return await relay(await bridgeCall('/api/jarvis/collab', { method: 'POST', body: JSON.stringify({ id, role, content }) }))
  } catch (error) {
    return bridgeDown(error)
  }
}
