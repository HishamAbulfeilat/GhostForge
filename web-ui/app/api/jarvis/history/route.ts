import { NextRequest, NextResponse } from 'next/server'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const HISTORY_DIR = join(homedir(), '.ghostforge', 'jarvis')
const HISTORY_FILE = join(HISTORY_DIR, 'history.json')
const MAX_SESSIONS = 100

type HistoryRole = 'user' | 'ai'

interface HistoryMessage {
  role: HistoryRole
  content: string
  ts: number
}

interface HistorySession {
  id: string
  startedAt: string
  endedAt: string
  messages: HistoryMessage[]
}

function isAuthorized(req: NextRequest) {
  return isAuthorizedRequest(req)
}

function normalizeMessage(input: unknown): HistoryMessage | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<HistoryMessage>
  if ((candidate.role !== 'user' && candidate.role !== 'ai') || typeof candidate.content !== 'string' || typeof candidate.ts !== 'number') {
    return null
  }

  return {
    role: candidate.role,
    content: candidate.content,
    ts: candidate.ts,
  }
}

function normalizeSession(input: unknown): HistorySession | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<HistorySession>
  if (typeof candidate.id !== 'string' || typeof candidate.startedAt !== 'string' || typeof candidate.endedAt !== 'string' || !Array.isArray(candidate.messages)) {
    return null
  }

  const messages = candidate.messages
    .map(normalizeMessage)
    .filter((message): message is HistoryMessage => message !== null)

  return {
    id: candidate.id,
    startedAt: candidate.startedAt,
    endedAt: candidate.endedAt,
    messages,
  }
}

async function readHistory(): Promise<HistorySession[]> {
  try {
    const raw = await readFile(HISTORY_FILE, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map(normalizeSession)
      .filter((session): session is HistorySession => session !== null)
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
  } catch {
    return []
  }
}

async function writeHistory(sessions: HistorySession[]) {
  await mkdir(HISTORY_DIR, { recursive: true })
  const trimmed = [...sessions]
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
    .slice(0, MAX_SESSIONS)
  await writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8')
  return trimmed
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
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = req.nextUrl.searchParams
  const q = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const date = searchParams.get('date')?.trim() ?? ''
  const from = searchParams.get('from')?.trim() ?? ''
  const to = searchParams.get('to')?.trim() ?? ''

  let sessions = await readHistory()

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
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const history = await readHistory()
  const deduped = history.filter(existing => existing.id !== session.id)
  const sessions = await writeHistory([session, ...deduped])
  return NextResponse.json({ ok: true, session, sessions })
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json({ error: 'Session id is required' }, { status: 400 })
  }

  const history = await readHistory()
  const sessions = history.filter(session => session.id !== id)
  await writeHistory(sessions)
  return NextResponse.json({ ok: true, removedId: id, sessions })
}
