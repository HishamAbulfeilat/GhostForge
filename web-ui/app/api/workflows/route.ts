import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import {
  createWorkflow, deleteWorkflow, getWorkflow, listWorkflows, progress, readySteps,
  updateStep, updateWorkflow, type WorkflowInput, type WorkflowStatus, type WorkflowStep,
} from '@/lib/workflows/store'

export const dynamic = 'force-dynamic'

/** GET /api/workflows            list all
 *  GET /api/workflows?id=<id>    one workflow + progress + ready steps */
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'workflows')
  if (user instanceof NextResponse) return user

  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const wf = await getWorkflow(user.username, id)
    if (!wf) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    return NextResponse.json({ workflow: wf, progress: progress(wf), ready: readySteps(wf).map(s => s.id) })
  }
  const workflows = await listWorkflows(user.username)
  return NextResponse.json({ workflows: workflows.map(w => ({ ...w, progress: progress(w) })) })
}

/** POST /api/workflows { name, goal?, steps? } — create */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'workflows')
  if (user instanceof NextResponse) return user
  let body: WorkflowInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'A workflow name is required' }, { status: 400 })
  }
  const wf = await createWorkflow(user.username, body)
  return NextResponse.json({ workflow: wf })
}

/**
 * PUT /api/workflows
 *   { id, name?, goal?, status?, steps? }                          update the workflow
 *   { id, stepId, step: { status?, notes?, title?, ref? }, log? }  update one step
 */
export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, 'workflows')
  if (user instanceof NextResponse) return user
  let body: {
    id?: string; stepId?: string; log?: string
    name?: string; goal?: string; status?: WorkflowStatus
    steps?: WorkflowInput['steps']
    step?: Partial<Pick<WorkflowStep, 'status' | 'notes' | 'title' | 'ref'>>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'Workflow id required' }, { status: 400 })

  if (body.stepId && body.step) {
    const wf = await updateStep(user.username, body.id, body.stepId, body.step, body.log)
    if (!wf) return NextResponse.json({ error: 'Workflow or step not found' }, { status: 404 })
    return NextResponse.json({ workflow: wf, progress: progress(wf) })
  }

  const wf = await updateWorkflow(user.username, body.id, {
    name: body.name, goal: body.goal, status: body.status, steps: body.steps,
  })
  if (!wf) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  return NextResponse.json({ workflow: wf, progress: progress(wf) })
}

/** DELETE /api/workflows?id=<id> */
export async function DELETE(req: NextRequest) {
  const user = await requirePermission(req, 'workflows')
  if (user instanceof NextResponse) return user
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Workflow id required' }, { status: 400 })
  const ok = await deleteWorkflow(user.username, id)
  return NextResponse.json({ ok })
}
