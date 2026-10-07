/**
 * Job Hunter — one pipeline merged from the Proficiently job skills
 * (setup → job-search → tailor-resume → cover-letter → apply) and the Claude
 * Office CV skills:
 *
 *   importCv    CV file → text, contact details, suggested target roles
 *   runSearch   sources → location filter → dealbreakers → AI fit score →
 *               auto-prepare the best matches for approval
 *   prepareJob  tailored CV + cover letter + form answers  (status: ready)
 *   approveJob  the user's one click → fill the form, submit where safe
 *
 * Submitting happens on the user's approval of a job, or by autopilot within
 * the limits and sites the user switched on (see autopilot.ts).
 */
import { generateWithFallback } from '../ai'
import { auditLog } from '../audit'
import { analyzeCv, extractCvText } from './cv'
import { dealbreaker, matchesLocation, relevantTo, scoreJobs } from './match'
import { linkedInSearchUrl, searchSources, type SourceReport } from './sources'
import {
  getJob, getProfile, listJobs, saveCvFile, saveProfile, updateJob, upsertJobs, withJobOperation,
  type JobProfile, type JobRecord, type ModelChoice,
} from './store'
import { applyToJob } from './apply'
import { buildAnswers, missingApplicantFields, normalizeLabel, tailorResume, templateCoverLetter, writeCoverLetter } from './writer'

export * from './store'
export { linkedInSearchUrl } from './sources'
export { missingApplicantFields } from './writer'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

/**
 * GhostForge's model chain as a simple text generator. With a model choice it
 * leads the chain; otherwise the chain starts at the free models (no API key
 * needed) instead of the paid model selected in Settings.
 */
export function generatorFor(model: ModelChoice | null): Generate {
  return async opts => (await generateWithFallback(
    { system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens },
    { task: 'tools', preferFree: !model, ...(model ? { activeProvider: model.provider, activeModel: model.model } : {}) },
  )).text
}

/** Default generator (free models first — no API key required) */
export const aiGenerate: Generate = generatorFor(null)

/** The user's own model choice for Job Hunter */
async function userGenerator(username: string): Promise<Generate> {
  return generatorFor((await getProfile(username)).model)
}

// ── CV ───────────────────────────────────────────────────────────────────────

export async function importCv(username: string, fileName: string, data: Buffer, generate?: Generate | null) {
  if (generate === undefined) generate = await userGenerator(username)
  const text = await extractCvText(fileName, data)
  const filePath = await saveCvFile(username, fileName, data)
  const insights = await analyzeCv(text, generate)
  const current = await getProfile(username)

  // Only fill blanks — never overwrite details the user already corrected
  const applicant = { ...current.applicant }
  for (const [k, v] of Object.entries(insights.applicant)) {
    const key = k as keyof typeof applicant
    if (v && !applicant[key]) (applicant as Record<string, string>)[key] = v
  }
  const preferences = { ...current.preferences }
  if (!preferences.titles.length && insights.titles.length) preferences.titles = insights.titles

  const profile = await saveProfile(username, {
    cv: { text, fileName, filePath, uploadedAt: new Date().toISOString() },
    // A new CV starts fresh: earlier improvements belonged to the old one
    improvedCv: null,
    originalCv: null,
    applicant,
    preferences,
  })
  return { profile, insights }
}

// ── search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  terms: string[]
  found: number
  matched: number
  added: number
  prepared: number
  report: SourceReport[]
  linkedin: Array<{ term: string; location: string; url: string }>
}

export async function runSearch(
  username: string,
  opts: { terms?: string[]; autoPrepare?: number; generate?: Generate | null; includeLinkedIn?: boolean } = {},
): Promise<SearchResult> {
  const profile = await getProfile(username)
  if (!profile.cv) throw new Error('Upload your CV first')
  const terms = (opts.terms?.length ? opts.terms : profile.preferences.titles).map(t => t.trim()).filter(Boolean)
  if (!terms.length) throw new Error('Add at least one target job title to search for')
  const generate = opts.generate === undefined ? generatorFor(profile.model) : opts.generate

  const { jobs: raw, report } = await searchSources(profile.preferences, terms)
  const home = [profile.applicant.city, profile.applicant.country].filter(Boolean)
  const inLocation = raw.filter(j => relevantTo(j, terms) && matchesLocation(j, profile.preferences, home))

  // Score at most 60 listings per run to keep model usage bounded
  const candidates = inLocation.slice(0, 60)
  const scores = await scoreJobs(candidates, profile, generate)
  const scored = candidates.map((job, i) => {
    const blocked = dealbreaker(job, profile.preferences)
    return blocked
      ? { ...job, fit: 'Skip' as const, score: 0, reasons: blocked }
      : { ...job, ...scores[i] }
  })

  const { added } = await upsertJobs(username, scored)

  // Fully automated preparation: best new High-fit jobs go straight to the approval queue
  let prepared = 0
  const limit = opts.autoPrepare ?? 3
  if (limit > 0 && generate) {
    const queue = (await listJobs(username))
      .filter(j => j.status === 'found' && j.fit === 'High' && (opts.includeLinkedIn || j.ats !== 'linkedin'))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    for (const job of queue) {
      try { await prepareJob(username, job.id, generate); prepared++ } catch (e) {
        void auditLog({ level: 'warn', event: 'job_prepare_error', params: { username, jobId: job.id, error: String(e).slice(0, 200) } })
      }
    }
  }

  const places = profile.preferences.locations.length ? profile.preferences.locations : ['']
  void auditLog({ level: 'info', event: 'job_search', params: { username, terms, found: raw.length, matched: inLocation.length, added, prepared } })

  return {
    terms,
    found: raw.length,
    matched: inLocation.length,
    added,
    prepared,
    report,
    linkedin: terms.slice(0, 3).flatMap(term => places.slice(0, 2).map(location => ({ term, location, url: linkedInSearchUrl(term, location) }))),
  }
}

// ── prepare / approve ────────────────────────────────────────────────────────

export function prepareJob(username: string, id: string, generate?: Generate): Promise<JobRecord> {
  return withJobOperation(username, id, () => prepareJobMaterials(username, id, generate))
}

async function prepareJobMaterials(username: string, id: string, generate?: Generate): Promise<JobRecord> {
  generate ??= await userGenerator(username)
  const job = await getJob(username, id)
  if (!job) throw new Error('Job not found')
  // Never re-prepare a job that is mid-submit, already submitted, or dismissed —
  // that would flip it back to "ready" and allow a duplicate application.
  if (!['found', 'ready', 'failed', 'needs_user'].includes(job.status)) {
    throw new Error(`This job is "${job.status}" — it can't be prepared`)
  }
  const profile = await getProfile(username)
  if (!profile.cv?.text.trim()) throw new Error('Upload a CV with readable text first')

  await updateJob(username, id, {}, 'Preparing tailored CV and cover letter')
  let tailoredResume = ''
  let coverLetter = ''
  let preparationWarning = ''
  try {
    tailoredResume = await tailorResume(profile, job, generate)
    coverLetter = await writeCoverLetter(profile, job, tailoredResume, generate)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    tailoredResume = profile.cv.text
    coverLetter = templateCoverLetter(profile, job)
    preparationWarning = 'AI writing was unavailable. This draft uses your original CV and a basic cover letter, not AI-tailored materials. Review it before approving; autopilot will not submit it. Add a model key in Settings or run Ollama to retry AI tailoring.'
    await updateJob(username, id, {}, `${preparationWarning} AI error: ${msg.slice(0, 200)}`)
    void auditLog({ level: 'warn', event: 'job_prepare_fallback', params: { username, jobId: id, error: msg.slice(0, 200) } })
  }
  const answers = buildAnswers(profile)
  const updated = await updateJob(username, id, { tailoredResume, coverLetter, answers, preparationWarning, status: 'ready' }, 'Ready for your approval')
  return updated!
}

export function approveJob(
  username: string,
  id: string,
  opts: { headless?: boolean; by?: 'user' | 'autopilot'; allowSubmit?: boolean } = {},
): Promise<{ job: JobRecord; message: string; missing: string[] }> {
  return withJobOperation(username, id, () => applyApprovedJob(username, id, opts))
}

async function applyApprovedJob(
  username: string,
  id: string,
  opts: { headless?: boolean; by?: 'user' | 'autopilot'; allowSubmit?: boolean } = {},
): Promise<{ job: JobRecord; message: string; missing: string[] }> {
  const job = await getJob(username, id)
  if (!job) throw new Error('Job not found')
  if (job.status !== 'ready' && job.status !== 'needs_user' && job.status !== 'failed') {
    throw new Error(`This job is "${job.status}" — prepare it before approving`)
  }
  if (!job.tailoredResume?.trim() || !job.coverLetter?.trim()) throw new Error('Prepare the application materials before approving')
  if (opts.by === 'autopilot' && job.preparationWarning) throw new Error('This draft needs your review and approval because AI writing was unavailable')
  const profile: JobProfile = await getProfile(username)
  const missing = missingApplicantFields(profile)
  if (missing.length) throw new Error(`Fill in your ${missing.join(', ')} before applying`)

  const by = opts.by || 'user'
  const ap = profile.autopilot
  await updateJob(username, id, { status: 'submitting' }, by === 'autopilot' ? 'Autopilot — filling the application form' : 'Approved — filling the application form')
  void auditLog({ level: 'info', event: 'job_application_approved', params: { username, jobId: id, company: job.company, title: job.title, ats: job.ats, by } })

  // Laptop control on: a visible browser on this computer and screenshot-based
  // computer use when the form agent gets stuck. Off: headless, no screen needed.
  const generate = generatorFor(profile.model)
  const vision = ap.laptopControl ? visionModel : null
  const headless = opts.headless ?? (by === 'autopilot' ? !ap.laptopControl : undefined)

  // If applyToJob throws (e.g. no browser installed, or the process dies), the
  // job must not stay "submitting" forever — reset it to "failed" so it can be
  // retried by the user or autopilot.
  let result
  try {
    result = await applyToJob(job, profile, username, {
      headless,
      // The user's own approval is consent to submit; autopilot decides per site.
      allowSubmit: opts.allowSubmit ?? by === 'user',
      linkedin: by === 'user' || (ap.linkedinEasyApply && Boolean(profile.linkedin?.connectedAt)),
      generate, vision,
      log: message => {
        void updateJob(username, id, {}, message).catch(error => {
          void auditLog({ level: 'warn', event: 'job_application_log_error', params: { username, jobId: id, error: String(error).slice(0, 200) } })
        })
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const failed = await updateJob(username, id, { status: 'failed' }, `Application could not run: ${msg.slice(0, 200)}`)
    void auditLog({ level: 'warn', event: 'job_application_error', params: { username, jobId: id, error: msg.slice(0, 200), by } })
    return { job: failed!, message: msg, missing: [] }
  }
  const updated = await updateJob(username, id, {
    status: result.status,
    questions: result.questions?.length ? result.questions : undefined,
    aiAnswers: result.aiAnswers?.length ? result.aiAnswers : job.aiAnswers,
  }, result.message)
  void auditLog({ level: 'info', event: 'job_application_result', params: { username, jobId: id, status: result.status, filled: result.filled.length, missing: result.missing.length, by } })
  if (by === 'autopilot' && result.status !== 'failed') {
    void notify(username, result.status === 'submitted'
      ? { title: `Applied: ${job.title}`, body: `${job.company} — submitted by autopilot.` }
      : { title: `Needs you: ${job.title}`, body: result.questions?.length ? `${result.questions.length} question(s) to answer once; autopilot continues on its next run.` : result.message.slice(0, 140) })
  }
  return { job: updated!, message: result.message, missing: result.missing }
}

/** Screenshot → action, via GhostForge's vision model chain (computer-use fallback). */
async function visionModel(imageBase64: string, prompt: string): Promise<string> {
  const { generateVision } = await import('../ai')
  return (await generateVision({ imageBase64, prompt, maxTokens: 300 })).text
}

/** Push notification to the user's phone, when push is configured (never throws). */
async function notify(username: string, payload: { title: string; body: string }) {
  try {
    const { sendToUser } = await import('../push')
    await sendToUser(username, { ...payload, tag: 'job-hunter', url: '/jobs' })
  } catch { /* push not configured */ }
}

/**
 * The user answers the questions an application stopped on. Answers are saved
 * to the profile (reused on every later form) and the job goes back to the
 * queue so it is retried.
 */
export function answerQuestions(username: string, id: string, answers: Record<string, string>): Promise<JobRecord> {
  return withJobOperation(username, id, () => saveQuestionAnswers(username, id, answers))
}

async function saveQuestionAnswers(username: string, id: string, answers: Record<string, string>): Promise<JobRecord> {
  const job = await getJob(username, id)
  if (!job) throw new Error('Job not found')
  const clean: Record<string, string> = {}
  for (const [label, value] of Object.entries(answers || {}).slice(0, 50)) {
    const l = normalizeLabel(String(label)).slice(0, 200)
    const v = String(value ?? '').trim().slice(0, 2000)
    if (l && v) clean[l] = v
  }
  if (!Object.keys(clean).length) throw new Error('Answer at least one question')
  await saveProfile(username, { customAnswers: clean })
  const remaining = (job.questions || []).filter(q => !clean[normalizeLabel(q.label)])
  const status = job.status === 'submitted' || job.status === 'dismissed' ? job.status : remaining.length ? 'needs_user' : 'ready'
  return (await updateJob(username, id, { questions: remaining.length ? remaining : undefined, status }, `You answered ${Object.keys(clean).length} question(s); saved for future applications`))!
}

export function dismissJob(username: string, id: string): Promise<JobRecord | null> {
  return withJobOperation(username, id, () => updateJob(username, id, { status: 'dismissed' }, 'Dismissed'))
}
