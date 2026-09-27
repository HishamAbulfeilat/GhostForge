/**
 * Per-permission API guard.
 *
 * Page visibility alone doesn't restrict anything — a limited user could call
 * the API directly. Routes that expose a capability (terminal, files, screen,
 * system control...) call requirePermission() so the account's permission set
 * is enforced server-side. Denials of privileged capabilities are reported as
 * intrusions (audit log + PC lock).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hasPermission, isAuthorizedRequest } from './auth'
import type { GhostUser } from './users'
import { getClientIP } from './ratelimit'
import { PRIVILEGED_PERMISSIONS, reportUnauthorizedAccess } from './intrusion'

/**
 * Resolve the caller and check they hold `permission`.
 * Returns the user on success, or a 401/403 response to return as-is.
 */
export async function requirePermission(req: NextRequest, permission: string): Promise<GhostUser | NextResponse> {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (hasPermission(user, permission)) return user

  if (PRIVILEGED_PERMISSIONS.has(permission)) {
    void reportUnauthorizedAccess({
      reason: `api: ${user.username} called ${req.nextUrl.pathname} without "${permission}"`,
      username: user.username,
      ip: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })
  }
  return NextResponse.json({ error: `Your account doesn't have the "${permission}" permission` }, { status: 403 })
}
