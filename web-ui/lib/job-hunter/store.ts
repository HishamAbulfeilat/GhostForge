/**
 * Job Hunter storage — one folder per GhostForge user:
 *
 *   ~/.ghostforge/jobs/<username>/profile.json   CV text, applicant data, preferences
 *   ~/.ghostforge/jobs/<username>/jobs.db        discovered jobs + application state (SQLite, see job-db.ts;
 *                                                jobs.json on a Node without node:sqlite)
 *   ~/.ghostforge/jobs/<username>/cv/<file>      the original uploaded CV (used for uploads)
 */
import { mkdir, readFile, writeFile, rename } from 'fs/promises'
import { homedir } from 'os'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { acquireOperation, closeJobDbs, jobStoreBackend, openJobDb, transaction, type JobDb } from './job-db'

/**
 * Per-key async mutex. Read-modify-write of a user's JSON files must not
 * interleave (autopilot runs for minutes while the UI polls/writes), or updates
 * are lost. Callers serialize on the user's directory.
 */
// Kept on globalThis: Next.js can load this module more than once (instrumentation
// and route bundles), and two lock maps would not exclude each other.
const locks: Map<string, Promise<unknown>> = ((globalThis as { __gfJobLocks?: Map<string, Promise<unknown>> }).__gfJobLocks ??= new Map())
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(key, next.catch(() => {}))
  return next
}

const activeOperations: Set<string> = ((globalThis as { __gfJobOps?: Set<string> }).__gfJobOps ??= new Set())
const BUSY = 'An operation on this application is already running. Wait for it to finish before retrying.'

/**
 * Prevent Prepare/Approve/Answer/Dismiss from racing on the same application,
 * in this process and (with jobs.db) in any other server process on the same
 * data: the second one is refused, not queued.
 */
export async function withJobOperation<T>(username: string, id: string, run: () => Promise<T>): Promise<T> {
  const key = `${userDir(username)}/${id}`
  if (activeOperations.has(key)) throw new Error(BUSY)
  activeOperations.add(key)
  try {
    const db = jobDb(username)
    const release = db ? acquireOperation(db, String(id), randomUUID()) : () => {}
    if (!release) throw new Error(BUSY)
    try { return await run() } finally { release() }
  } finally { activeOperations.delete(key) }
}

export type RemotePreference = 'remote' | 'hybrid' | 'onsite' | 'any'
export type Fit = 'High' | 'Medium' | 'Low' | 'Skip'
export type JobStatus =
  | 'found'        // discovered and scored
  | 'ready'        // tailored CV, cover letter and answers prepared — waiting for approval
  | 'submitting'   // approved; the browser is filling the form
  | 'submitted'    // form submitted by the agent
  | 'needs_user'   // form opened and pre-filled, but a human must finish (login, captcha, LinkedIn, unknown fields)
  | 'failed'
  | 'dismissed'

export type Ats =
  | 'lever' | 'greenhouse' | 'ashby' | 'workday' | 'workable' | 'smartrecruiters' | 'recruitee'
  | 'icims' | 'taleo' | 'bamboohr' | 'teamtailor' | 'linkedin' | 'other'

/**
 * How much a listing's origin can be trusted:
 *   official   the company's own applicant-tracking system API (Greenhouse, Lever, Ashby…)
 *   board      a curated job board or licensed aggregator (Remotive, Adzuna, JSearch…)
 *   community  user-posted (Hacker News "Who is hiring")
 *   link       pasted by the user
 */
export type Trust = 'official' | 'board' | 'community' | 'link'

/**
 * Whether a listing is believed to be a real, open job:
 *   verified    from an official ATS API, or its page was checked and is live
 *   unverified  not checked yet, or the check couldn't tell (bot wall, timeout)
 *   flagged     scam signals (fees, Telegram-only contact, crypto pay…)
 *   closed      the posting is gone (404/410, "no longer accepting applications")
 */
export type VerifyStatus = 'verified' | 'unverified' | 'flagged' | 'closed'

export interface Verification {
  status: VerifyStatus
  /** Human-readable reasons (scam signals, check results) */
  flags: string[]
  /** When the live check (or the official API read) last confirmed it */
  checkedAt?: string
  live?: 'live' | 'gone' | 'unknown'
}

export interface ApplicantData {
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  country: string
  linkedin: string
  github: string
  portfolio: string
  workAuthorized: 'yes' | 'no' | ''
  needsSponsorship: 'yes' | 'no' | ''
  howHeard: string
}

export interface JobPreferences {
  titles: string[]
  locations: string[]
  remote: RemotePreference
  minSalary: number | null
  mustHaves: string[]
  niceToHaves: string[]
  dealbreakers: string[]
  /**
   * Companies whose own job boards are read directly: a slug tried on every
   * supported ATS ("stripe"), or pinned to one ("ashby:openai", "workable:acme").
   */
  companies: string[]
  /** Hide postings older than this many days (when the source gives a date). Default 30. */
  maxAgeDays?: number
}

/** The AI model Job Hunter uses; null follows the model selected in Settings */
export interface ModelChoice { provider: string; model: string }

export interface AutopilotSettings {
  /** Search and apply on a schedule without asking (off until the user turns it on) */
  enabled: boolean
  /** Hours between runs */
  intervalHours: number
  /** Most applications autopilot may submit per calendar day */
  dailyLimit: number
  /** Only jobs scored at least this high (and rated High fit) are submitted */
  minScore: number
  /**
   * "safe": submit only on Lever/Greenhouse/Ashby (single-page, predictable forms).
   * "full": submit on any site the form agent can complete — company career
   * sites, Workday (when already signed in), LinkedIn Easy Apply (if enabled).
   */
  mode: 'safe' | 'full'
  /** Apply through LinkedIn Easy Apply with the user's own signed-in LinkedIn (opt-in) */
  linkedinEasyApply: boolean
  /** Separate, lower cap for LinkedIn */
  linkedinDailyLimit: number
  /**
   * Allow GhostForge to use this computer when an application gets stuck:
   * a visible browser on this computer plus screenshot-based "computer use".
   * Off = everything runs in the background without a screen.
   */
  laptopControl: boolean
  lastRunAt?: string
  lastResult?: string
  /** Submissions per day, e.g. { "2026-09-28": 3 } (last 14 days kept) */
  submittedByDay?: Record<string, number>
  /** LinkedIn submissions per day */
  linkedinByDay?: Record<string, number>
}

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  enabled: false, intervalHours: 12, dailyLimit: 5, minScore: 75,
  mode: 'safe', linkedinEasyApply: false, linkedinDailyLimit: 5, laptopControl: false,
}

export interface CvFile { text: string; fileName: string; filePath: string; uploadedAt: string }

export interface CvReview {
  /** 0-100 overall quality (clarity, impact, ATS-readiness) */
  score: number
  summary: string
  strengths: string[]
  issues: string[]
  suggestions: string[]
}

export interface ImprovedCv { text: string; review: CvReview; createdAt: string }

export interface GithubProfileDraft {
  username: string
  readme: string
  bio: string
  location: string
  blog: string
  company: string
  updatedAt: string
  publishedAt?: string
}

export interface GithubDesign {
  style: string
  name: string
  /** Why this design suits the person (set on the recommended one) */
  why: string
  recommended: boolean
  readme: string
}

export interface JobProfile {
  cv: CvFile | null
  githubProfile?: GithubProfileDraft | null
  /** The latest set of generated profile designs to choose from */
  githubDesigns?: GithubDesign[] | null
  /** Latest AI review + rewrite (not used until adopted) */
  improvedCv?: ImprovedCv | null
  /** The user's own CV, kept when an improved version is adopted */
  originalCv?: CvFile | null
  applicant: ApplicantData
  preferences: JobPreferences
  /** Answers the user approved for unusual questions, reused on later forms */
  customAnswers: Record<string, string>
  model: ModelChoice | null
  autopilot: AutopilotSettings
  /** Set once the user signed in to LinkedIn in the GhostForge browser */
  linkedin?: { connectedAt?: string; checkedAt?: string } | null
  updatedAt: string
}

export interface FieldAnswer { label: string; value: string }

/** Stages after an application was sent. Entered by hand; mailboxes are never read. */
export type PipelineStage = 'applied' | 'screening' | 'interview' | 'offer' | 'rejected'
export interface ApplicationPipeline {
  stage: PipelineStage
  /** Day to follow up (YYYY-MM-DD); a reminder is sent on that day */
  followUpAt?: string
  notes?: string
  /** The follow-up day a reminder was already sent for */
  remindedFor?: string
  history?: Array<{ at: string; stage: PipelineStage }>
  updatedAt?: string
}

export interface JobRecord {
  id: string
  /** Stable identity used to de-duplicate across searches */
  key: string
  source: string
  title: string
  company: string
  location: string
  remote: boolean
  salary: string
  url: string
  applyUrl: string
  ats: Ats
  description: string
  postedAt: string
  trust?: Trust
  verification?: Verification
  /** Application attempts so far (autopilot retries a failed one once) */
  attempts?: number
  /** When Submit was last pressed on this job's form: it may have been sent, so autopilot never retries it */
  submitPressedAt?: string
  /** Found by probing a plain company name on an ATS (not pinned as "ats:slug"): may be another company with the same board name */
  boardUnconfirmed?: boolean
  fit: Fit
  score: number
  reasons: string
  /** Fingerprint of the CV, preferences, model and listing the AI score was given for: unchanged means no re-scoring */
  scoreSig?: string
  status: JobStatus
  activity?: import('./live').ApplicationActivity
  tailoredResume?: string
  /** Non-AI drafts require the user's explicit approval, never autopilot. */
  preparationWarning?: string
  coverLetter?: string
  answers?: FieldAnswer[]
  /** Required questions the agent could not answer truthfully; the user answers them once */
  questions?: Array<{ label: string; type: string; options: string[] }>
  /** Answers the AI wrote on the last attempt (shown for transparency) */
  aiAnswers?: FieldAnswer[]
  /** What happened after applying, entered by the user (see pipeline.ts) */
  pipeline?: ApplicationPipeline
  log: Array<{ at: string; msg: string }>
  createdAt: string
  updatedAt: string
}

const EMPTY_APPLICANT: ApplicantData = {
  firstName: '', lastName: '', email: '', phone: '', city: '', country: '',
  linkedin: '', github: '', portfolio: '', workAuthorized: '', needsSponsorship: '', howHeard: 'Job board',
}

const EMPTY_PREFERENCES: JobPreferences = {
  titles: [], locations: [], remote: 'any', minSalary: null,
  mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [], maxAgeDays: 30,
}

function safeUser(username: string): string {
  const u = String(username || '').toLowerCase().replace(/[^a-z0-9._-]/g, '')
  // A leading dot would allow "." / ".." — i.e. escaping the per-user folder
  if (!u || u.startsWith('.')) throw new Error('Invalid username')
  return u
}

/** Every user that has Job Hunter data (for the autopilot scheduler) */
export async function listJobUsers(): Promise<string[]> {
  const { readdir } = await import('fs/promises')
  try {
    return (await readdir(join(homedir(), '.ghostforge', 'jobs'), { withFileTypes: true }))
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
  } catch {
    return []
  }
}

export function userDir(username: string): string {
  return join(homedir(), '.ghostforge', 'jobs', safeUser(username))
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  // Write to a temp file then rename: rename is atomic, so a concurrent reader
  // never sees a half-written (truncated) file that would parse as empty.
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)
}

// ── profile ──────────────────────────────────────────────────────────────────

export async function getProfile(username: string): Promise<JobProfile> {
  const stored = await readJson<Partial<JobProfile>>(join(userDir(username), 'profile.json'), {})
  return {
    cv: stored.cv ?? null,
    improvedCv: stored.improvedCv ?? null,
    githubProfile: stored.githubProfile ?? null,
    githubDesigns: stored.githubDesigns ?? null,
    originalCv: stored.originalCv ?? null,
    applicant: { ...EMPTY_APPLICANT, ...(stored.applicant || {}) },
    preferences: { ...EMPTY_PREFERENCES, ...(stored.preferences || {}) },
    customAnswers: stored.customAnswers || {},
    model: stored.model?.provider && stored.model?.model ? stored.model : null,
    autopilot: { ...DEFAULT_AUTOPILOT, ...(stored.autopilot || {}) },
    linkedin: stored.linkedin ?? null,
    updatedAt: stored.updatedAt || '',
  }
}

export function saveProfile(
  username: string,
  patch: Partial<Omit<JobProfile, 'updatedAt' | 'autopilot'>> & { autopilot?: Partial<AutopilotSettings> },
): Promise<JobProfile> {
  return withLock(userDir(username), async () => {
  const current = await getProfile(username)
  const next: JobProfile = {
    ...current,
    ...patch,
    applicant: { ...current.applicant, ...(patch.applicant || {}) },
    preferences: { ...current.preferences, ...(patch.preferences || {}) },
    customAnswers: { ...current.customAnswers, ...(patch.customAnswers || {}) },
    model: patch.model !== undefined ? patch.model : current.model,
    autopilot: { ...current.autopilot, ...(patch.autopilot || {}) },
    updatedAt: new Date().toISOString(),
  }
  await writeJson(join(userDir(username), 'profile.json'), next)
  return next
  })
}

/** Persist the original CV file so application forms can upload it */
export async function saveCvFile(username: string, fileName: string, data: Buffer): Promise<string> {
  const clean = basename(fileName).replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'cv'
  const dir = join(userDir(username), 'cv')
  await mkdir(dir, { recursive: true })
  const path = join(dir, clean)
  await writeFile(path, data)
  return path
}

// ── jobs ─────────────────────────────────────────────────────────────────────
//
// Jobs live in jobs.db (SQLite, one row per job; see job-db.ts). Without
// node:sqlite they fall back to the old whole-file jobs.json under the
// process-local lock.

function jobRow(job: Record<string, unknown>) {
  const j = job as unknown as JobRecord
  return {
    id: String(j.id), key: String(j.key ?? ''), loose: dedupeKey(j), source: String(j.source ?? ''),
    status: String(j.status ?? 'found'), updatedAt: String(j.updatedAt ?? ''),
  }
}

/** The user's jobs database, or null for the jobs.json fallback */
function jobDb(username: string): JobDb | null {
  return openJobDb(userDir(username), jobRow)
}

function parseJob(row: Record<string, unknown> | undefined): JobRecord | null {
  return row ? JSON.parse(String(row.data)) as JobRecord : null
}

function writeRow(db: JobDb, job: JobRecord, insert = false): void {
  const r = jobRow(job as unknown as Record<string, unknown>)
  const data = JSON.stringify(job)
  if (insert) db.prepare('INSERT INTO jobs (id, key, loose, source, status, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.id, r.key, r.loose, r.source, r.status, r.updatedAt, data)
  else db.prepare('UPDATE jobs SET key = ?, loose = ?, source = ?, status = ?, updated_at = ?, data = ? WHERE id = ?').run(r.key, r.loose, r.source, r.status, r.updatedAt, data, r.id)
}

const jobsJson = (username: string) => join(userDir(username), 'jobs.json')

export async function listJobs(username: string): Promise<JobRecord[]> {
  const db = jobDb(username)
  if (!db) return readJson<JobRecord[]>(jobsJson(username), [])
  return db.prepare('SELECT data FROM jobs ORDER BY seq').all().map(r => parseJob(r)!)
}

async function saveJobs(username: string, jobs: JobRecord[]): Promise<void> {
  await writeJson(jobsJson(username), jobs)
}

export async function getJob(username: string, id: string): Promise<JobRecord | null> {
  const db = jobDb(username)
  if (!db) return (await listJobs(username)).find(j => j.id === id) || null
  return parseJob(db.prepare('SELECT data FROM jobs WHERE id = ?').get(String(id)))
}

/** Which storage the jobs use: 'sqlite' (jobs.db) or 'json' (legacy jobs.json) */
export function jobStorage(): 'sqlite' | 'json' {
  return jobStoreBackend()
}

/** Close open job databases (tests and shutdown); they reopen on next use */
export function closeJobStores(): void {
  closeJobDbs()
}

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|bv|nv|plc|corp|corporation|co|company|kk|pty|srl|ab|as|oy|group|holdings?|technologies|labs?)\b/g

/**
 * Looser identity for spotting one job listed on several boards: case,
 * punctuation, company suffixes ("Inc", "GmbH") and remote/location spelling
 * don't matter.
 */
export function dedupeKey(job: Pick<JobRecord, 'company' | 'title' | 'location'>): string {
  const n = (s: string) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  const company = n(job.company).replace(COMPANY_SUFFIX, ' ').replace(/\s+/g, ' ').trim()
  const title = n(job.title).replace(/\b(sr)\b/g, 'senior').replace(/\b(jr)\b/g, 'junior').replace(/\s+/g, ' ').trim()
  // City plus region ("New York, NY" ≠ "New Delhi, India"); remote wording ignored
  const loc = String(job.location || '').split(/[,/|;(]/).slice(0, 2).map(n).join(' ')
    .replace(/\b(remote|worldwide|anywhere|global|fully|hybrid|onsite|on site|100)\b/g, ' ').replace(/\s+/g, ' ').trim()
  return `${company}|${title}|${loc}`
}

/** Merge newly found jobs, keeping state for ones we've already seen */
export async function upsertJobs(
  username: string,
  found: Array<Omit<JobRecord, 'id' | 'status' | 'log' | 'createdAt' | 'updatedAt'>>,
): Promise<{ added: number; jobs: JobRecord[] }> {
  const db = jobDb(username)
  if (db) {
    const byKey = db.prepare('SELECT data FROM jobs WHERE key = ? ORDER BY seq DESC LIMIT 1')
    const byLoose = db.prepare('SELECT data FROM jobs WHERE loose = ? ORDER BY seq DESC LIMIT 1')
    const added = transaction(db, () => {
      let n = 0
      for (const f of found) {
        const now = new Date().toISOString()
        const loose = parseJob(byLoose.get(dedupeKey(f)))
        const existing = parseJob(byKey.get(f.key)) || (loose && loose.source !== f.source ? loose : null)
        if (existing) {
          if (existing.key !== f.key) continue
          writeRow(db, mergeFound(existing, f, now))
          continue
        }
        writeRow(db, newRecord(f, now), true)
        n++
      }
      return n
    })
    return { added, jobs: await listJobs(username) }
  }
  return withLock(userDir(username), async () => {
  const jobs = await listJobs(username)
  const byKey = new Map(jobs.map(j => [j.key, j]))
  // The same job found again on another board (different source key) is the same job
  const byLoose = new Map(jobs.map(j => [dedupeKey(j), j]))
  const now = new Date().toISOString()
  let added = 0
  for (const f of found) {
    const loose = byLoose.get(dedupeKey(f))
    // A loose match only counts across boards: two postings from the same source with
    // different keys are different jobs and both are kept.
    const existing = byKey.get(f.key) || (loose && loose.source !== f.source ? loose : undefined)
    if (existing) {
      if (existing.key !== f.key) continue // the same job from another board: keep the first record
      mergeFound(existing, f, now)
      continue
    }
    const record = newRecord(f, now)
    jobs.push(record)
    byKey.set(f.key, record)
    byLoose.set(dedupeKey(f), record)
    added++
  }
  await saveJobs(username, jobs)
  return { added, jobs }
  })
}

function newRecord(f: Omit<JobRecord, 'id' | 'status' | 'log' | 'createdAt' | 'updatedAt'>, now: string): JobRecord {
  return { ...f, id: randomUUID().slice(0, 8), status: 'found', log: [{ at: now, msg: `Found on ${f.source}` }], createdAt: now, updatedAt: now }
}

/** Refresh listing details but never clobber application progress */
function mergeFound(existing: JobRecord, f: Omit<JobRecord, 'id' | 'status' | 'log' | 'createdAt' | 'updatedAt'>, now: string): JobRecord {
  // Keep a live check result unless the fresh listing is flagged
  const keepCheck = existing.verification?.live && f.verification?.status !== 'flagged'
  return Object.assign(existing, {
    ...f, status: existing.status, updatedAt: now,
    attempts: existing.attempts, verification: keepCheck ? existing.verification : f.verification ?? existing.verification,
    // Follows the latest listing: pinning a board ("ashby:acme") must clear an earlier
    // unconfirmed name match, or autopilot would never apply to that job
    boardUnconfirmed: f.boardUnconfirmed || undefined,
  })
}

/**
 * Change one job atomically: `change` mutates it and returns false to leave it
 * untouched. One row in SQLite (a write transaction, safe across processes);
 * the whole file under the user's lock in the JSON fallback.
 */
export function mutateJob(username: string, id: string, change: (job: JobRecord) => boolean): Promise<JobRecord | null> {
  return changeJob(username, id, change)
}

function changeJob(username: string, id: string, change: (job: JobRecord) => boolean): Promise<JobRecord | null> {
  const db = jobDb(username)
  if (db) {
    return Promise.resolve(transaction(db, () => {
      const job = parseJob(db.prepare('SELECT data FROM jobs WHERE id = ?').get(String(id)))
      if (!job || !change(job)) return null
      writeRow(db, job)
      return job
    }))
  }
  return withLock(userDir(username), async () => {
    const jobs = await listJobs(username)
    const job = jobs.find(j => j.id === id)
    if (!job || !change(job)) return null
    await saveJobs(username, jobs)
    return job
  })
}

function applyPatch(job: JobRecord, patch: Partial<JobRecord>, logMsg?: string): void {
  const now = new Date().toISOString()
  Object.assign(job, patch, { updatedAt: now })
  if (logMsg) job.log = [...(job.log || []), { at: now, msg: logMsg }].slice(-50)
}

/**
 * Atomically move a job into `patch.status` only if it is currently in one of
 * `from` (compare-and-set in one write transaction). Returns null when
 * another request got there first — e.g. two "approve"s, or autopilot and the
 * user, racing to submit the same application, in this or another process.
 */
export function claimJob(
  username: string,
  id: string,
  from: JobStatus[],
  patch: Partial<JobRecord>,
  logMsg?: string,
): Promise<JobRecord | null> {
  return changeJob(username, id, job => {
    if (!from.includes(job.status)) return false
    applyPatch(job, patch, logMsg)
    return true
  })
}

export function updateJob(
  username: string,
  id: string,
  patch: Partial<JobRecord>,
  logMsg?: string,
): Promise<JobRecord | null> {
  return changeJob(username, id, job => { applyPatch(job, patch, logMsg); return true })
}

// ── small per-user state (e.g. the batch application queue) ──────────────────

function stateName(name: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('Invalid state name')
  return name
}

/** A named piece of per-user Job Hunter state, stored next to the jobs */
export async function readJobState<T>(username: string, name: string, fallback: T): Promise<T> {
  const db = jobDb(username)
  if (!db) return readJson<T>(join(userDir(username), `state-${stateName(name)}.json`), fallback)
  const row = db.prepare('SELECT value FROM state WHERE name = ?').get(stateName(name))
  return row ? JSON.parse(String(row.value)) as T : fallback
}

/**
 * Read-modify-write a named state atomically (one write transaction with
 * jobs.db, so safe across processes). `change` returns the new value, or
 * undefined to leave it as it is; the stored value is returned either way.
 */
export function updateJobState<T>(username: string, name: string, fallback: T, change: (current: T) => T | undefined): Promise<T> {
  const db = jobDb(username)
  const key = stateName(name)
  if (db) {
    return Promise.resolve(transaction(db, () => {
      const row = db.prepare('SELECT value FROM state WHERE name = ?').get(key)
      const current = row ? JSON.parse(String(row.value)) as T : fallback
      const next = change(current)
      if (next === undefined) return current
      db.prepare('INSERT INTO state (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run(key, JSON.stringify(next), new Date().toISOString())
      return next
    }))
  }
  return withLock(userDir(username), async () => {
    const path = join(userDir(username), `state-${key}.json`)
    const current = await readJson<T>(path, fallback)
    const next = change(current)
    if (next === undefined) return current
    await writeJson(path, next)
    return next
  })
}
