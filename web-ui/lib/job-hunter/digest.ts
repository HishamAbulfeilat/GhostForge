/**
 * Saved searches and the new-jobs digest.
 *
 * For people who never auto-apply: on a schedule, each enabled saved search
 * (or the main search when none is saved) is run and scored, and the new
 * High-fit jobs are announced once, in one push notification plus an in-app
 * list on /jobs. A digest only searches and scores. It never prepares,
 * approves or submits anything, and it runs whether autopilot is on or off.
 *
 * Email is not sent: GhostForge has no email channel. Push needs VAPID keys
 * and a subscribed device; without them the digest is still shown in the app.
 */
import { auditLog } from '../audit'
import { generatorFor, getProfile, listJobs, runSearch, saveProfile } from './index'
import { notifyJob } from './notifications'
import { parseCompany } from './sources'
import type { DigestSettings, JobRecord, SavedSearch } from './store'
import type { Fetcher } from './verify'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

export const MAX_SAVED_SEARCHES = 10
/** Keys remembered as already announced (oldest forgotten first) */
const MAX_SENT_KEYS = 2000

export interface DigestReport {
  ran: boolean
  reason?: string
  searches?: number
  newJobs?: DigestEntry[]
  notification?: 'sent' | 'unavailable' | 'failed' | 'none'
  errors?: string[]
}

type DigestEntry = NonNullable<DigestSettings['lastDigest']>['jobs'][number]

export function isDigestDue(d: DigestSettings | undefined, now = Date.now()): boolean {
  if (!d?.enabled) return false
  if (!d.lastRunAt) return true
  return now - Date.parse(d.lastRunAt) >= Math.max(1, d.intervalHours) * 3_600_000
}

/** Worth announcing: a High-fit, open, unhandled listing at or above the digest's minimum score */
export function digestWorthy(job: JobRecord, minScore: number): boolean {
  return job.fit === 'High' && job.score >= minScore
    && (job.status === 'found' || job.status === 'ready')
    && job.verification?.status !== 'flagged' && job.verification?.status !== 'closed'
}

// One digest per user at a time, across every copy of this module
const running: Set<string> = ((globalThis as { __gfJobDigest?: Set<string> }).__gfJobDigest ??= new Set())

/**
 * Run the saved searches and announce new High-fit jobs. `force` runs even when
 * not due or switched off ("Send digest now"). `generate` is injectable for tests.
 */
export async function runDigest(
  username: string,
  opts: { force?: boolean; now?: number; generate?: Generate | null; fetcher?: Fetcher } = {},
): Promise<DigestReport> {
  const now = opts.now ?? Date.now()
  const profile = await getProfile(username)
  const settings = profile.digest!
  if (!settings.enabled && !opts.force) return { ran: false, reason: 'The digest is off' }
  if (!opts.force && !isDigestDue(settings, now)) return { ran: false, reason: 'Not due yet' }
  if (!profile.cv) return finish({ ran: false, reason: 'Upload your CV first' })

  const saved = (profile.savedSearches || []).filter(s => s.enabled && s.titles.length)
  const searches: SavedSearch[] = saved.length ? saved : profile.preferences.titles.length
    ? [{ id: 'main', name: 'Your search', titles: profile.preferences.titles, locations: profile.preferences.locations, remote: profile.preferences.remote, companies: profile.preferences.companies, enabled: true }]
    : []
  if (!searches.length) return finish({ ran: false, reason: 'Save a search or add a target role first' })

  if (running.has(username)) return { ran: false, reason: 'A digest is already running' }
  running.add(username)
  try {
    const generate = opts.generate === undefined ? generatorFor(profile.model) : opts.generate
    const errors: string[] = []
    const foundBy = new Map<string, string>()
    for (const s of searches) {
      try {
        const r = await runSearch(username, {
          terms: s.titles, autoPrepare: 0, generate, fetcher: opts.fetcher,
          preferences: { titles: s.titles, locations: s.locations, remote: s.remote, companies: s.companies },
        })
        for (const key of r.keys) if (!foundBy.has(key)) foundBy.set(key, s.name)
        const failing = r.report.filter(x => x.error)
        if (failing.length && failing.length === r.report.length) errors.push(`${s.name}: every job source failed`)
      } catch (e) {
        errors.push(`${s.name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
      }
    }

    const sent = new Set(settings.sentKeys || [])
    const fresh = (await listJobs(username))
      .filter(j => foundBy.has(j.key) && !sent.has(j.key) && digestWorthy(j, settings.minScore))
      .sort((a, b) => b.score - a.score)
    const entries: DigestEntry[] = fresh.slice(0, 20).map(j => ({ id: j.id, title: j.title, company: j.company, score: j.score, search: foundBy.get(j.key) || '' }))

    let notification: DigestReport['notification'] = 'none'
    if (fresh.length) {
      const top = entries.slice(0, 3).map(e => `${e.title} at ${e.company} (${e.score})`).join('; ')
      notification = await notifyJob(username, 'digest', {
        title: `${fresh.length} new High-fit job${fresh.length === 1 ? '' : 's'}`,
        body: `${top}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ''}`.slice(0, 180),
      })
    }
    const result = `${searches.length} search${searches.length === 1 ? '' : 'es'} checked: ${fresh.length ? `${fresh.length} new High-fit job${fresh.length === 1 ? '' : 's'}` : 'no new High-fit jobs'}.${errors.length ? ` Problem: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}.` : ''}${fresh.length && notification !== 'sent' ? ' Phone push is not available; see the list on /jobs.' : ''}`
    await saveProfile(username, {
      digest: {
        lastRunAt: new Date(now).toISOString(), lastResult: result,
        ...(fresh.length ? { lastDigest: { at: new Date(now).toISOString(), jobs: entries }, sentKeys: [...(settings.sentKeys || []), ...fresh.map(j => j.key)].slice(-MAX_SENT_KEYS) } : {}),
      },
    })
    void auditLog({ level: errors.length ? 'warn' : 'info', event: 'job_digest_run', params: { username, searches: searches.length, newJobs: fresh.length, notification, errors: errors.slice(0, 5) } })
    return { ran: true, searches: searches.length, newJobs: entries, notification, errors }
  } finally {
    running.delete(username)
  }

  async function finish(report: DigestReport): Promise<DigestReport> {
    // Record the reason, and advance lastRunAt so the scheduler doesn't retry every tick
    await saveProfile(username, { digest: { lastRunAt: new Date(now).toISOString(), lastResult: report.reason } })
    return report
  }
}

/** Clean a saved-search list from the API: bounded, trimmed, unique ids */
export function cleanSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return []
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
    .map(x => String(x).trim()).filter(Boolean).slice(0, max).map(x => x.slice(0, 120))
  const ids = new Set<string>()
  const out: SavedSearch[] = []
  for (const raw of value.slice(0, MAX_SAVED_SEARCHES)) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const titles = list(s.titles, 5)
    if (!titles.length) continue
    let id = String(s.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!id || ids.has(id)) id = `s${Math.random().toString(36).slice(2, 10)}`
    ids.add(id)
    const remote = ['remote', 'hybrid', 'onsite', 'any'].includes(String(s.remote)) ? s.remote as SavedSearch['remote'] : 'any'
    out.push({
      id, name: String(s.name || '').trim().slice(0, 80) || titles.join(', ').slice(0, 80),
      titles, locations: list(s.locations, 10), remote,
      companies: list(s.companies, 20).map(c => c.toLowerCase().replace(/\s+/g, '')).filter(c => parseCompany(c).length > 0),
      enabled: s.enabled !== false,
    })
  }
  return out
}
