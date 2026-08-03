import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import {
  listUsers,
  createUser,
  updateUser,
  setUserPassword,
  deleteUser,
  ensureUserStore,
  toPublicUser as storeToPublic,
} from '@/lib/users'
import { ALL_PERMISSIONS } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me || !isAdmin(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureUserStore()
  const users = await listUsers()
  return NextResponse.json({ users: users.map(storeToPublic) })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me || !isAdmin(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  try {
    const user = await createUser({
      name: name || username,
      username,
      password,
      role: role === 'admin' ? 'admin' : 'user',
      permissions: role === 'admin' ? ['*'] : (permissions || []),
      active,
    })
    return NextResponse.json({ user: storeToPublic(user) }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create user' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me || !isAdmin(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: {
    id?: string
    name?: string
    role?: string
    permissions?: string[]
    active?: boolean
    password?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })

  // Admin cannot demote or deactivate themselves
  if (id === me.id && (body.role !== undefined || body.active === false)) {
    return NextResponse.json({ error: 'You cannot change your own admin role or deactivate yourself' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.role !== undefined) patch.role = body.role === 'admin' ? 'admin' : 'user'
  if (body.active !== undefined) patch.active = Boolean(body.active)
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
  const me = await getCurrentUser(req)
  if (!me || !isAdmin(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })
  if (id === me.id) return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 })

  const ok = await deleteUser(id)
  if (!ok) return NextResponse.json({ error: 'User not found or cannot be deleted' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
