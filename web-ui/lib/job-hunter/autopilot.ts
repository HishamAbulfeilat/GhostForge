/**
 * Job Hunter autopilot — fully automated searching and applying.
 *
 * Off until the user turns it on. Each run:
 *   1. searches every source with the user's preferences and chosen model
 *   2. prepares the best matches (tailored CV, cover letter, answers)
 *   3. submits eligible applications headlessly, up to the daily limit
 *
 * Eligible = High fit, score ≥ the user's minimum, a site the user's mode
 * allows ("safe" = Lever, Greenhouse, Ashby, Workable, Recruitee; "full" = any
 * site the form agent can complete, plus LinkedIn Easy Apply when the user
 * switched it on and connected LinkedIn, with its own lower daily cap), and a
 * VERIFIED posting: never scam-flagged, never closed, and confirmed live within
 * the last day (verify.ts) — unverifiable listings are left for the user.
 *
 * Questions the agent can't answer truthfully stop that application and are
 * sent to the user; once answered, the job is retried on the next run. A job
 * that failed (site error, timeout) is retried once. A job left "submitting"
 * by a crash or restart is handed to the user, never resubmitted blindly.
 * Captchas and sign-in walls are never bypassed. Nothing is submitted when
 * required details are missing.
 */
import { auditLog } from '../audit'
import { AUTO_SUBMIT_ATS } from './apply'
import {
  approveJob, generatorFor, getProfile, listJobs, missingApplicantFields, prepareJob, recoverInterrupted, runSearch, saveProfile,
} from './index'
import { listJobUsers, type AutopilotSettings, type JobRecord } from './store'
import { ensureVerified, type Fetcher } from './verify'

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
  /** Matches left alone because the posting couldn't be verified as real and open */
  unverified?: number
  /** What went wrong this run (shown in the UI) */
  errors?: string[]
  remainingToday?: number
}

/** Retry a failed application at most this many attempts in total */
const MAX_ATTEMPTS = 2

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

async function record(username: string, now: number, result: string, submitted = 0, linkedin = 0) {
  const today = dayKey(now)
  // Re-read the CURRENT settings rather than an at-start snapshot, and patch only
  // the run-result fields. Otherwise a run that started minutes ago would write a
  // stale `enabled`/`dailyLimit` back over a change the user just made (e.g. they
  // turned autopilot off mid-run). saveProfile merges onto the fresh profile.
  const current = await getProfile(username)
  const byDay = { ...(current.autopilot.submittedByDay || {}) }
  if (submitted) byDay[today] = (byDay[today] || 0) + submitted
  const liDay = { ...(current.autopilot.linkedinByDay || {}) }
  if (linkedin) liDay[today] = (liDay[today] || 0) + linkedin
  // Keep two weeks of history
  const last14 = (m: Record<string, number>) => Object.fromEntries(Object.keys(m).sort().slice(-14).map(k => [k, m[k]]))
  await saveProfile(username, {
    autopilot: { lastRunAt: new Date(now).toISOString(), lastResult: result, submittedByDay: last14(byDay), linkedinByDay: last14(liDay) },
  })
}

/**
 * One autopilot pass for a user. `force` runs even when it isn't due (the
 * "Run now" button / CLI). `generate` and `approve` are injectable for tests.
 */
export async function runAutopilot(
  username: string,
  opts: { force?: boolean; now?: number; generate?: Generate | null; approve?: Approve; linkedinGapMs?: number; fetcher?: Fetcher } = {},
): Promise<AutopilotReport> {
  const now = opts.now ?? Date.now()
  const profile = await getProfile(username)
  const ap = profile.autopilot

  if (!ap.enabled && !opts.force) return { ran: false, reason: 'Autopilot is off' }
  if (!opts.force && !isDue(ap, now)) return { ran: false, reason: 'Not due yet' }

  const missing = missingApplicantFields(profile)
  if (missing.length) {
    const reason = `Waiting for your ${missing.join(', ')}`
    await record(username, now, reason)
    return { ran: false, reason }
  }
  if (!profile.preferences.titles.length) {
    const reason = 'Add at least one target role'
    await record(username, now, reason)
    return { ran: false, reason }
  }

  const generate = opts.generate === undefined ? generatorFor(profile.model) : opts.generate
  const approve = opts.approve ?? approveJob
  const remaining = Math.max(0, ap.dailyLimit - submittedToday(ap, now))

  try {
    return await runPass()
  } catch (e) {
    // A thrown search/prepare/approve must still be recorded, or lastRunAt never
    // advances and the scheduler retries every 10 minutes forever.
    const reason = `Autopilot run failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 150)}`
    await record(username, now, reason)
    void auditLog({ level: 'warn', event: 'job_autopilot_error', params: { username, error: reason } })
    void notifyUser(username, { title: 'Job Hunter autopilot failed', body: reason.slice(0, 140) })
    return { ran: false, reason }
  }

  async function runPass(): Promise<AutopilotReport> {
  const errors: string[] = []
  const recovered = await recoverInterrupted(username, now)
  const linkedinOn = ap.linkedinEasyApply && Boolean(profile.linkedin?.connectedAt)
  let linkedinLeft = linkedinOn ? Math.max(0, ap.linkedinDailyLimit - (ap.linkedinByDay?.[dayKey(now)] ?? 0)) : 0
  const search = await runSearch(username, { autoPrepare: Math.min(5, remaining + 2), generate, includeLinkedIn: linkedinOn, fetcher: opts.fetcher })
  const sourceErrors = search.report.filter(r => r.error)
  if (sourceErrors.length && sourceErrors.length === search.report.length) errors.push(`every job source failed (${sourceErrors[0].error})`)

  /** May autopilot press Submit on this site? */
  const canSubmit = (ats: string) => ats === 'linkedin' ? linkedinOn && ap.mode === 'full' : ap.mode === 'full' || AUTO_SUBMIT_ATS.has(ats)
  const eligible = (j: JobRecord) =>
    j.fit === 'High' && j.score >= ap.minScore && canSubmit(j.ats)
    && j.verification?.status !== 'flagged' && j.verification?.status !== 'closed'
  let unverified = 0
  /** Live-check a job right before working on it; true when it is a verified, open posting */
  const verified = async (j: JobRecord) => {
    const v = await ensureVerified(username, j.id, { fetcher: opts.fetcher, now }).catch(() => null)
    if (v?.verification?.status === 'verified') return true
    unverified++
    return false
  }

  // Prepare any remaining eligible matches the search didn't get to
  let prepared = search.prepared
  if (generate && remaining > 0) {
    const jobs = await listJobs(username)
    let wanted = Math.max(0, remaining - jobs.filter(j => j.status === 'ready' && eligible(j)).length)
    const candidates = jobs.filter(j => j.status === 'found' && eligible(j)).sort((a, b) => b.score - a.score)
    for (const j of candidates) {
      if (wanted <= 0) break
      if (!(await verified(j))) continue
      try { await prepareJob(username, j.id, generate, { fetcher: opts.fetcher }); prepared++; wanted-- } catch (e) {
        errors.push(`preparing ${j.title} at ${j.company}: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`)
      }
    }
  }

  let submitted = 0, needsUser = 0, failed = 0, linkedinSent = 0
  let queueLen = 0
  if (remaining > 0) {
    // "ready" includes jobs whose questions the user has since answered;
    // a failed attempt (site error, timeout) gets one more try.
    const queue = (await listJobs(username))
      .filter(j => eligible(j) && (j.status === 'ready' || (j.status === 'failed' && Boolean(j.tailoredResume) && (j.attempts || 0) < MAX_ATTEMPTS)))
      .sort((a, b) => Number(a.status === 'failed') - Number(b.status === 'failed') || b.score - a.score)
    queueLen = queue.length
    let budget = remaining
    for (const j of queue) {
      if (budget <= 0) break
      if (j.ats === 'linkedin' && linkedinLeft <= 0) continue
      if (!(await verified(j))) continue
      // Space LinkedIn applications out instead of sending them back to back.
      if (j.ats === 'linkedin' && linkedinSent > 0) await pause(opts.linkedinGapMs ?? 30_000)
      try {
        const r = await approve(username, j.id, { headless: !ap.laptopControl, by: 'autopilot', allowSubmit: true })
        if (r.job.status === 'submitted') {
          submitted++; budget--
          if (j.ats === 'linkedin') { linkedinSent++; linkedinLeft-- }
        } else if (r.job.status === 'needs_user') needsUser++
        else { failed++; errors.push(`${j.title} at ${j.company}: ${r.message.slice(0, 100)}`) }
      } catch (e) {
        failed++
        errors.push(`${j.title} at ${j.company}: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`)
      }
    }
  }

  // Explain the common "autopilot ran but applied to nothing" case.
  const hint = remaining > 0 && queueLen === 0 && submitted === 0
    ? ap.mode === 'safe'
      ? ' No matches on Lever/Greenhouse/Ashby/Workable/Recruitee — switch Autopilot to "Any site" or add company boards under Preferences → Companies.'
      : ' No new High-fit matches at your minimum score this time.'
    : ''
  const extra = `${unverified ? ` ${unverified} skipped: couldn't verify the posting is real and open.` : ''}${recovered ? ` ${recovered} interrupted application(s) need you.` : ''}${errors.length ? ` Problem: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}.` : ''}`
  const result = remaining === 0
    ? `Daily limit reached (${ap.dailyLimit}). Found ${search.found}, prepared ${prepared}.${extra}`
    : `Found ${search.found}, ${search.matched} in your locations. Prepared ${prepared}, submitted ${submitted}${linkedinSent ? ` (${linkedinSent} on LinkedIn)` : ''}${needsUser ? `, ${needsUser} need you` : ''}${failed ? `, ${failed} failed` : ''}.${hint}${extra}`
  await record(username, now, result, submitted, linkedinSent)
  void auditLog({ level: errors.length ? 'warn' : 'info', event: 'job_autopilot_run', params: { username, found: search.found, matched: search.matched, prepared, submitted, linkedin: linkedinSent, needsUser, failed, unverified, errors: errors.slice(0, 5), mode: ap.mode } })

  return {
    ran: true, found: search.found, matched: search.matched, prepared, submitted, needsUser, failed, unverified, errors,
    remainingToday: Math.max(0, remaining - submitted),
  }
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Push notification when configured (never throws) */
async function notifyUser(username: string, payload: { title: string; body: string }) {
  try {
    const { sendToUser } = await import('../push')
    await sendToUser(username, { ...payload, tag: 'job-hunter', url: '/jobs' })
  } catch { /* push not configured */ }
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
        // Applications cut off by a restart are handed back even when no run is due
        await recoverInterrupted(username, now)
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

/**
 * Started once per server process (instrumentation.ts, and lazily by the Job
 * Hunter API in case instrumentation didn't run). The schedule lives in each
 * user's profile (lastRunAt), so it carries on after a restart.
 * GF_JOB_AUTOPILOT=0 disables it.
 */
export function startAutopilotScheduler(intervalMs = 10 * 60_000): void {
  if (started || process.env.GF_JOB_AUTOPILOT === '0' || process.env.NODE_ENV === 'test') return
  started = true
  setTimeout(() => void autopilotTick(), 60_000).unref?.()
  setInterval(() => void autopilotTick(), intervalMs).unref?.()
}
