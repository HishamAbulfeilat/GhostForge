/**
 * Matching and fit scoring.
 *
 * 1. Location filter — keep jobs in the user's preferred locations (or remote
 *    jobs open to them).
 * 2. Dealbreakers / salary floor — mark Skip immediately.
 * 3. Fit score — the AI rates each job against the CV using the Proficiently
 *    rubric (High / Medium / Low / Skip). Without a model, a keyword-overlap
 *    heuristic is used instead so search still works offline.
 */
import type { Fit, JobPreferences, JobProfile } from './store'
import type { RawJob } from './sources'

export interface Scored { fit: Fit; score: number; reasons: string }

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const WORLDWIDE = /\b(anywhere|worldwide|global|international)\b/

/** Region labels job boards use for remote roles, keyed by country */
const REGIONS: Array<{ labels: string[]; countries: string[] }> = [
  { labels: ['apac', 'asia', 'asia pacific', 'oceania'], countries: ['japan', 'china', 'korea', 'singapore', 'india', 'indonesia', 'malaysia', 'philippines', 'thailand', 'vietnam', 'taiwan', 'hong kong', 'australia', 'new zealand', 'pakistan', 'bangladesh'] },
  { labels: ['emea', 'europe', 'eu', 'uk'], countries: ['united kingdom', 'uk', 'england', 'ireland', 'germany', 'france', 'spain', 'portugal', 'italy', 'netherlands', 'belgium', 'poland', 'sweden', 'norway', 'denmark', 'finland', 'austria', 'switzerland', 'czech', 'romania', 'greece', 'hungary', 'ukraine'] },
  { labels: ['emea', 'middle east', 'mena'], countries: ['uae', 'united arab emirates', 'saudi arabia', 'qatar', 'jordan', 'egypt', 'israel', 'turkey', 'kuwait', 'bahrain', 'oman', 'lebanon', 'morocco'] },
  { labels: ['emea', 'africa'], countries: ['nigeria', 'kenya', 'south africa', 'ghana', 'egypt', 'morocco'] },
  { labels: ['americas', 'north america', 'usa', 'us', 'united states'], countries: ['united states', 'usa', 'us'] },
  { labels: ['americas', 'north america', 'canada'], countries: ['canada'] },
  { labels: ['americas', 'latam', 'latin america', 'south america'], countries: ['mexico', 'brazil', 'argentina', 'colombia', 'chile', 'peru', 'uruguay'] },
]

/** Can someone living in `home` take a remote job restricted to `loc`? */
function remoteOpenTo(loc: string, home: string[]): boolean {
  const l = ` ${loc} `
  if (!loc || loc === 'remote' || WORLDWIDE.test(loc)) return true
  if (home.some(h => h && l.includes(` ${h} `))) return true
  return REGIONS.some(r => home.some(h => r.countries.includes(h)) && r.labels.some(label => l.includes(` ${label} `)))
}

/** Does the job fit the user's location / remote preferences? */
export function matchesLocation(
  job: Pick<RawJob, 'location' | 'remote'>,
  prefs: Pick<JobPreferences, 'locations' | 'remote'>,
  /** Where the applicant lives, e.g. ['tokyo', 'japan'] — decides region-restricted remote roles */
  home: string[] = [],
): boolean {
  const loc = norm(job.location)
  const wanted = prefs.locations.map(norm).filter(Boolean)
  const wantsRemote = prefs.remote === 'remote' || wanted.includes('remote')
  const homeTokens = home.map(norm).filter(Boolean)

  if (prefs.remote === 'remote') {
    if (!job.remote) return false
    return remoteOpenTo(loc, homeTokens)
  } else if (prefs.remote === 'onsite' && job.remote && !wanted.some(w => loc.includes(w))) {
    return false
  }

  const places = wanted.filter(w => w !== 'remote')
  if (places.length === 0) return true

  // Any token of a preferred place ("tokyo japan" → "tokyo" or "japan") appearing in the listing
  const hitsPlace = places.some(place => place.split(' ').filter(t => t.length > 2).some(t => new RegExp(`\\b${t}\\b`).test(loc)))
  if (hitsPlace) return true

  // Remote roles count for anyone who accepts remote work and lives where the role allows
  if (job.remote && prefs.remote !== 'onsite' && (wantsRemote || prefs.remote === 'any' || prefs.remote === 'hybrid')) {
    return remoteOpenTo(loc, homeTokens.length ? homeTokens : places.flatMap(p => [p, ...p.split(' ')]))
  }
  return false
}

/**
 * Some boards search fuzzily and return unrelated roles. Keep a listing only
 * when its title shares a word with a search term, or its description
 * contains a term as an exact phrase.
 */
export function relevantTo(job: Pick<RawJob, 'title' | 'description'>, terms: string[]): boolean {
  const title = ` ${norm(job.title)} `
  const desc = ` ${norm(job.description)} `
  return terms.map(norm).filter(Boolean).some(term => {
    const words = term.split(' ').filter(w => w.length > 2 && !STOP.has(w))
    return words.some(w => title.includes(` ${w} `)) || desc.includes(` ${term} `)
  })
}

/** Parse the top of a salary string like "$120k-$150k" or "USD 90000-120000" */
function salaryMax(s: string): number | null {
  const nums = [...String(s || '').toLowerCase().matchAll(/(\d[\d,.]*)\s*(k)?/g)].map(m => {
    const n = parseFloat(m[1].replace(/,/g, ''))
    return m[2] ? n * 1000 : n
  }).filter(n => n >= 1000)
  return nums.length ? Math.max(...nums) : null
}

/** Hard rules from preferences.md in the Proficiently rubric */
export function dealbreaker(job: Pick<RawJob, 'title' | 'company' | 'description' | 'salary'>, prefs: JobPreferences): string | null {
  const hay = norm(`${job.title} ${job.company} ${job.description}`)
  const hit = prefs.dealbreakers.map(norm).find(d => d && hay.includes(d))
  if (hit) return `Dealbreaker: ${hit}`
  if (prefs.minSalary) {
    const max = salaryMax(job.salary)
    if (max !== null && max < prefs.minSalary) return `Salary ${job.salary} is below your minimum`
  }
  return null
}

const STOP = new Set('and the for with you our are will that this from your have team work role able years experience strong using including their about into more such other what who we they them all can not but its has was were also any per etc'.split(' '))

function keywords(text: string): Set<string> {
  return new Set(norm(text).split(' ').filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)))
}

/** Offline fallback: overlap between CV vocabulary and the listing */
export function heuristicScore(job: RawJob, profile: JobProfile): Scored {
  const cv = keywords(profile.cv?.text || '')
  const jd = keywords(`${job.title} ${job.description}`)
  let overlap = 0
  for (const w of jd) if (cv.has(w)) overlap++
  const coverage = jd.size ? overlap / Math.min(jd.size, 120) : 0

  const titleHit = profile.preferences.titles.some(t => norm(job.title).includes(norm(t)) || norm(t).split(' ').every(p => norm(job.title).includes(p)))
  const musts = profile.preferences.mustHaves.map(norm).filter(Boolean)
  const mustMet = musts.filter(m => norm(`${job.title} ${job.description}`).includes(m)).length

  let score = Math.round(Math.min(1, coverage * 1.6) * 60 + (titleHit ? 30 : 0) + (musts.length ? (mustMet / musts.length) * 10 : 10))
  score = Math.max(0, Math.min(100, score))
  const fit: Fit = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low'
  const reasons = [
    titleHit ? 'title matches your target roles' : 'title differs from your target roles',
    `${overlap} CV keywords appear in the listing`,
    musts.length ? `${mustMet}/${musts.length} must-haves mentioned` : '',
  ].filter(Boolean).join('; ')
  return { fit, score, reasons }
}

/** Pull the first JSON array/object out of a model response */
export function extractJson<T>(text: string): T | null {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '')
  const start = cleaned.search(/[[{]/)
  if (start === -1) return null
  for (let end = cleaned.length; end > start; end--) {
    const ch = cleaned[end - 1]
    if (ch !== ']' && ch !== '}') continue
    try { return JSON.parse(cleaned.slice(start, end)) as T } catch { /* keep shrinking */ }
  }
  return null
}

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

/** AI fit scoring in small batches; falls back to the heuristic per batch */
export async function scoreJobs(jobs: RawJob[], profile: JobProfile, generate: Generate | null): Promise<Scored[]> {
  const out: Scored[] = jobs.map(j => heuristicScore(j, profile))
  if (!generate || !profile.cv?.text) return out

  const prefs = profile.preferences
  const system = `You are a job evaluation specialist. Score each job against the candidate using this rubric:
- Skip: any dealbreaker present
- High: no dealbreakers + all must-haves + 2 or more nice-to-haves, and the candidate's experience clearly fits the role and level
- Medium: no dealbreakers + most must-haves, or all must-haves but few nice-to-haves
- Low: significant gaps in skills, level or must-haves
Be decisive. Judge only from the CV and listing; never assume facts not stated.
Return ONLY a JSON array: [{"i": <index>, "fit": "High"|"Medium"|"Low"|"Skip", "score": 0-100, "reasons": "<one short sentence>"}]`

  const context = `CANDIDATE CV:\n${profile.cv.text.slice(0, 6000)}\n\nPREFERENCES:\nTarget roles: ${prefs.titles.join(', ') || 'any'}\nLocations: ${prefs.locations.join(', ') || 'any'} (remote: ${prefs.remote})\nMust-haves: ${prefs.mustHaves.join(', ') || 'none'}\nNice-to-haves: ${prefs.niceToHaves.join(', ') || 'none'}\nDealbreakers: ${prefs.dealbreakers.join(', ') || 'none'}${prefs.minSalary ? `\nMinimum salary: ${prefs.minSalary}` : ''}`

  const BATCH = 8
  for (let start = 0; start < jobs.length; start += BATCH) {
    const batch = jobs.slice(start, start + BATCH)
    const listing = batch.map((j, k) => `[${k}] ${j.title} at ${j.company} — ${j.location}${j.salary ? ` — ${j.salary}` : ''}\n${j.description.slice(0, 1200)}`).join('\n\n')
    try {
      const text = await generate({ system, prompt: `${context}\n\nJOBS:\n${listing}`, maxTokens: 1200 })
      const parsed = extractJson<Array<{ i: number; fit: Fit; score: number; reasons: string }>>(text)
      for (const r of parsed || []) {
        if (typeof r?.i !== 'number' || r.i < 0 || r.i >= batch.length) continue
        if (!['High', 'Medium', 'Low', 'Skip'].includes(r.fit)) continue
        out[start + r.i] = { fit: r.fit, score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))), reasons: String(r.reasons || '').slice(0, 300) }
      }
    } catch {
      // keep heuristic scores for this batch
    }
  }
  return out
}
