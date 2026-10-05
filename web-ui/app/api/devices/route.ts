import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { getClientIP } from '@/lib/ratelimit'
import {
  upsertDevice,
  getDevicesForUser,
  deleteDevice,
  getHostInfo,
  isLocalIp,
  type DeviceRecord,
  type HostInfo,
} from '@/lib/devices'
import { listUsers, isOwner } from '@/lib/users'
import { reportUnauthorizedAccess } from '@/lib/intrusion'

/**
 * Device registry API.
 *
 *   GET  /api/devices?user=<username>
 *        Admin: all users' devices (optionally filter by ?user=).
 *        Regular user: only their own devices.
 *   POST /api/devices
 *        Auto-reported by the client (fingerprint + navigator hints). Server
 *        appends its own captured identity (IP, MAC/hostname when local).
 *        Requires a logged-in session.
 *   DELETE /api/devices?user=<username>&id=<deviceId>
 *        Owner only — remove a device record.
 */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdminUser = isAdmin(me)
  if (!isAdminUser) {
    const devices = await getDevicesForUser(me.username)
    return NextResponse.json({ devices, user: me.username })
  }

  const { searchParams } = new URL(req.url)
  const filterUser = searchParams.get('user')?.toLowerCase()
  const users = await listUsers()

  if (filterUser) {
    const target = users.find(u => u.username === filterUser)
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const devices = await getDevicesForUser(target.username)
    return NextResponse.json({ user: target.username, devices })
  }

  const byUser: Array<{ user: string; devices: DeviceRecord[] }> = []
  for (const u of users) {
    const devices = await getDevicesForUser(u.username)
    if (devices.length) byUser.push({ user: u.username, devices })
  }
  return NextResponse.json({ users: byUser })
}

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    id?: string
    name?: string
    ua?: string
    platform?: string
    browser?: string
    model?: string
    details?: Record<string, unknown>
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const deviceId = String(body.id || '').trim()
  if (!deviceId) return NextResponse.json({ error: 'Missing device id' }, { status: 400 })

  const ip = getClientIP(req)
  const hostInfo: HostInfo = await getHostInfo()
  const isLocal = isLocalIp(ip, hostInfo.lanIp)

  const devices = await upsertDevice(me.username, {
    id: deviceId,
    name: body.name,
    ip,
    hostInfo,
    ua: body.ua,
    platform: body.platform,
    browser: body.browser,
    model: body.model,
    details: body.details,
    isLocal,
  })

  const current = devices.find(d => d.id === deviceId) || null
  return NextResponse.json({ device: current, isLocal, devices })
}

export async function DELETE(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const me = await getCurrentUser(req)
  if (!me || !isOwner(me)) {
    void reportUnauthorizedAccess({ reason: 'devices:delete by non-owner', username: me?.username, ip: getClientIP(req), userAgent: req.headers.get('user-agent') || undefined })
    return NextResponse.json({ error: 'Only the owner can remove devices' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const username = searchParams.get('user')?.toLowerCase() || me.username
  const deviceId = searchParams.get('id')
  if (!deviceId) return NextResponse.json({ error: 'Missing device id' }, { status: 400 })

  const ok = await deleteDevice(username, deviceId)
  if (!ok) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
