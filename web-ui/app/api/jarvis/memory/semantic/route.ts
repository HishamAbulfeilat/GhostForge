import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  rememberMemory,
  recallMemory,
  listMemories,
  deleteMemory,
  memoryStats,
  clearMemory,
} from '@/lib/semantic-memory'

export const dynamic = 'force-dynamic'

/** GET ?q=<query>&k=5 → recall; GET ?list=1&category= → list; GET → stats */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')
  const list = req.nextUrl.searchParams.get('list')
  const category = req.nextUrl.searchParams.get('category') || undefined

  if (q) {
    const k = Math.min(parseInt(req.nextUrl.searchParams.get('k') || '5', 10) || 5, 20)
    const { results, method } = await recallMemory(user.username, q, k)
    return NextResponse.json({ results, method })
  }
  if (list !== null) {
    const results = await listMemories(user.username, category)
    return NextResponse.json({ results })
  }
  return NextResponse.json(await memoryStats(user.username))
}

/** POST { text, category? } → remember */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { text?: string; category?: string }
  try { body = await req.json() } catch { body = {} }
  const text = String(body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 })

  const result = await rememberMemory(user.username, text, body.category)
  return NextResponse.json({ ok: true, ...result })
}

/** DELETE { id } → remove one; DELETE { clear: true } → wipe all */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { id?: string; clear?: boolean }
  if (body.clear) {
    await clearMemory(user.username)
    return NextResponse.json({ ok: true, cleared: true })
  }
  if (!body.id) return NextResponse.json({ error: 'No id' }, { status: 400 })
  const deleted = await deleteMemory(user.username, body.id)
  return deleted
    ? NextResponse.json({ ok: true, deleted: true })
    : NextResponse.json({ error: 'Not found' }, { status: 404 })
}