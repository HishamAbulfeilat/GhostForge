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
 * Nothing is ever submitted without the user approving that specific job.
 */
import { generateWithFallback } from '../ai'
import { auditLog } from '../audit'
import { analyzeCv, extractCvText } from './cv'
import { dealbreaker, matchesLocation, relevantTo, scoreJobs } from './match'
import { linkedInSearchUrl, searchSources, type SourceReport } from './sources'
import {
  getJob, getProfile, listJobs, saveCvFile, saveProfile, updateJob, upsertJobs,
  type JobProfile, type JobRecord,
} from './store'
import { applyToJob } from './apply'
import { buildAnswers, missingApplicantFields, tailorResume, writeCoverLetter } from './writer'

export * from './store'
export { linkedInSearchUrl } from './sources'
export { missingApplicantFields } from './writer'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

/** GhostForge's model chain (free models, keys, local Ollama) as a simple text generator */
export const aiGenerate: Generate = async opts => (await generateWithFallback(
  { system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens },
  { task: 'tools' },
)).text

// ── CV ───────────────────────────────────────────────────────────────────────

export async function importCv(username: string, fileName: string, data: Buffer, generate: Generate | null = aiGenerate) {
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
  opts: { terms?: string[]; autoPrepare?: number; generate?: Generate | null } = {},
): Promise<SearchResult> {
  const profile = await getProfile(username)
  if (!profile.cv) throw new Error('Upload your CV first')
  const terms = (opts.terms?.length ? opts.terms : profile.preferences.titles).map(t => t.trim()).filter(Boolean)
  if (!terms.length) throw new Error('Add at least one target job title to search for')
  const generate = opts.generate === undefined ? aiGenerate : opts.generate

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
      .filter(j => j.status === 'found' && j.fit === 'High' && j.ats !== 'linkedin')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    for (const job of queue) {
      try { await prepareJob(username, job.id, generate); prepared++ } catch { /* stays in "found" */ }
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

export async function prepareJob(username: string, id: string, generate: Generate = aiGenerate): Promise<JobRecord> {
  const job = await getJob(username, id)
  if (!job) throw new Error('Job not found')
  const profile = await getProfile(username)
  if (!profile.cv) throw new Error('Upload your CV first')

  await updateJob(username, id, {}, 'Preparing tailored CV and cover letter')
  const tailoredResume = await tailorResume(profile, job, generate)
  const coverLetter = await writeCoverLetter(profile, job, tailoredResume, generate)
  const answers = buildAnswers(profile)
  const updated = await updateJob(username, id, { tailoredResume, coverLetter, answers, status: 'ready' }, 'Ready for your approval')
  return updated!
}

export async function approveJob(username: string, id: string): Promise<{ job: JobRecord; message: string; missing: string[] }> {
  const job = await getJob(username, id)
  if (!job) throw new Error('Job not found')
  if (job.status !== 'ready' && job.status !== 'needs_user' && job.status !== 'failed') {
    throw new Error(`This job is "${job.status}" — prepare it before approving`)
  }
  const profile: JobProfile = await getProfile(username)
  const missing = missingApplicantFields(profile)
  if (missing.length) throw new Error(`Fill in your ${missing.join(', ')} before applying`)

  await updateJob(username, id, { status: 'submitting' }, 'Approved — filling the application form')
  void auditLog({ level: 'info', event: 'job_application_approved', params: { username, jobId: id, company: job.company, title: job.title, ats: job.ats } })

  const result = await applyToJob(job, profile, username)
  const updated = await updateJob(username, id, { status: result.status }, result.message)
  void auditLog({ level: 'info', event: 'job_application_result', params: { username, jobId: id, status: result.status, filled: result.filled.length, missing: result.missing.length } })
  return { job: updated!, message: result.message, missing: result.missing }
}

export async function dismissJob(username: string, id: string): Promise<JobRecord | null> {
  return updateJob(username, id, { status: 'dismissed' }, 'Dismissed')
}
