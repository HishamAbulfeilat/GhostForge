import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import {
  AgentWorkflowTemplateError,
  getAgentWorkflowTemplate,
  listAgentWorkflowTemplates,
  saveAgentWorkflowTemplate,
} from '@/lib/agent-workflow-templates'
import { repoRootFromLib, runAgentTeamCommand } from '@/lib/agent-team-api'

export const dynamic = 'force-dynamic'
const MAX_REQUEST_BYTES = 16 * 1024

class TemplateRequestError extends Error {}

async function requireAdmin(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || !hasPermission(user, 'admin_tools')) return null
  return user
}

async function readJson(request: NextRequest): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new TemplateRequestError(`Request body exceeds the ${MAX_REQUEST_BYTES} byte limit.`)
  }
  if (!request.body) throw new TemplateRequestError('Request body must be valid JSON.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel()
        throw new TemplateRequestError(`Request body exceeds the ${MAX_REQUEST_BYTES} byte limit.`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new TemplateRequestError('Request body must be valid JSON.')
  }
}

function responseError(error: unknown) {
  if (error instanceof TemplateRequestError) return NextResponse.json({ error: error.message }, { status: 400 })
  if (error instanceof AgentWorkflowTemplateError) return NextResponse.json({ error: error.message }, { status: error.status })
  const message = error instanceof Error ? error.message : 'Workflow template request failed.'
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request)
  if (!user) return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
  try {
    return NextResponse.json({ templates: await listAgentWorkflowTemplates(user.username) })
  } catch (error) {
    return responseError(error)
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin(request)
  if (!user) return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
  try {
    const body = await readJson(request)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new TemplateRequestError('Request body must be an object.')
    }
    const payload = body as Record<string, unknown>
    if (payload.action === 'save' && Object.keys(payload).length === 2 && Object.hasOwn(payload, 'template')) {
      const template = await saveAgentWorkflowTemplate(user.username, payload.template)
      return NextResponse.json({ template }, { status: 201 })
    }
    if (payload.action === 'apply' && Object.keys(payload).length === 2 && Object.hasOwn(payload, 'id')) {
      if (typeof payload.id !== 'string') throw new AgentWorkflowTemplateError('Template ID is invalid.')
      const template = getAgentWorkflowTemplate(user.username, payload.id)
      if (!template) return NextResponse.json({ error: 'Workflow template not found.' }, { status: 404 })
      const result = runAgentTeamCommand('add', {
        title: template.title,
        kind: template.kind,
        agent: template.assignee,
        leader: template.leader,
        workflow: template.workflow,
        dependencies: template.dependencies,
        acceptanceCriteria: template.acceptanceCriteria,
      }, { workspaceRoot: repoRootFromLib() })
      if (!result.ok) return NextResponse.json({ error: result.output || 'Template dispatch failed.' }, { status: 500 })
      return NextResponse.json({ ok: true, templateId: template.id, output: result.output })
    }
    throw new TemplateRequestError('Request action must be save or apply with only its supported fields.')
  } catch (error) {
    return responseError(error)
  }
}
