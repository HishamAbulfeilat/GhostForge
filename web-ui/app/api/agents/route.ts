import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import {
  AGENT_SESSION_CONNECTOR_MAX_BYTES,
  readAgentTeamSnapshot,
  readConnectorSnapshot,
  readRequestJsonWithLimit,
  normalizeAgentTeamAction,
  repoRootFromLib,
  resolveWorkspaceRoot,
  runAgentTeamCommand,
} from '@/lib/agent-team-api'

export const dynamic = 'force-dynamic'
const MAX_BODY_BYTES = 1024 * 1024

function readConfiguredConnectorConfig(): unknown {
  const rawConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  if (!rawConfig?.trim()) return null
  if (Buffer.byteLength(rawConfig, 'utf8') > AGENT_SESSION_CONNECTOR_MAX_BYTES) {
    throw new Error(`GF_AGENT_SESSION_CONNECTORS exceeds the ${AGENT_SESSION_CONNECTOR_MAX_BYTES} byte limit.`)
  }

  try {
    return JSON.parse(rawConfig)
  } catch {
    throw new Error('GF_AGENT_SESSION_CONNECTORS must be valid JSON.')
  }
}

function adminToolsForbidden() {
  return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
}

async function requireAdminUser(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || !hasPermission(user, 'admin_tools')) return null
  return user
}

export async function GET(request: NextRequest) {
  if (!await requireAdminUser(request)) return adminToolsForbidden()
  const workspaceRoot = resolveWorkspaceRoot(repoRootFromLib())
  let connectorConfig: unknown
  try {
    connectorConfig = readConfiguredConnectorConfig()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent connector configuration failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  try {
    const connectorSnapshot = await readConnectorSnapshot(connectorConfig, workspaceRoot)
    return NextResponse.json({
      ...readAgentTeamSnapshot(workspaceRoot),
      connectorSnapshot,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent connector configuration failed.'
    const invalidConfig = /Duplicate connector IDs|Connector ID .* is reserved|configuration exceeds the .* connector limit/.test(message)
    return NextResponse.json({ error: invalidConfig ? message : 'Agent connector snapshot failed.' }, { status: invalidConfig ? 400 : 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!await requireAdminUser(request)) return adminToolsForbidden()

  try {
    const payload = await readRequestJsonWithLimit(request, MAX_BODY_BYTES)
    const normalized = normalizeAgentTeamAction(payload)
    const commandPayload = normalized.action === 'add' || normalized.action === 'dispatch'
      ? { ...normalized, leader: normalized.leader || 'boss', assignee: normalized.assignee || normalized.agent || 'any' }
      : normalized
    const result = runAgentTeamCommand(normalized.action, commandPayload, { workspaceRoot: repoRootFromLib() })

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
