import { NextRequest, NextResponse } from 'next/server'
import { AgentWorkflowError, normalizeAgentWorkflow, orderWorkflowTasks, resolveWorkflowTaskDependenciesForTask } from '@/lib/agent-workflows'
import { runAgentTeamCommand } from '@/lib/agent-team-api'
import {
  getEnabledWorkflowAgents,
  readWorkflowJson,
  requireWorkflowAdmin,
  workflowErrorResponse,
} from '../workflow-server'

export const dynamic = 'force-dynamic'
const TASK_INGEST_TIMEOUT_MS = 60_000
const TASK_INGEST_POLL_MS = 500

class WorkflowLaunchError extends AgentWorkflowError {
  launched: Array<{ workflowTaskId: string; taskId: string; dependencies: string[] }>

  constructor(message: string, status: number, launched: WorkflowLaunchError['launched']) {
    super(message, status)
    this.launched = launched
  }
}

async function waitForTaskId(
  root: string,
  title: string,
  originalIds: ReadonlySet<string>,
): Promise<string> {
  const deadline = Date.now() + TASK_INGEST_TIMEOUT_MS
  while (Date.now() < deadline) {
    const snapshot = getEnabledWorkflowAgents(root).snapshot
    const matches = snapshot.tasks.filter(task => task.title === title && task.id && !originalIds.has(task.id))
    if (matches.length === 1) return matches[0].id!
    if (matches.length > 1) throw new AgentWorkflowError(`Task title "${title}" became ambiguous while launching.`, 409)
    await new Promise(resolve => setTimeout(resolve, TASK_INGEST_POLL_MS))
  }
  throw new AgentWorkflowError(`The boss did not add "${title}" to the task board in time.`, 504)
}

export async function POST(request: NextRequest) {
  const user = await requireWorkflowAdmin(request)
  if (user instanceof NextResponse) return user
  const launched: WorkflowLaunchError['launched'] = []
  try {
    const body = await readWorkflowJson(request)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'workflow')) {
      throw new AgentWorkflowError('Request body must contain exactly one workflow.')
    }
    const { root, snapshot, agents } = getEnabledWorkflowAgents()
    if (!snapshot.running) throw new AgentWorkflowError('Start the agent team before launching a workflow.', 409)

    const workflow = normalizeAgentWorkflow((body as Record<string, unknown>).workflow, [...agents.keys()])
    for (const worker of workflow.workers) {
      const current = agents.get(worker.id)
      if (!current || worker.provider !== current.provider || worker.model !== current.model) {
        throw new AgentWorkflowError(`Provider or model for "${worker.id}" changed. Reload the builder and try again.`, 409)
      }
    }
    const boardIds = new Set(snapshot.tasks.flatMap(task => task.id ? [task.id] : []))
    for (const task of workflow.tasks) {
      for (const dependency of task.dependsOn) {
        if (/^T-\d{1,6}$/.test(dependency) && !boardIds.has(dependency)) {
          throw new AgentWorkflowError(`Dependency "${dependency}" is not present on the task board.`, 400)
        }
      }
      if (snapshot.tasks.some(existing => existing.status !== 'done' && existing.title.toLowerCase() === task.title.toLowerCase())) {
        throw new AgentWorkflowError(`Task "${task.title}" already exists on the active board.`, 409)
      }
    }

    const originalIds = new Set(boardIds)
    const taskIds = new Map<string, string>()
    for (const task of orderWorkflowTasks(workflow)) {
      const dependencies = resolveWorkflowTaskDependenciesForTask(workflow, task, taskIds)
      const result = runAgentTeamCommand('add', {
        title: task.title,
        kind: task.kind,
        area: task.area,
        agent: task.assignee,
        assignee: task.assignee,
        leader: workflow.leader,
        workflow: workflow.mode,
        dependencies,
        acceptanceCriteria: task.acceptanceCriteria,
      }, { workspaceRoot: root })
      if (!result.ok) throw new AgentWorkflowError(result.output || `Unable to queue "${task.title}".`, 502)
      try {
        const taskId = await waitForTaskId(root, task.title, originalIds)
        taskIds.set(task.id, taskId)
        launched.push({ workflowTaskId: task.id, taskId, dependencies })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unable to confirm task "${task.title}" on the board.`
        const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
          ? error.status
          : 504
        throw new WorkflowLaunchError(message, status, [...launched, {
          workflowTaskId: task.id,
          taskId: 'pending',
          dependencies,
        }])
      }
    }
    return NextResponse.json({ queued: launched }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkflowLaunchError) {
      return NextResponse.json({ error: error.message, launched: error.launched }, { status: error.status })
    }
    if (error instanceof AgentWorkflowError && launched.length > 0) {
      return NextResponse.json({ error: error.message, launched }, { status: error.status })
    }
    return workflowErrorResponse(error)
  }
}
