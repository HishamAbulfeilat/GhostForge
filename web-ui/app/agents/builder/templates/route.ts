import { NextRequest, NextResponse } from 'next/server'
import {
  AgentWorkflowError,
  listAgentTeamTemplates,
  listAgentWorkflowTemplates,
  saveAgentWorkflowTemplate,
} from '@/lib/agent-workflows'
import {
  getEnabledWorkflowAgents,
  readWorkflowJson,
  requireWorkflowAdmin,
  workflowErrorResponse,
} from '../workflow-server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await requireWorkflowAdmin(request)
  if (user instanceof NextResponse) return user
  try {
    const { root, agents } = getEnabledWorkflowAgents()
    const availableAgentIds = [...agents.keys()]
    return NextResponse.json({
      teamTemplates: listAgentTeamTemplates(root),
      workflowTemplates: listAgentWorkflowTemplates(availableAgentIds, root),
    })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const user = await requireWorkflowAdmin(request)
  if (user instanceof NextResponse) return user
  try {
    const body = await readWorkflowJson(request)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AgentWorkflowError('Request body must be an object.')
    }
    const payload = body as Record<string, unknown>
    if (Object.keys(payload).length !== 2 || payload.action !== 'save' || !Object.hasOwn(payload, 'workflow')) {
      throw new AgentWorkflowError('Workflow template request must contain action "save" and one workflow.')
    }
    const { root, agents } = getEnabledWorkflowAgents()
    const template = saveAgentWorkflowTemplate(payload.workflow, [...agents.keys()], root)
    return NextResponse.json({ template }, { status: 201 })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
