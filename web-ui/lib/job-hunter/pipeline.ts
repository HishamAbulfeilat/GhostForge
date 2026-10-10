/**
 * What happens after an application was sent: stage (applied → screening →
 * interview → offer, or rejected), a follow-up day, and notes. Everything is
 * entered by the user; GhostForge never reads a mailbox to guess it.
 *
 * On the follow-up day the user gets one reminder through the usual Job
 * Hunter notifications (push when set up), and the job is marked
 * "Follow up" on /jobs.
 */
import { auditLog } from '../audit'
import { listJobs, listJobUsers, mutateJob, type ApplicationPipeline, type JobRecord, type PipelineStage } from './store'
import { notifyJob } from './notifications'

export const PIPELINE_STAGES: PipelineStage[] = ['applied', 'screening', 'interview', 'offer', 'rejected']
const MAX_NOTES = 4000

export interface PipelinePatch {
  stage?: unknown
  /** YYYY-MM-DD, or null/'' to clear */
  followUpAt?: unknown
  /** Set the follow-up day this many days from today (e.g. 7) */
  followUpInDays?: unknown
  notes?: unknown
}

/** Today's date (YYYY-MM-DD) in the server's time zone */
export function localDay(now = new Date()): string {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 10)
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Stage of a sent application; one without pipeline data is simply "applied" */
export function pipelineOf(job: Pick<JobRecord, 'status' | 'pipeline'>): ApplicationPipeline | null {
  if (job.status !== 'submitted') return null
  return job.pipeline ?? { stage: 'applied' }
}

/** A follow-up is due (on or after its day) and the application is still open */
export function followUpDue(job: Pick<JobRecord, 'status' | 'pipeline'>, today = localDay()): boolean {
  const p = pipelineOf(job)
  return Boolean(p?.followUpAt && p.followUpAt <= today && p.stage !== 'rejected' && p.stage !== 'offer')
}

/**
 * Update the pipeline of one of the user's sent applications. Only jobs in
 * "submitted" qualify, checked in the same write as the change.
 */
export async function updatePipeline(username: string, id: string, patch: PipelinePatch, now = new Date()): Promise<JobRecord> {
  if (patch.stage !== undefined && !PIPELINE_STAGES.includes(patch.stage as PipelineStage)) throw new Error('Unknown stage')
  let followUpAt: string | null | undefined
  if (patch.followUpInDays !== undefined) {
    const days = Number(patch.followUpInDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Follow up in 1 to 365 days')
    followUpAt = localDay(new Date(now.getTime() + days * 86_400_000))
  } else if (patch.followUpAt === null || patch.followUpAt === '') {
    followUpAt = null
  } else if (patch.followUpAt !== undefined) {
    if (typeof patch.followUpAt !== 'string' || !validDay(patch.followUpAt)) throw new Error('Follow-up date must be YYYY-MM-DD')
    followUpAt = patch.followUpAt
  }
  if (patch.notes !== undefined && typeof patch.notes !== 'string') throw new Error('Notes must be text')
  const notes = typeof patch.notes === 'string' ? patch.notes.slice(0, MAX_NOTES) : undefined

  let refused = ''
  const at = now.toISOString()
  const updated = await mutateJob(username, id, job => {
    if (job.status !== 'submitted') { refused = 'Track the pipeline once the application has been sent (Applied).'; return false }
    const current = pipelineOf(job)!
    const stage = (patch.stage as PipelineStage | undefined) ?? current.stage
    const next: ApplicationPipeline = { ...current, stage, updatedAt: at }
    if (stage !== current.stage) next.history = [...(current.history || []), { at, stage }].slice(-20)
    if (followUpAt === null) { delete next.followUpAt; delete next.remindedFor }
    else if (followUpAt !== undefined && followUpAt !== current.followUpAt) { next.followUpAt = followUpAt; delete next.remindedFor }
    if (notes !== undefined) next.notes = notes
    const changes = [
      stage !== current.stage ? `stage: ${stage}` : '',
      followUpAt === null && current.followUpAt ? 'follow-up cleared' : '',
      followUpAt && followUpAt !== current.followUpAt ? `follow up on ${followUpAt}` : '',
      notes !== undefined && notes !== (current.notes || '') ? 'notes updated' : '',
    ].filter(Boolean)
    job.pipeline = next
    job.updatedAt = at
    if (changes.length) job.log = [...(job.log || []), { at, msg: `Pipeline: ${changes.join(', ')}` }].slice(-50)
    return true
  })
  if (!updated) throw new Error(refused || 'Job not found')
  return updated
}

/**
 * Send one reminder per due follow-up. Marking the reminder and the check
 * happen in one write, so two server processes don't both send it.
 */
export async function sendFollowUpReminders(username: string, today = localDay(), notify = notifyJob): Promise<number> {
  let sent = 0
  for (const job of await listJobs(username)) {
    if (!followUpDue(job, today) || job.pipeline?.remindedFor === job.pipeline?.followUpAt) continue
    const marked = await mutateJob(username, job.id, current => {
      const p = current.pipeline
      if (!p?.followUpAt || !followUpDue(current, today) || p.remindedFor === p.followUpAt) return false
      current.pipeline = { ...p, remindedFor: p.followUpAt }
      return true
    })
    if (!marked) continue
    sent++
    void notify(username, job.id, {
      title: `Follow up: ${job.title}`,
      body: `${job.company}: ${marked.pipeline?.stage === 'applied' ? 'no reply recorded yet' : `stage ${marked.pipeline?.stage}`}. Check in, then update the stage in Job Hunter.`,
    })
  }
  if (sent) void auditLog({ level: 'info', event: 'job_followup_reminders', params: { username, sent } })
  return sent
}

const sched = ((globalThis as { __gfFollowUps?: { started: boolean } }).__gfFollowUps ??= { started: false })

/** Hourly check for due follow-ups, for every user (idempotent) */
export function startFollowUpReminders(intervalMs = 60 * 60_000): void {
  if (sched.started || process.env.NODE_ENV === 'test') return
  sched.started = true
  const tick = async () => {
    for (const username of await listJobUsers()) {
      try { await sendFollowUpReminders(username) } catch { /* one user's data must not stop the others */ }
    }
  }
  setTimeout(() => void tick(), 2 * 60_000).unref?.()
  setInterval(() => void tick(), intervalMs).unref?.()
}
