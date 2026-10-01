import type { Workflow } from '@/lib/workflows/store'

export const MAX_RUN_STEPS = 100

export interface BridgeConfig {
  url: string
  token: string
  fetchImpl?: typeof fetch
}

export class RunError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Run a workflow through the bridge's bounded `action: "run"` contract.
 * The bridge only executes manual (skipped) and allow-listed `bridge:*` command
 * steps; anything else is rejected there with 422, so no arbitrary step runs.
 * The workflow is mirrored into the bridge store, run, and the mirror removed.
 */
export async function runWorkflowOnBridge(
  userId: string,
  workflow: Workflow,
  bridge: BridgeConfig,
): Promise<Workflow> {
  if (workflow.steps.length === 0) throw new RunError('Workflow has no steps to run', 400)
  if (workflow.steps.length > MAX_RUN_STEPS) throw new RunError(`Workflow has more than ${MAX_RUN_STEPS} steps`, 400)

  const doFetch = bridge.fetchImpl ?? fetch
  const call = async (method: string, query: string, body?: unknown) => {
    let res: Response
    try {
      res = await doFetch(`${bridge.url}/api/workflows${query}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      })
    } catch {
      throw new RunError('Bridge is unreachable. Make sure the bridge is running (port 8765).', 502)
    }
    const data = await res.json().catch(() => null) as { detail?: unknown; workflow?: Workflow } | null
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : `Bridge request failed (${res.status}).`
      throw new RunError(detail, res.status === 422 ? 422 : 502)
    }
    return data
  }

  const created = await call('POST', '', {
    user_id: userId, name: workflow.name, goal: workflow.goal, steps: workflow.steps,
  })
  const bridgeId = created?.workflow?.id
  if (!bridgeId) throw new RunError('Bridge returned an invalid response.', 502)
  try {
    const run = await call('POST', '', { user_id: userId, id: bridgeId, action: 'run', max_steps: MAX_RUN_STEPS })
    if (!run?.workflow) throw new RunError('Bridge returned an invalid response.', 502)
    return run.workflow
  } finally {
    await call('DELETE', `?user_id=${encodeURIComponent(userId)}&id=${encodeURIComponent(bridgeId)}`).catch(() => {})
  }
}
