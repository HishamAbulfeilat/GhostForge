import { NextRequest, NextResponse } from 'next/server'

const sessions = new Map<string, {
  messages: Array<{ role: string; content: string; ts: number }>
  createdAt: number
  participants: number
}>()

function cleanup() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(id)
  }
}

export async function GET(req: NextRequest) {
  cleanup()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

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
  const { id, role, content }: { id?: string; role?: string; content?: string } = await req.json()
  if (!id || !role || !content) {
    return NextResponse.json({ error: 'Missing session payload' }, { status: 400 })
  }

  const session = sessions.get(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  session.messages.push({ role, content, ts: Date.now() })
  return NextResponse.json({ ok: true })
}
