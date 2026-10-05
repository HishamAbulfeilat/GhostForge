import { NextRequest, NextResponse } from 'next/server'
import { auditLog } from '@/lib/audit'
import { getCurrentUser } from '@/lib/auth'
import { readRemote, revokeDevice } from '@/lib/remote/store'
import { isOwner } from '@/lib/users'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/remote/devices — paired devices (the owner sees everyone's). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const owner = isOwner(user)
  const { devices } = await readRemote()
  return NextResponse.json({
    devices: devices.filter(d => !d.revoked && (owner || d.username === user.username)),
  })
}

/** DELETE /api/remote/devices?id=… — revoke a device; its session stops working at once. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!(await revokeDevice(id, user.username, isOwner(user)))) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
  void auditLog({ level: 'security', event: 'remote_device_revoked', params: { username: user.username, device: id } })
  return NextResponse.json({ ok: true })
}
