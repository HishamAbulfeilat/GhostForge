/**
 * Interview prep from a prepared application: likely questions and STAR-style
 * talking points, grounded in the CV and the job description.
 *
 * Same rule as the application writer: nothing is invented. The model must
 * quote the CV line each example comes from; an example whose quote isn't in
 * the CV, or that names a number found in neither the CV nor the posting, is
 * dropped and the question says what the CV doesn't show instead. Without a
 * model, a basic outline is built from the job's requirement lines and the
 * matching CV lines, quoted as they are.
 */
import { extractJson, requirementsExcerpt } from './match'
import { getJob, getProfile, updateJob, withJobOperation, type InterviewPrep, type InterviewQuestion, type JobRecord } from './store'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

const MAX_QUESTIONS = 10
const NO_EXAMPLE = 'Your CV does not show a specific example for this. Prepare one from your own experience, or be ready to say how you would approach it.'

const flat = (s: string) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const numbersIn = (s: string) => new Set((String(s || '').match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.')))

/** Is `quote` (ignoring case, punctuation and spacing) part of the CV? */
export function quotedFromCv(quote: string, cv: string): boolean {
  const q = flat(quote)
  return q.length >= 12 && flat(cv).includes(q)
}

/** Numbers in `text` that appear in neither the CV nor the posting (invented metrics) */
export function unsupportedNumbers(text: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap(s => [...numbersIn(s)]))
  return [...numbersIn(text)].filter(n => !known.has(n))
}

const clip = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Check a model's answer against the CV and the posting, dropping anything unsupported */
export function groundPrep(raw: unknown, cv: string, job: Pick<JobRecord, 'title' | 'company' | 'description'>): Pick<InterviewPrep, 'questions' | 'gaps'> {
  const data = (raw && typeof raw === 'object' ? raw : {}) as { questions?: unknown[]; gaps?: unknown[] }
  const sources = [cv, `${job.title} ${job.company} ${job.description}`]
  const questions: InterviewQuestion[] = []
  for (const item of Array.isArray(data.questions) ? data.questions : []) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const question = clip(q.question, 300)
    if (!question) continue
    // Talking points that cite a number the CV and posting don't contain are invented metrics
    const points = (Array.isArray(q.points) ? q.points : []).map(p => clip(p, 300)).filter(Boolean)
      .filter(p => unsupportedNumbers(p, sources).length === 0).slice(0, 4)
    const evidence = clip(q.evidence, 400)
    const s = (q.star && typeof q.star === 'object' ? q.star : null) as Record<string, unknown> | null
    const star = s ? { situation: clip(s.situation, 400), task: clip(s.task, 400), action: clip(s.action, 500), result: clip(s.result, 400) } : null
    const starText = star ? Object.values(star).join(' ') : ''
    const grounded = Boolean(star && star.action && evidence && quotedFromCv(evidence, cv) && unsupportedNumbers(starText, sources).length === 0)
    const modelGap = clip(q.gap, 300)
    questions.push({
      question, why: clip(q.why, 300), points,
      ...(grounded ? { star: star!, evidence } : {}),
      ...(!grounded ? { gap: modelGap || NO_EXAMPLE } : modelGap ? { gap: modelGap } : {}),
    })
    if (questions.length >= MAX_QUESTIONS) break
  }
  const gaps = (Array.isArray(data.gaps) ? data.gaps : []).map(g => clip(g, 300)).filter(Boolean).slice(0, 8)
  return { questions, gaps }
}

const STOP = new Set('and the for with you our are will that this from your have team work role able years year experience strong using including their about into more such other what who we they them all can not but its has was were also any per etc must plus good great excellent'.split(' '))
const words = (s: string) => new Set(flat(s).split(' ').filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)))

/**
 * No model: one question per requirement line, with the CV lines that share
 * its key words as talking points (quoted unchanged), or a gap when none do.
 */
export function basicPrep(cv: string, job: Pick<JobRecord, 'title' | 'company' | 'description'>): Pick<InterviewPrep, 'questions' | 'gaps'> {
  const cvLines = String(cv || '').split(/\n+/).map(l => l.trim().replace(/^[-•*·▪●–]\s*/, '')).filter(l => l.length >= 12)
  const reqs = requirementsExcerpt(job.description, 3000).split(/\n+/)
    .map(l => l.trim().replace(/^[-•*·▪●–]\s*/, '')).filter(l => l.length >= 6 && l.length <= 240).slice(0, 6)
  const questions: InterviewQuestion[] = []
  const gaps: string[] = []
  for (const req of reqs) {
    const need = words(req)
    if (!need.size) continue
    const matches = cvLines
      .map(line => ({ line, hits: [...words(line)].filter(w => need.has(w)).length }))
      .filter(m => m.hits >= Math.min(2, need.size))
      .sort((a, b) => b.hits - a.hits).slice(0, 2).map(m => m.line.slice(0, 300))
    questions.push({
      question: `Tell me about your experience with this: "${req}"`,
      why: 'Listed in the job’s requirements.',
      points: matches,
      ...(matches.length ? {} : { gap: NO_EXAMPLE }),
    })
    if (!matches.length) gaps.push(req)
  }
  questions.push({
    question: `Why do you want this ${job.title} role at ${job.company}?`,
    why: 'Asked in most interviews.',
    points: [],
    gap: 'Only you can answer this. Read the posting and the company’s own pages, and connect them to what you want next.',
  })
  return { questions, gaps }
}

export async function writeInterviewPrep(cv: string, job: Pick<JobRecord, 'title' | 'company' | 'description' | 'tailoredResume'>, generate: Generate | null): Promise<InterviewPrep> {
  const createdAt = new Date().toISOString()
  const fallback = (warning: string): InterviewPrep => ({ ...basicPrep(cv, job), ai: false, warning, createdAt })
  if (!generate) return fallback('No AI model was available. This is a basic outline from the job’s requirements and the matching lines of your CV.')
  const system = `You are an interview coach preparing a candidate for one job interview.
Write the 6 to 8 questions this interviewer is most likely to ask, based on the job description, and help the candidate answer them from their CV.
STRICT ACCURACY (non-negotiable):
- Use ONLY facts written in the CV. Never invent employers, projects, technologies, dates, team sizes, numbers or results.
- A STAR example ("star") must come from one CV line or bullet, quoted exactly in "evidence". If the CV has no such example, set "star" to null and say in "gap" what the CV does not show.
- Talking points ("points") restate CV facts relevant to the question; no new facts, no invented metrics.
- List job requirements the CV does not show in "gaps". Saying what is missing is better than inventing.
Return ONLY JSON: {"questions":[{"question":"...","why":"<what in the posting makes it likely>","points":["..."],"star":{"situation":"...","task":"...","action":"...","result":"..."}|null,"evidence":"<exact CV text>","gap":"<what the CV doesn't show, or empty>"}],"gaps":["..."]}`
  const attempt = async (cvLimit: number, jobLimit: number) => {
    const prompt = `CV (the only source of facts about the candidate):\n${cv.slice(0, cvLimit)}\n\nJOB: ${job.title} at ${job.company}\nREQUIREMENTS:\n${requirementsExcerpt(job.description, Math.floor(jobLimit / 2))}\n\nDESCRIPTION:\n${job.description.slice(0, jobLimit)}`
    const parsed = extractJson<unknown>(await generate({ system, prompt, maxTokens: 2500 }))
    const grounded = groundPrep(parsed, cv, job)
    if (!grounded.questions.length) throw new Error('The model returned no usable questions')
    return grounded
  }
  try {
    return { ...(await attempt(8000, 4000)), ai: true, createdAt }
  } catch {
    try { return { ...(await attempt(3000, 1500)), ai: true, createdAt } } catch (e) {
      return fallback(`AI writing was unavailable (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}). This is a basic outline from the job’s requirements and the matching lines of your CV.`)
    }
  }
}

/** Generate and store interview prep for a prepared application */
export function prepareInterview(username: string, id: string, generate: Generate | null): Promise<JobRecord> {
  return withJobOperation(username, id, async () => {
    const job = await getJob(username, id)
    if (!job) throw new Error('Job not found')
    if (!job.tailoredResume?.trim()) throw new Error('Prepare the application first: interview prep uses its CV and job description')
    const profile = await getProfile(username)
    // The user's own CV is the source of facts; a tailored CV only reorders it
    const cv = profile.cv?.text?.trim() || job.tailoredResume
    const interviewPrep = await writeInterviewPrep(cv, job, generate)
    return (await updateJob(username, id, { interviewPrep }, interviewPrep.ai ? 'Interview prep ready' : 'Basic interview outline ready (AI unavailable)'))!
  })
}
