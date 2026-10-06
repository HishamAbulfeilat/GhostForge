import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { readAgentTeamSnapshot, repoRootFromLib } from '@/lib/agent-team-api'

export const MAX_WORKFLOW_REQUEST_BYTES = 128 * 1024

export async function requireWorkflowAdmin(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || !hasPermission(user, 'admin_tools')) {
    return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
  }
  return user
}

export async function readWorkflowJson(request: NextRequest): Promise<unknown> {
  if (!request.body) throw new Error('Request body must be valid JSON.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_WORKFLOW_REQUEST_BYTES) {
        await reader.cancel()
        throw new Error(`Request body exceeds the ${MAX_WORKFLOW_REQUEST_BYTES} byte limit.`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('Request body must be valid JSON.')
  }
}

export function getEnabledWorkflowAgents(root = repoRootFromLib()) {
  const snapshot = readAgentTeamSnapshot(root).snapshot
  const records = Object.entries(snapshot.agents)
    .filter(([, agent]) => agent.enabled)
    .map(([id, agent]) => [id, { provider: agent.provider ?? 'unknown', model: agent.model ?? 'auto' }] as const)
  if (snapshot.boss?.enabled) {
    records.push(['boss', { provider: snapshot.boss.provider ?? 'unknown', model: snapshot.boss.model ?? 'auto' }])
  }
  return { root, snapshot, agents: new Map(records) }
}

export function workflowErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Workflow request failed.'
  const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : /Request body|byte limit/.test(message) ? 400 : 500
  return NextResponse.json({ error: message }, { status })
}
