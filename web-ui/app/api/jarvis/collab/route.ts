import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'

const sessions = new Map<string, {
  messages: Array<{ role: string; content: string; ts: number }>
  createdAt: number
  participants: number
}>()

const ROLE_WHITELIST = ['user', 'assistant']
const SESSION_ID_RE = /^[a-z0-9]{8,}$/i
const MAX_CONTENT_LENGTH = 10_000

function isValidSessionId(id: string) {
  return SESSION_ID_RE.test(id)
}

function cleanup() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(id)
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  cleanup()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id && !isValidSessionId(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  if (!id) {
    const newId = Math.random().toString(36).slice(2, 10)
    sessions.set(newId, { messages: [], createdAt: Date.now(), participants: 1 })
    return NextResponse.json({ id: newId, shareUrl: `/jarvis?session=${newId}` })
  }

  const session = sessions.get(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  session.participants += 1
  return NextResponse.json({ id, messages: session.messages, participants: session.participants })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; role?: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, role, content } = body
  if (!id || !role || !content) {
    return NextResponse.json({ error: 'Missing session payload' }, { status: 400 })
  }

  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  if (!ROLE_WHITELIST.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: `Content must be a string of at most ${MAX_CONTENT_LENGTH} characters` }, { status: 400 })
  }

  const session = sessions.get(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  session.messages.push({ role, content, ts: Date.now() })
  return NextResponse.json({ ok: true })
}
