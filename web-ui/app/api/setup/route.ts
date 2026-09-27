import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { updateUser } from '@/lib/users'
import { auditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import {
  TITLE_PROFILES, allowedPages, getProfile, permissionsForProfile, profileForTitle,
} from '@/lib/title-profiles'

export const dynamic = 'force-dynamic'

/**
 * Setup wizard API.
 *
 *   GET  /api/setup                 → current state + profile catalog
 *   GET  /api/setup?title=<title>   → preview the profile a title maps to
 *   POST /api/setup { name, jobTitle, profileId? }
 *        Saves who the user is. Regular users get their title's permissions
 *        immediately; admins keep full access ('*').
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const title = req.nextUrl.searchParams.get('title')
  const preview = title !== null ? profileForTitle(title) : null
  const labelFor = (key: string) => PERMISSIONS.find(p => p.key === key)?.label || key

  return NextResponse.json({
    user: {
      name: user.name,
      username: user.username,
      role: user.role,
      jobTitle: user.jobTitle || '',
      profileId: user.profileId || null,
      setupComplete: Boolean(user.setupComplete),
    },
    isAdmin: isAdmin(user),
    profiles: TITLE_PROFILES.map(p => {
      const permissions = permissionsForProfile(p)
      return {
        id: p.id,
        label: p.label,
        description: p.description,
        permissions: permissions.map(key => ({ key, label: labelFor(key) })),
        pages: allowedPages({ role: 'user', permissions }).filter(pg => pg.nav || pg.path === '/jarvis').map(pg => ({ path: pg.path, label: pg.label, icon: pg.icon })),
      }
    }),
    preview: preview ? { id: preview.id, label: preview.label } : null,
  })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { name?: string; jobTitle?: string; profileId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = String(body.name || '').trim().slice(0, 80)
  const jobTitle = String(body.jobTitle || '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'Tell us your name' }, { status: 400 })
  if (!jobTitle) return NextResponse.json({ error: 'Tell us your job title' }, { status: 400 })

  const profile = (body.profileId && getProfile(body.profileId)) || profileForTitle(jobTitle)
  const admin = isAdmin(user)

  // Setup runs once. Re-running it would let a user pick a more privileged
  // title after the fact; the owner resets it from the Users page instead.
  if (user.setupComplete && !admin) {
    return NextResponse.json({ error: 'Setup is already complete. Ask the owner to reset it from the Users page.' }, { status: 409 })
  }

  const updated = await updateUser(user.id, {
    name,
    jobTitle,
    profileId: profile.id,
    setupComplete: true,
    // Admins keep full access; everyone else gets exactly their title's access
    ...(admin ? {} : { permissions: permissionsForProfile(profile) }),
  })
  if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  void auditLog({
    level: 'info',
    event: 'setup_completed',
    params: { username: user.username, jobTitle, profile: profile.id, admin },
  })

  return NextResponse.json({
    ok: true,
    profile: { id: profile.id, label: profile.label },
    permissions: updated.permissions,
    pages: allowedPages(updated).map(p => p.path),
  })
}
