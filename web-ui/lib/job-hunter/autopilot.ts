/**
 * Job Hunter autopilot — fully automated searching and applying.
 *
 * Off until the user turns it on. Each run:
 *   1. searches every source with the user's preferences and chosen model
 *   2. prepares the best matches (tailored CV, cover letter, answers)
 *   3. submits eligible applications headlessly, up to the daily limit
 *
 * Eligible = High fit, score ≥ the user's minimum, and a site the user's mode
 * allows: "safe" = Lever, Greenhouse, Ashby; "full" = any site the form agent
 * can complete, plus LinkedIn Easy Apply when the user switched it on and
 * connected LinkedIn (its own, lower daily cap). Questions the agent can't
 * answer truthfully stop that application and are sent to the user; once
 * answered, the job is retried on the next run. Captchas and sign-in walls are
 * never bypassed. Nothing is submitted when required details are missing.
 *
 * Only one pass per user runs at a time, across the scheduler, "Run now" and
 * the CLI (an in-process set plus a lock file, see ./run-lock.ts), and the
 * daily limit, the on/off switch and the mode are re-read before every submit.
 * In "safe" mode Submit is pressed only while the form itself is on Lever,
 * Greenhouse or Ashby, wherever the listing's link led.
 */
import { auditLog } from '../audit'
import { AUTO_SUBMIT_ATS } from './apply'
import {
  approveJob, generatorFor, getProfile, listJobs, missingApplicantFields, prepareJob, runSearch, saveProfile,
} from './index'
import { acquireRunLock, type RunLock } from './run-lock'
import { listJobUsers, recoverAllInterruptedJobs, type AutopilotSettings } from './store'

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

// Keep two weeks of history
const last14 = (m: Record<string, number>) => Object.fromEntries(Object.keys(m).sort().slice(-14).map(k => [k, m[k]]))

async function record(username: string, now: number, result: string) {
  // Patch only the run-result fields, onto the CURRENT profile (saveProfile merges).
  // Otherwise a run that started minutes ago would write a stale `enabled`/`dailyLimit`
  // back over a change the user just made (e.g. they turned autopilot off mid-run).
  await saveProfile(username, { autopilot: { lastRunAt: new Date(now).toISOString(), lastResult: result } })
}

/**
 * Count one submitted application at once, not at the end of the pass, so the
 * daily limit check before the next submit (here or in any other process)
 * already sees it, and a pass cut off midway still counts what it sent.
 */
async function countSubmission(username: string, now: number, linkedin: boolean) {
  const today = dayKey(now)
  const current = (await getProfile(username)).autopilot
  const byDay = { ...(current.submittedByDay || {}) }
  byDay[today] = (byDay[today] || 0) + 1
  const liDay = { ...(current.linkedinByDay || {}) }
  if (linkedin) liDay[today] = (liDay[today] || 0) + 1
  await saveProfile(username, { autopilot: { submittedByDay: last14(byDay), linkedinByDay: last14(liDay) } })
}

// Users with a pass running in this process. On globalThis so a Next.js dev reload
// of this module doesn't forget a pass that is still running.
const runtime = globalThis as typeof globalThis & { ghostforgeAutopilotRuns?: Set<string> }
const activeRuns = runtime.ghostforgeAutopilotRuns ??= new Set<string>()

export const RUN_IN_PROGRESS = 'Another autopilot run is already in progress for this account (in GhostForge or from the command line). This one was not started, so the daily limit still holds.'

/** Is an autopilot pass for this user running in this process right now? */
export function autopilotRunning(username: string): boolean {
  return activeRuns.has(username)
}

/**
 * One autopilot pass for a user. `force` runs even when it isn't due (the
 * "Run now" button / CLI), but never while autopilot is off. `generate` and
 * `approve` are injectable for tests.
 */
export async function runAutopilot(
  username: string,
  opts: { force?: boolean; now?: number; generate?: Generate | null; approve?: Approve; linkedinGapMs?: number } = {},
): Promise<AutopilotReport> {
  const now = opts.now ?? Date.now()
  const offReason = opts.force ? 'Autopilot is off. Turn it on first: Run now submits applications only while autopilot is on.' : 'Autopilot is off'
  const atStart = (await getProfile(username)).autopilot

  // `force` skips only the schedule, never the on/off switch: a pass submits applications,
  // so "Run now" works only after the user turned autopilot on (and confirmed what it does).
  if (!atStart.enabled) return { ran: false, reason: offReason }
  if (!opts.force && !isDue(atStart, now)) return { ran: false, reason: 'Not due yet' }

  // One pass per user at a time: a second "Run now", the scheduler and the CLI each
  // computing the day's remaining submissions on their own could exceed the limit.
  // The in-process check is synchronous (no await between test and add).
  if (activeRuns.has(username)) return { ran: false, reason: RUN_IN_PROGRESS }
  activeRuns.add(username)
  let lock: RunLock | null = null
  try {
    lock = await acquireRunLock(username, now)
    if (!lock) return { ran: false, reason: RUN_IN_PROGRESS }
    return await lockedRun(lock)
  } finally {
    await lock?.release().catch(() => {})
    activeRuns.delete(username)
  }

  async function lockedRun(lock: RunLock): Promise<AutopilotReport> {
  // Read the profile again now that no other pass can run: one that just finished
  // has counted its submissions, and the user may have turned autopilot off meanwhile.
  const profile = await getProfile(username)
  const ap = profile.autopilot
  if (!ap.enabled) return { ran: false, reason: offReason }

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
    return { ran: false, reason }
  }

  async function runPass(): Promise<AutopilotReport> {
  const linkedinOn = ap.linkedinEasyApply && Boolean(profile.linkedin?.connectedAt)
  let linkedinLeft = linkedinOn ? Math.max(0, ap.linkedinDailyLimit - (ap.linkedinByDay?.[dayKey(now)] ?? 0)) : 0
  const search = await runSearch(username, { autoPrepare: Math.min(5, remaining + 2), generate, includeLinkedIn: linkedinOn })

  /** May autopilot press Submit on this site? */
  const canSubmit = (ats: string) => ats === 'linkedin' ? linkedinOn && ap.mode === 'full' : ap.mode === 'full' || AUTO_SUBMIT_ATS.has(ats)
  const eligible = (j: { fit: string; score: number; ats: string }) =>
    j.fit === 'High' && j.score >= ap.minScore && canSubmit(j.ats)

  // Prepare any remaining eligible matches the search didn't get to
  let prepared = search.prepared
  if (generate && remaining > 0) {
    const ready = (await listJobs(username)).filter(j => j.status === 'ready' && !j.preparationWarning && eligible(j)).length
    const toPrepare = (await listJobs(username))
      .filter(j => j.status === 'found' && eligible(j))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, remaining - ready))
    for (const j of toPrepare) {
      try { await prepareJob(username, j.id, generate); prepared++ } catch (e) {
        void auditLog({ level: 'warn', event: 'job_prepare_error', params: { username, jobId: j.id, error: String(e).slice(0, 200) } })
      }
    }
  }

  let submitted = 0, needsUser = 0, failed = 0, linkedinSent = 0
  let queueLen = 0
  let stoppedOff = false
  if (remaining > 0) {
    // "ready" includes jobs whose questions the user has since answered.
    const queue = (await listJobs(username))
      .filter(j => j.status === 'ready' && !j.preparationWarning && eligible(j))
      .sort((a, b) => b.score - a.score)
    queueLen = queue.length
    for (const j of queue) {
      // Re-check from a fresh profile right before each submit: the user may have
      // turned autopilot off or lowered the limit, and every submission so far
      // (this pass's and any other's) is already counted there.
      const fresh = (await getProfile(username)).autopilot
      if (!fresh.enabled) { stoppedOff = true; break }
      if (submittedToday(fresh, now) >= fresh.dailyLimit) break
      if (j.ats === 'linkedin') {
        linkedinLeft = linkedinOn ? Math.min(linkedinLeft, Math.max(0, fresh.linkedinDailyLimit - (fresh.linkedinByDay?.[dayKey(now)] ?? 0))) : 0
        if (linkedinLeft <= 0) continue
        // Space LinkedIn applications out instead of sending them back to back.
        if (linkedinSent > 0) await pause(opts.linkedinGapMs ?? 30_000)
      }
      await lock.refresh()
      try {
        const r = await approve(username, j.id, {
          headless: !ap.laptopControl, by: 'autopilot', allowSubmit: true,
          // "Safe sites": Submit only while the form itself is on Lever/Greenhouse/Ashby, not
          // wherever a listing's redirect or "Apply on company site" popup leads.
          ...(ap.mode === 'full' && fresh.mode === 'full' ? {} : { submitAts: [...AUTO_SUBMIT_ATS] }),
        })
        if (r.job.status === 'submitted') {
          submitted++
          if (j.ats === 'linkedin') { linkedinSent++; linkedinLeft-- }
          await countSubmission(username, now, j.ats === 'linkedin')
        } else if (r.job.status === 'needs_user') needsUser++
        else failed++
      } catch {
        failed++
      }
    }
  }

  // Explain the common "autopilot ran but applied to nothing" case.
  const reviewDrafts = (await listJobs(username)).filter(j => j.status === 'ready' && j.preparationWarning).length
  const hint = reviewDrafts > 0
    ? ` ${reviewDrafts} basic draft(s) need your approval because AI writing was unavailable.`
    : remaining > 0 && queueLen === 0 && submitted === 0
    ? ap.mode === 'safe'
      ? ' No matches on Lever/Greenhouse/Ashby — switch Autopilot to "Any site" or add company boards under Preferences → Companies.'
      : ' No new High-fit matches at your minimum score this time.'
    : ''
  const result = remaining === 0
    ? `Daily limit reached (${ap.dailyLimit}). Found ${search.found}, prepared ${prepared}.`
    : `Found ${search.found}, ${search.matched} in your locations. Prepared ${prepared}, submitted ${submitted}${linkedinSent ? ` (${linkedinSent} on LinkedIn)` : ''}${needsUser ? `, ${needsUser} need you` : ''}${failed ? `, ${failed} failed` : ''}.${stoppedOff ? ' Stopped: autopilot was turned off during the run.' : ''}${hint}`
  await record(username, now, result)
  void auditLog({ level: 'info', event: 'job_autopilot_run', params: { username, found: search.found, matched: search.matched, prepared, submitted, linkedin: linkedinSent, needsUser, failed, mode: ap.mode } })

  const after = (await getProfile(username)).autopilot
  return {
    ran: true, found: search.found, matched: search.matched, prepared, submitted, needsUser, failed,
    remainingToday: Math.max(0, after.dailyLimit - submittedToday(after, now)),
  }
  }
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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

/** Hand applications cut off by the last shutdown back to the user (never resubmitted). */
export async function recoverInterruptedOnStart(): Promise<number> {
  const recovered = await recoverAllInterruptedJobs()
  for (const { username, jobIds } of recovered) {
    void auditLog({ level: 'warn', event: 'job_application_interrupted', params: { username, jobIds } })
  }
  return recovered.reduce((n, r) => n + r.jobIds.length, 0)
}

/**
 * Started once per server process (instrumentation.ts). Recovers interrupted
 * applications first, then schedules autopilot. GF_JOB_AUTOPILOT=0 disables
 * the schedule only.
 */
export function startAutopilotScheduler(intervalMs = 10 * 60_000): void {
  if (started || process.env.NODE_ENV === 'test') return
  started = true
  void recoverInterruptedOnStart().catch(e => {
    void auditLog({ level: 'warn', event: 'job_recovery_error', params: { error: String(e).slice(0, 200) } })
  })
  if (process.env.GF_JOB_AUTOPILOT === '0') return
  setTimeout(() => void autopilotTick(), 60_000).unref?.()
  setInterval(() => void autopilotTick(), intervalMs).unref?.()
}
