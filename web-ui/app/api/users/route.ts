import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import {
  listUsers,
  createUser,
  updateUser,
  setUserPassword,
  deleteUser,
  ensureUserStore,
  isOwner,
  toPublicUser as storeToPublic,
  type GhostUser,
} from '@/lib/users'
import { ALL_PERMISSIONS } from '@/lib/permissions'
import { getClientIP } from '@/lib/ratelimit'
import { reportUnauthorizedAccess } from '@/lib/intrusion'

/**
 * Only the owner (Hisham) may change users. Anyone else who reaches a
 * mutating endpoint is an intrusion: log it and lock the PC.
 */
async function requireOwner(req: NextRequest, action: string): Promise<GhostUser | NextResponse> {
  const me = await getCurrentUser(req)
  if (me && isOwner(me)) return me
  void reportUnauthorizedAccess({
    reason: `users:${action} by non-owner`,
    username: me?.username,
    ip: getClientIP(req),
    userAgent: req.headers.get('user-agent') || undefined,
  })
  return NextResponse.json({ error: 'Only the owner can manage users' }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me || !isAdmin(me)) {
    void reportUnauthorizedAccess({ reason: 'users:list by non-admin', username: me?.username, ip: getClientIP(req), userAgent: req.headers.get('user-agent') || undefined })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await ensureUserStore()
  const users = await listUsers()
  return NextResponse.json({ users: users.map(u => ({ ...storeToPublic(u), owner: isOwner(u) })), canManage: isOwner(me) })
}

export async function POST(req: NextRequest) {
  const me = await requireOwner(req, 'create')
  if (me instanceof NextResponse) return me

  let body: { name?: string; username?: string; password?: string; role?: string; permissions?: string[]; active?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, username, password, role, permissions, active } = body
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }
  // Must start with a letter or digit: usernames name per-user data folders
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/i.test(username)) {
    return NextResponse.json({ error: 'Username must be 2-32 letters, digits, dot, dash or underscore, starting with a letter or digit' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  try {
    const user = await createUser({
      name: name || username,
      username,
      password,
      role: role === 'admin' ? 'admin' : 'user',
      permissions: role === 'admin' ? ['*'] : (Array.isArray(permissions) ? permissions.filter(p => ALL_PERMISSIONS.includes(p)) : []),
      active,
    })
    return NextResponse.json({ user: storeToPublic(user) }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create user' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const me = await requireOwner(req, 'update')
  if (me instanceof NextResponse) return me

  let body: {
    id?: string
    name?: string
    role?: string
    permissions?: string[]
    active?: boolean
    password?: string
    resetSetup?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })

  // The owner cannot demote or deactivate themselves
  if (id === me.id && ((body.role !== undefined && body.role !== 'admin') || body.active === false)) {
    return NextResponse.json({ error: 'You cannot change your own admin role or deactivate yourself' }, { status: 400 })
  }
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length < 8)) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.role !== undefined) patch.role = body.role === 'admin' ? 'admin' : 'user'
  if (body.active !== undefined) patch.active = Boolean(body.active)
  // Send the user back through the job-title setup wizard on their next visit
  if (body.resetSetup) patch.setupComplete = false
  if (body.permissions !== undefined) {
    const sanitized = Array.isArray(body.permissions)
      ? body.permissions.filter(p => ALL_PERMISSIONS.includes(p))
      : []
    patch.permissions = sanitized
  }

  const updated = await updateUser(id, patch)
  if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (body.password) {
    await setUserPassword(id, body.password)
  }

  const refreshed = await listUsers().then(users => users.find(u => u.id === id))
  return NextResponse.json({ user: refreshed ? storeToPublic(refreshed) : storeToPublic(updated) })
}

export async function DELETE(req: NextRequest) {
  const me = await requireOwner(req, 'delete')
  if (me instanceof NextResponse) return me

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })
  if (id === me.id) return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 })

  const ok = await deleteUser(id)
  if (!ok) return NextResponse.json({ error: 'User not found or cannot be deleted' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
