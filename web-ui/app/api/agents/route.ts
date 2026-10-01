import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import {
  readAgentTeamSnapshot,
  readRequestJsonWithLimit,
  normalizeAgentTeamAction,
  repoRootFromLib,
  resolveWorkspaceRoot,
  runAgentTeamCommand,
  toPublicAgentTeamSnapshot,
} from '@/lib/agent-team-api'

export const dynamic = 'force-dynamic'
const MAX_BODY_BYTES = 1024 * 1024

function adminToolsForbidden() {
  return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
}

function authenticationRequired() {
  return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
}

async function requireAdminUser(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || !hasPermission(user, 'admin_tools')) return null
  return user
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) return authenticationRequired()
  const workspaceRoot = resolveWorkspaceRoot(repoRootFromLib())
  const snapshot = readAgentTeamSnapshot(workspaceRoot)
  const publicView = request.nextUrl?.searchParams.get('view') === 'public'

  if (publicView) return NextResponse.json(toPublicAgentTeamSnapshot(snapshot))
  if (!hasPermission(user, 'admin_tools')) return adminToolsForbidden()
  return NextResponse.json(snapshot)
}

export async function POST(request: NextRequest) {
  if (!await requireAdminUser(request)) return adminToolsForbidden()

  try {
    const payload = await readRequestJsonWithLimit(request, MAX_BODY_BYTES)
    const normalized = normalizeAgentTeamAction(payload)
    const result = runAgentTeamCommand(normalized.action, payload, { workspaceRoot: repoRootFromLib() })

    if (!result.ok) {
      return NextResponse.json({ error: result.output || 'Agent-team command failed.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, action: normalized.action, output: result.output })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent-team request failed.'
    const status = /exceeds the .* byte limit|Request body must be valid JSON|action is required|requires a message value|requires a title/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
