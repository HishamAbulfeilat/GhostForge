/**
 * Job Hunter autopilot — fully automated searching and applying.
 *
 * Off until the user turns it on. Each run:
 *   1. searches every source with the user's preferences and chosen model
 *   2. prepares the best matches (tailored CV, cover letter, answers)
 *   3. submits eligible applications headlessly, up to the daily limit
 *
 * Eligible = High fit, score ≥ the user's minimum, and an ATS whose forms can
 * be completed unattended (Lever, Greenhouse, Ashby). LinkedIn, Workday and
 * unknown sites need a login, captcha or human, so those stay prepared in the
 * queue for the user. Nothing is submitted when required details are missing.
 */
import { auditLog } from '../audit'
import { AUTO_SUBMIT_ATS } from './apply'
import {
  approveJob, generatorFor, getProfile, listJobs, missingApplicantFields, prepareJob, runSearch, saveProfile,
} from './index'
import { listJobUsers, type AutopilotSettings } from './store'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>
type Approve = typeof approveJob

export interface AutopilotReport {
  ran: boolean
  reason?: string
  found?: number
  matched?: number
  prepared?: number
  submitted?: number
  needsUser?: number
  failed?: number
  remainingToday?: number
}

/** Local calendar day, YYYY-MM-DD */
export function dayKey(now = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isDue(ap: AutopilotSettings, now = Date.now()): boolean {
  if (!ap.enabled) return false
  if (!ap.lastRunAt) return true
  return now - Date.parse(ap.lastRunAt) >= Math.max(1, ap.intervalHours) * 3_600_000
}

export function submittedToday(ap: AutopilotSettings, now = Date.now()): number {
  return ap.submittedByDay?.[dayKey(now)] ?? 0
}

async function record(username: string, ap: AutopilotSettings, now: number, result: string, submitted = 0) {
  const today = dayKey(now)
  const byDay = { ...(ap.submittedByDay || {}) }
  if (submitted) byDay[today] = (byDay[today] || 0) + submitted
  // Keep two weeks of history
  const keep = Object.keys(byDay).sort().slice(-14)
  await saveProfile(username, {
    autopilot: { ...ap, lastRunAt: new Date(now).toISOString(), lastResult: result, submittedByDay: Object.fromEntries(keep.map(k => [k, byDay[k]])) },
  })
}

/**
 * One autopilot pass for a user. `force` runs even when it isn't due (the
 * "Run now" button / CLI). `generate` and `approve` are injectable for tests.
 */
export async function runAutopilot(
  username: string,
  opts: { force?: boolean; now?: number; generate?: Generate | null; approve?: Approve } = {},
): Promise<AutopilotReport> {
  const now = opts.now ?? Date.now()
  const profile = await getProfile(username)
  const ap = profile.autopilot

  if (!ap.enabled && !opts.force) return { ran: false, reason: 'Autopilot is off' }
  if (!opts.force && !isDue(ap, now)) return { ran: false, reason: 'Not due yet' }

  const missing = missingApplicantFields(profile)
  if (missing.length) {
    const reason = `Waiting for your ${missing.join(', ')}`
    await record(username, ap, now, reason)
    return { ran: false, reason }
  }
  if (!profile.preferences.titles.length) {
    const reason = 'Add at least one target role'
    await record(username, ap, now, reason)
    return { ran: false, reason }
  }

  const generate = opts.generate === undefined ? generatorFor(profile.model) : opts.generate
  const approve = opts.approve ?? approveJob
  const remaining = Math.max(0, ap.dailyLimit - submittedToday(ap, now))

  const search = await runSearch(username, { autoPrepare: Math.min(5, remaining + 2), generate })

  const eligible = (j: { fit: string; score: number; ats: string }) =>
    j.fit === 'High' && j.score >= ap.minScore && AUTO_SUBMIT_ATS.has(j.ats)

  // Prepare any remaining eligible matches the search didn't get to
  let prepared = search.prepared
  if (generate && remaining > 0) {
    const ready = (await listJobs(username)).filter(j => j.status === 'ready' && eligible(j)).length
    const toPrepare = (await listJobs(username))
      .filter(j => j.status === 'found' && eligible(j))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, remaining - ready))
    for (const j of toPrepare) {
      try { await prepareJob(username, j.id, generate); prepared++ } catch { /* stays found */ }
    }
  }

  let submitted = 0, needsUser = 0, failed = 0
  if (remaining > 0) {
    const queue = (await listJobs(username))
      .filter(j => j.status === 'ready' && eligible(j))
      .sort((a, b) => b.score - a.score)
      .slice(0, remaining)
    for (const j of queue) {
      try {
        const r = await approve(username, j.id, { headless: true, by: 'autopilot' })
        if (r.job.status === 'submitted') submitted++
        else if (r.job.status === 'needs_user') needsUser++
        else failed++
      } catch {
        failed++
      }
    }
  }

  const result = remaining === 0
    ? `Daily limit reached (${ap.dailyLimit}). Found ${search.found}, prepared ${prepared}.`
    : `Found ${search.found}, ${search.matched} in your locations. Prepared ${prepared}, submitted ${submitted}${needsUser ? `, ${needsUser} need you` : ''}${failed ? `, ${failed} failed` : ''}.`
  await record(username, ap, now, result, submitted)
  void auditLog({ level: 'info', event: 'job_autopilot_run', params: { username, found: search.found, matched: search.matched, prepared, submitted, needsUser, failed } })

  return {
    ran: true, found: search.found, matched: search.matched, prepared, submitted, needsUser, failed,
    remainingToday: Math.max(0, remaining - submitted),
  }
}

// ── scheduler ───────────────────────────────────────────────────────────────

let started = false
let running = false

async function allowed(username: string): Promise<boolean> {
  const { getUserByUsername } = await import('../users')
  const user = await getUserByUsername(username).catch(() => null)
  if (!user || !user.active) return false
  return user.role === 'admin' || user.permissions.includes('job_hunter')
}

/** One scheduler pass: run every user whose autopilot is on and due */
export async function autopilotTick(now = Date.now()): Promise<void> {
  if (running) return
  running = true
  try {
    for (const username of await listJobUsers()) {
      try {
        const { autopilot } = await getProfile(username)
        if (!isDue(autopilot, now) || !(await allowed(username))) continue
        await runAutopilot(username, { now })
      } catch (e) {
        void auditLog({ level: 'warn', event: 'job_autopilot_error', params: { username, error: String(e).slice(0, 200) } })
      }
    }
  } finally {
    running = false
  }
}

/** Started once per server process (instrumentation.ts). GF_JOB_AUTOPILOT=0 disables it. */
export function startAutopilotScheduler(intervalMs = 10 * 60_000): void {
  if (started || process.env.GF_JOB_AUTOPILOT === '0' || process.env.NODE_ENV === 'test') return
  started = true
  setTimeout(() => void autopilotTick(), 60_000).unref?.()
  setInterval(() => void autopilotTick(), intervalMs).unref?.()
}
