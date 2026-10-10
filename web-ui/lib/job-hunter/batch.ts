/**
 * Durable batch "Confirm & apply": the user reviews several prepared
 * applications and confirms them; the server then applies to them one at a
 * time, even after the browser tab closes, and survives a restart.
 *
 * Safety rules (same as a single approval):
 *  - Only the exact jobs the user confirmed, with the exact materials they
 *    reviewed: a job whose CV, letter or answers changed afterwards is skipped.
 *  - A job whose Submit was already pressed needs that job's own "I checked: it
 *    was not sent" confirmation, and only for the press the user saw. A newer
 *    press is never covered.
 *  - Applications go through approveJob (by: 'user'), so its compare-and-set
 *    claim, per-job operation lock and refusals all still apply. Autopilot
 *    never creates or confirms a batch.
 *  - An item that was running when GhostForge stopped is handed back to the
 *    user, never re-run: the form may already have been sent.
 */
import { createHash } from 'crypto'
import { auditLog } from '../audit'
import { currentOwner, ownerGone } from './job-db'
import { getJob, listJobUsers, readJobState, updateJobState, type JobRecord } from './store'
import { notifyJob } from './notifications'

export type BatchItemState = 'queued' | 'running' | 'submitted' | 'needs_user' | 'failed' | 'skipped' | 'cancelled'

export interface BatchItem {
  id: string
  title: string
  company: string
  /** Fingerprint of the CV, letter and answers the user reviewed */
  materials: string
  /** The user ticked "I checked: it was not sent" for the Submit press at `submitPressedAt` */
  confirmResubmit: boolean
  submitPressedAt?: string
  state: BatchItemState
  message?: string
  startedAt?: string
  finishedAt?: string
}

export interface ApplyBatch {
  id: string
  state: 'running' | 'done' | 'cancelled'
  createdAt: string
  updatedAt: string
  items: BatchItem[]
  /** The server process working through the queue, with a heartbeat */
  worker?: { process: string; pid: number; host: string; heartbeatAt: string } | null
}

type Approve = (username: string, id: string, opts: { by: 'user'; confirmResubmit: boolean }) => Promise<{ job: JobRecord; message: string }>

const STATE = 'apply-batch'
export const MAX_BATCH = 25
/** A worker that hasn't sent a heartbeat for this long is presumed gone (another machine) */
const STALE_MS = 10 * 60_000
const HEARTBEAT_MS = 60_000

const running: Set<string> = ((globalThis as { __gfBatchWorkers?: Set<string> }).__gfBatchWorkers ??= new Set())

export function materialsFingerprint(job: Pick<JobRecord, 'tailoredResume' | 'coverLetter' | 'answers' | 'preparationWarning'>): string {
  return createHash('sha256').update(JSON.stringify([job.tailoredResume || '', job.coverLetter || '', job.answers || [], job.preparationWarning || ''])).digest('hex').slice(0, 24)
}

export function getApplyBatch(username: string): Promise<ApplyBatch | null> {
  return readJobState<ApplyBatch | null>(username, STATE, null)
}

const label = (job: Pick<JobRecord, 'title' | 'company'>) => `${job.title} at ${job.company}`

/**
 * Queue the user's confirmed applications. Every job must belong to the user,
 * be prepared, and (if Submit was pressed before) carry its own resubmit
 * confirmation. Refused while another batch is still running.
 */
export async function startApplyBatch(
  username: string,
  requested: Array<{ id: string; confirmResubmit?: boolean }>,
  opts: { approve?: Approve; autoStart?: boolean } = {},
): Promise<ApplyBatch> {
  if (!Array.isArray(requested) || !requested.length) throw new Error('Select at least one prepared application')
  if (requested.length > MAX_BATCH) throw new Error(`Confirm at most ${MAX_BATCH} applications at a time`)
  const ids = requested.map(r => String(r?.id || ''))
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Each application can be confirmed once per batch')

  const items: BatchItem[] = []
  for (const r of requested) {
    // Read under the caller's own username: another user's job id is simply not found
    const job = await getJob(username, String(r.id))
    if (!job) throw new Error('Job not found')
    if (!['ready', 'needs_user', 'failed'].includes(job.status)) throw new Error(`${label(job)} is "${job.status}" and can't be applied to now`)
    if (!job.tailoredResume?.trim() || !job.coverLetter?.trim()) throw new Error(`Prepare ${label(job)} before confirming it`)
    if (job.submitPressedAt && r.confirmResubmit !== true) {
      throw new Error(`Submit was already pressed for ${label(job)}, so it may have been sent. Check, then tick "I checked: it was not sent" for it, or leave it out.`)
    }
    items.push({
      id: job.id, title: job.title, company: job.company, materials: materialsFingerprint(job),
      confirmResubmit: Boolean(job.submitPressedAt && r.confirmResubmit === true),
      ...(job.submitPressedAt ? { submitPressedAt: job.submitPressedAt } : {}),
      state: 'queued',
    })
  }

  const now = new Date().toISOString()
  let refused = ''
  const batch = await updateJobState<ApplyBatch | null>(username, STATE, null, current => {
    if (current?.state === 'running' && current.items.some(i => i.state === 'queued' || i.state === 'running')) {
      refused = 'A batch of applications is already running. Wait for it to finish or cancel it first.'
      return undefined
    }
    return { id: now.replace(/\D/g, '').slice(0, 17), state: 'running', createdAt: now, updatedAt: now, items, worker: null }
  })
  if (refused) throw new Error(refused)
  void auditLog({ level: 'info', event: 'job_batch_confirmed', params: { username, jobs: items.map(i => i.id), resubmit: items.filter(i => i.confirmResubmit).map(i => i.id) } })
  if (opts.autoStart !== false) void runApplyBatch(username, opts)
  return batch!
}

/** Stop after the current application; queued ones are not started. */
export async function cancelApplyBatch(username: string): Promise<ApplyBatch | null> {
  const now = new Date().toISOString()
  const batch = await updateJobState<ApplyBatch | null>(username, STATE, null, current => {
    if (!current || current.state !== 'running') return undefined
    return {
      ...current, state: 'cancelled', updatedAt: now,
      items: current.items.map(i => i.state === 'queued' ? { ...i, state: 'cancelled' as const, message: 'Cancelled before it started', finishedAt: now } : i),
    }
  })
  if (batch?.state === 'cancelled') void auditLog({ level: 'info', event: 'job_batch_cancelled', params: { username, batch: batch.id } })
  return batch
}

/** Take the worker role for this user's running batch, unless a live worker has it */
async function claimWorker(username: string): Promise<boolean> {
  const me = currentOwner()
  const now = new Date().toISOString()
  let claimed = false
  await updateJobState<ApplyBatch | null>(username, STATE, null, current => {
    if (!current || current.state !== 'running') return undefined
    const w = current.worker
    const mine = w && w.process === me.process
    const alive = w && !mine && !ownerGone(w) && Date.now() - Date.parse(w.heartbeatAt) < STALE_MS
    if (alive) return undefined
    claimed = true
    // An item still "running" here was left by a worker that stopped (no loop runs for this
    // user in this process, and no live one elsewhere). It may already have been submitted:
    // hand it to the user, never re-run it.
    const items = current.items.map(i => i.state === 'running'
      ? { ...i, state: 'needs_user' as const, finishedAt: now, message: 'Interrupted (GhostForge stopped). Check your email or the site to see whether it was sent before applying again.' }
      : i)
    return { ...current, items, updatedAt: now, worker: { ...me, heartbeatAt: now } }
  })
  return claimed
}

function patchBatch(username: string, batchId: string, fn: (b: ApplyBatch) => ApplyBatch | undefined): Promise<ApplyBatch | null> {
  return updateJobState<ApplyBatch | null>(username, STATE, null, current => current && current.id === batchId ? fn(current) : undefined)
}

/**
 * Work through the user's running batch, one application at a time. Safe to
 * call repeatedly (page loads, server start): only one worker runs per user.
 */
export async function runApplyBatch(username: string, opts: { approve?: Approve } = {}): Promise<void> {
  if (running.has(username)) return
  running.add(username)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    if (!await claimWorker(username)) return
    const first = await getApplyBatch(username)
    if (!first) return
    const batchId = first.id
    heartbeat = setInterval(() => {
      void patchBatch(username, batchId, b => b.worker?.process === currentOwner().process ? { ...b, worker: { ...b.worker, heartbeatAt: new Date().toISOString() } } : undefined).catch(() => {})
    }, HEARTBEAT_MS)
    heartbeat.unref?.()
    const approve = opts.approve ?? (async (u, id, o) => (await import('./index')).approveJob(u, id, o))

    for (;;) {
      // Pick the next queued item (and mark it running) in one step
      let next: BatchItem | undefined
      const batch = await patchBatch(username, batchId, b => {
        if (b.state !== 'running' || b.worker?.process !== currentOwner().process) return undefined
        const i = b.items.findIndex(item => item.state === 'queued')
        if (i < 0) return undefined
        const startedAt = new Date().toISOString()
        next = { ...b.items[i], state: 'running', startedAt, message: 'Applying' }
        return { ...b, updatedAt: startedAt, items: b.items.map((item, n) => n === i ? next! : item) }
      })
      if (!batch || !next) break
      const item: BatchItem = next
      const result = await applyOne(username, item, approve)
      await patchBatch(username, batchId, b => ({
        ...b, updatedAt: new Date().toISOString(),
        items: b.items.map(i => i.id === item.id && i.state === 'running' ? { ...i, ...result, finishedAt: new Date().toISOString() } : i),
      }))
    }

    // Finished (or cancelled): close it and tell the user
    const done = await patchBatch(username, batchId, b => {
      if (b.worker?.process !== currentOwner().process) return undefined
      const open = b.items.some(i => i.state === 'queued' || i.state === 'running')
      return { ...b, state: b.state === 'running' && !open ? 'done' : b.state, worker: null, updatedAt: new Date().toISOString() }
    })
    if (done && done.state !== 'running') {
      const count = (s: BatchItemState) => done.items.filter(i => i.state === s).length
      const summary = `${count('submitted')} submitted, ${count('needs_user')} need you, ${count('failed') + count('skipped')} not sent${count('cancelled') ? `, ${count('cancelled')} cancelled` : ''}.`
      void auditLog({ level: 'info', event: 'job_batch_finished', params: { username, batch: done.id, summary } })
      void notifyJob(username, `batch-${done.id}`, { title: done.state === 'cancelled' ? 'Batch applications cancelled' : 'Batch applications finished', body: summary })
    }
  } catch (e) {
    void auditLog({ level: 'warn', event: 'job_batch_error', params: { username, error: String(e).slice(0, 200) } })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    running.delete(username)
  }
}

async function applyOne(username: string, item: BatchItem, approve: Approve): Promise<Pick<BatchItem, 'state' | 'message'>> {
  const job = await getJob(username, item.id)
  if (!job) return { state: 'skipped', message: 'The job no longer exists' }
  if (materialsFingerprint(job) !== item.materials) {
    return { state: 'skipped', message: 'The CV, cover letter or answers changed after you confirmed. Review it again before applying.' }
  }
  // The resubmit confirmation covers only the Submit press the user saw when confirming
  const confirmResubmit = item.confirmResubmit && Boolean(job.submitPressedAt) && job.submitPressedAt === item.submitPressedAt
  if (job.submitPressedAt && !confirmResubmit) {
    return { state: 'skipped', message: 'Submit was pressed for this application after you confirmed the batch, so it may have been sent. Check before applying again.' }
  }
  try {
    const { job: after, message } = await approve(username, item.id, { by: 'user', confirmResubmit })
    const state: BatchItemState = after.status === 'submitted' ? 'submitted' : after.status === 'needs_user' ? 'needs_user' : 'failed'
    return { state, message }
  } catch (e) {
    // approveJob refused (already submitting/submitted, materials missing, another operation running…)
    return { state: 'skipped', message: e instanceof Error ? e.message : String(e) }
  }
}

/** Server start: continue any batch that was running when GhostForge stopped */
export async function resumeApplyBatches(): Promise<void> {
  for (const username of await listJobUsers()) {
    try {
      const batch = await getApplyBatch(username)
      if (batch?.state === 'running') void runApplyBatch(username)
    } catch { /* one user's unreadable data must not stop the others */ }
  }
}
