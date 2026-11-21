import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { JarvisStoreError, normalizeMessage, readHistory, updateHistory, type HistoryMessage, type HistorySession } from '@/lib/jarvis-store'

export const dynamic = 'force-dynamic'

/**
 * Each user's own JARVIS sessions (~/.ghostforge/users/<username>/jarvis/history.json).
 * Every method needs the `conversation_history` permission and only ever sees
 * or changes the caller's sessions.
 */
function storeError(err: unknown) {
  const message = err instanceof JarvisStoreError ? err.message : 'Could not read conversation history'
  return NextResponse.json({ error: message }, { status: 500 })
}

function matchesDate(session: HistorySession, date: string) {
  const sessionDates = [
    session.startedAt.slice(0, 10),
    session.endedAt.slice(0, 10),
    ...session.messages.map(message => new Date(message.ts).toISOString().slice(0, 10)),
  ]
  return sessionDates.includes(date)
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'conversation_history')
  if (user instanceof NextResponse) return user

  const searchParams = req.nextUrl.searchParams
  const q = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const date = searchParams.get('date')?.trim() ?? ''
  const from = searchParams.get('from')?.trim() ?? ''
  const to = searchParams.get('to')?.trim() ?? ''

  let sessions: HistorySession[]
  try {
    sessions = await readHistory(user)
  } catch (err) {
    return storeError(err)
  }

  if (q) {
    sessions = sessions.filter(session => session.messages.some(message => message.content.toLowerCase().includes(q)))
  }

  if (date) {
    sessions = sessions.filter(session => matchesDate(session, date))
  }

  if (from) {
    sessions = sessions.filter(session => session.startedAt.slice(0, 10) >= from)
  }

  if (to) {
    sessions = sessions.filter(session => session.startedAt.slice(0, 10) <= to)
  }

  return NextResponse.json({ sessions })
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'conversation_history')
  if (user instanceof NextResponse) return user

  let payload: Partial<HistorySession>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof payload.startedAt !== 'string' || typeof payload.endedAt !== 'string' || !Array.isArray(payload.messages)) {
    return NextResponse.json({ error: 'Invalid session payload' }, { status: 400 })
  }

  const messages = payload.messages
    .map(normalizeMessage)
    .filter((message): message is HistoryMessage => message !== null)

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Session must include at least one message' }, { status: 400 })
  }

  const session: HistorySession = {
    id: typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : crypto.randomUUID(),
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    messages,
  }

  try {
    const sessions = await updateHistory(user, history => [session, ...history.filter(existing => existing.id !== session.id)])
    return NextResponse.json({ ok: true, session, sessions })
  } catch (err) {
    return storeError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requirePermission(req, 'conversation_history')
  if (user instanceof NextResponse) return user

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json({ error: 'Session id is required' }, { status: 400 })
  }

  try {
    const sessions = await updateHistory(user, history => history.filter(session => session.id !== id))
    return NextResponse.json({ ok: true, removedId: id, sessions })
  } catch (err) {
    return storeError(err)
  }
}
