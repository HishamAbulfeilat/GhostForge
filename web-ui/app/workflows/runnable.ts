// Client-side mirror of the bridge's run allowlist (`_run_workflow` in
// mark-l-bridge/server.py). It is informational only: the bridge stays the
// authority and rejects anything else with 422.
export const RUNNABLE_COMMAND_REFS = [
  'bridge:health',
  'bridge:release-status',
  'bridge:deploy',
  'bridge:deploy-azure',
  'bridge:azure-deploy',
] as const

// Read-only refs offered as suggestions in the step editor.
export const SUGGESTED_COMMAND_REFS = ['bridge:health', 'bridge:release-status'] as const

interface StepLike {
  id: string
  title: string
  kind: string
  ref: string
  status: string
  log?: Array<{ at: string; msg: string }>
}

export function isRunnableStep(step: Pick<StepLike, 'kind' | 'ref' | 'status'>): boolean {
  if (step.status === 'done' || step.status === 'skipped') return true
  if (step.kind === 'manual') return true
  if (step.kind !== 'command') return false
  return (RUNNABLE_COMMAND_REFS as readonly string[]).includes(step.ref) || step.ref.startsWith('bridge:deploy')
}

export function unsupportedSteps<T extends Pick<StepLike, 'kind' | 'ref' | 'status'>>(steps: T[]): T[] {
  return steps.filter(step => !isRunnableStep(step))
}

export interface RunSummary {
  ok: boolean
  status: string
  total: number
  done: number
  skipped: number
  failed: number
  steps: Array<{ id: string; title: string; status: string; message: string }>
}

export function summarizeRun(workflow: { status: string; steps: StepLike[] }): RunSummary {
  const count = (status: string) => workflow.steps.filter(step => step.status === status).length
  return {
    ok: workflow.status === 'done',
    status: workflow.status,
    total: workflow.steps.length,
    done: count('done'),
    skipped: count('skipped'),
    failed: count('failed'),
    steps: workflow.steps.map(step => ({
      id: step.id,
      title: step.title || step.id,
      status: step.status,
      message: step.log?.at(-1)?.msg ?? '',
    })),
  }
}
