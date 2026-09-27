/**
 * Job Hunter storage — one folder per GhostForge user:
 *
 *   ~/.ghostforge/jobs/<username>/profile.json   CV text, applicant data, preferences
 *   ~/.ghostforge/jobs/<username>/jobs.json      discovered jobs + application state
 *   ~/.ghostforge/jobs/<username>/cv/<file>      the original uploaded CV (used for uploads)
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'

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

export type Ats = 'lever' | 'greenhouse' | 'ashby' | 'workday' | 'linkedin' | 'other'

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
  /** Optional Greenhouse board tokens / Lever company slugs to watch directly */
  companies: string[]
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
  lastRunAt?: string
  lastResult?: string
  /** Submissions per day, e.g. { "2026-09-28": 3 } (last 14 days kept) */
  submittedByDay?: Record<string, number>
}

export const DEFAULT_AUTOPILOT: AutopilotSettings = { enabled: false, intervalHours: 12, dailyLimit: 5, minScore: 75 }

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
  updatedAt: string
}

export interface FieldAnswer { label: string; value: string }

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
  fit: Fit
  score: number
  reasons: string
  status: JobStatus
  tailoredResume?: string
  coverLetter?: string
  answers?: FieldAnswer[]
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
  mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [],
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
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
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
    updatedAt: stored.updatedAt || '',
  }
}

export async function saveProfile(username: string, patch: Partial<Omit<JobProfile, 'updatedAt'>>): Promise<JobProfile> {
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

export async function listJobs(username: string): Promise<JobRecord[]> {
  return readJson<JobRecord[]>(join(userDir(username), 'jobs.json'), [])
}

async function saveJobs(username: string, jobs: JobRecord[]): Promise<void> {
  await writeJson(join(userDir(username), 'jobs.json'), jobs)
}

export async function getJob(username: string, id: string): Promise<JobRecord | null> {
  return (await listJobs(username)).find(j => j.id === id) || null
}

/** Merge newly found jobs, keeping state for ones we've already seen */
export async function upsertJobs(
  username: string,
  found: Array<Omit<JobRecord, 'id' | 'status' | 'log' | 'createdAt' | 'updatedAt'>>,
): Promise<{ added: number; jobs: JobRecord[] }> {
  const jobs = await listJobs(username)
  const byKey = new Map(jobs.map(j => [j.key, j]))
  const now = new Date().toISOString()
  let added = 0
  for (const f of found) {
    const existing = byKey.get(f.key)
    if (existing) {
      // Refresh listing details but never clobber application progress
      Object.assign(existing, { ...f, status: existing.status, updatedAt: now })
      continue
    }
    const record: JobRecord = { ...f, id: randomUUID().slice(0, 8), status: 'found', log: [{ at: now, msg: `Found on ${f.source}` }], createdAt: now, updatedAt: now }
    jobs.push(record)
    byKey.set(f.key, record)
    added++
  }
  await saveJobs(username, jobs)
  return { added, jobs }
}

export async function updateJob(
  username: string,
  id: string,
  patch: Partial<JobRecord>,
  logMsg?: string,
): Promise<JobRecord | null> {
  const jobs = await listJobs(username)
  const job = jobs.find(j => j.id === id)
  if (!job) return null
  const now = new Date().toISOString()
  Object.assign(job, patch, { updatedAt: now })
  if (logMsg) job.log = [...(job.log || []), { at: now, msg: logMsg }].slice(-50)
  await saveJobs(username, jobs)
  return job
}
