import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getInbox, unreadCount, markInboxRead } from '@/lib/inbox'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const includeRead = searchParams.get('includeRead') === 'true'
  const messages = await getInbox(user.username, includeRead)
  return NextResponse.json({ messages, unread: await unreadCount(user.username) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({})) as { id?: string }
  await markInboxRead(user.username, id)
  return NextResponse.json({ ok: true })
}