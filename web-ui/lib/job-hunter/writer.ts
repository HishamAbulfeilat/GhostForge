/**
 * Application materials: tailored CV, cover letter and form answers.
 *
 * Writing rules are merged from the Proficiently tailor-resume / cover-letter
 * skills and the Claude Office cv-builder / resume-tailor skills (both MIT):
 * reorganize real experience, never invent it.
 */
import type { FieldAnswer, JobProfile, JobRecord } from './store'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

const ACCURACY_RULES = `STRICT ACCURACY (non-negotiable):
- Only use information explicitly in the CV. Never invent employers, dates, titles, metrics, skills or degrees.
- Never inflate scope or seniority, never extend a role's duration, never call a role current unless it says Present.
- When reframing, only reframe what exists: reorder, reword and mirror the posting's language where it is truthful.
- If something is ambiguous, understate or omit it.
STYLE: natural human language, varied sentence structure, no em dashes (use commas, periods or hyphens), no clichés like "results-driven" or "I am excited about the opportunity".`

async function compactRetry(
  generate: Generate,
  build: (cvLimit: number, jobLimit: number) => { system: string; prompt: string; maxTokens: number },
  limits: [number, number],
): Promise<string> {
  try {
    const text = (await generate(build(...limits))).trim()
    if (!text) throw new Error('The AI model returned an empty response')
    return text
  } catch (error) {
    console.warn('[Job Hunter] Writing failed; retrying with a compact prompt:', error instanceof Error ? error.message : String(error))
  }
  try {
    const text = (await generate(build(3000, 1000))).trim()
    if (!text) throw new Error('The AI model returned an empty response')
    return text
  } catch (error) {
    console.warn('[Job Hunter] Compact writing failed; retrying with a smaller prompt:', error instanceof Error ? error.message : String(error))
  }
  const text = (await generate(build(1800, 600))).trim()
  if (!text) throw new Error('The AI model returned an empty response')
  return text
}

export async function tailorResume(profile: JobProfile, job: JobRecord, generate: Generate): Promise<string> {
  return (await compactRetry(generate, (cvLimit, jobLimit) => ({
    system: `You are an expert resume writer. Tailor the candidate's CV to the job so a hiring manager sees the fit in 7 seconds.
- Summary: 2-3 sentences naming the role type, leading with the most relevant credential, with 2-3 posting keywords used naturally.
- Experience: per role, put the 2 most relevant bullets first; bullet formula = action verb + what + scale + measurable result (only real metrics). Drop irrelevant bullets.
- Skills: lead with the skills the posting emphasizes; drop noise.
- Calibrate to level: executives show strategy and business impact; managers show ownership and team building; ICs show hands-on depth.
${ACCURACY_RULES}
Output the full tailored CV in clean Markdown, nothing else.`,
    prompt: `ORIGINAL CV:\n${profile.cv?.text.slice(0, cvLimit)}\n\nJOB: ${job.title} at ${job.company} (${job.location})\n${job.description.slice(0, jobLimit)}`,
    maxTokens: 2500,
  }), [12000, 5000])).replace(/—/g, ', ').trim()
}

export async function writeCoverLetter(profile: JobProfile, job: JobRecord, tailored: string | undefined, generate: Generate): Promise<string> {
  const name = `${profile.applicant.firstName} ${profile.applicant.lastName}`.trim() || 'the candidate'
  return (await compactRetry(generate, (cvLimit, jobLimit) => ({
    system: `You write personalized cover letters that read like a real professional wrote them.
Structure: start with "Dear Hiring Manager,", then one or two opening sentences tying specific experience to their specific need, two short evidence paragraphs with 2-3 concrete achievements from the CV, and a 2-3 sentence close. End with "Regards,\\n${name}". 250-350 words. No headers.
${ACCURACY_RULES}
Output only the letter.`,
    prompt: `CV:\n${(tailored || profile.cv?.text || '').slice(0, cvLimit)}\n\nJOB: ${job.title} at ${job.company}\n${job.description.slice(0, jobLimit)}`,
    maxTokens: 900,
  }), [10000, 4000])).replace(/—/g, ' - ').trim()
}

/** A neutral draft, with no inferred qualifications or claims of fit. */
export function templateCoverLetter(profile: JobProfile, job: JobRecord): string {
  const name = `${profile.applicant.firstName} ${profile.applicant.lastName}`.trim()
  return [
    'Dear Hiring Manager,',
    '',
    `Please consider my application for the ${job.title} position at ${job.company}.`,
    'My attached CV provides my experience and qualifications for your review.',
    '',
    'Thank you for considering my application. I would welcome the opportunity to discuss the position.',
    '',
    'Regards,',
    name,
  ].join('\n')
}

// ── form answers ─────────────────────────────────────────────────────────────

export interface FieldRule {
  pattern: RegExp
  value: (p: JobProfile, job: JobRecord, label: string) => string
}

const yesNo = (v: string) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '')

/**
 * Consent, terms, signatures and legal declarations. Any field whose label
 * matches is the user's to answer: the agent stops and hands back instead of
 * filling it, never asks the AI about it and never reuses a saved answer.
 * Checked on every field kind (checkbox, radio, select, text…), not only checkboxes.
 */
export const CONSENT_OR_LEGAL = new RegExp([
  String.raw`\bI (hereby |fully )?(accept|agree|consent|acknowledge|attest|certify|declare|confirm|understand|authori[sz]e)\b`,
  String.raw`\b(read|reviewed) and (understand|understood|agree|accept)\b|\bunderstand (and|that)\b`,
  String.raw`\baccept(s|ed|ing)? (the|our|these|this|all|terms|privacy|polic(y|ies)|conditions)\b`,
  String.raw`\bagree(s|d|ment)?\b|\bconsent\w*|\backnowledg\w*|\battest\w*|\bcertif(y|ies|ied)\b|\bdeclar(e|es|ed|ation)\b`,
  String.raw`\bterms\b|\bprivacy\b|\bgdpr\b|\bdata (processing|retention|protection)\b`,
  String.raw`\bsignature\b|\be-?sign\b|\bsign(ed)? (here|below)\b`,
  String.raw`\bconfirm (that )?(the )?(above |this |all )?information\b`,
].join('|'), 'i')

/** True when a form label asks for consent, a signature or a legal declaration. */
export function isConsentOrLegal(label: string): boolean {
  return CONSENT_OR_LEGAL.test(normalizeLabel(label))
}

const WORK_ELIGIBILITY = /authori[sz]ed to work|work authori[sz]ation|legally (eligible|able|permitted) to work|right to work|eligib(le|ility) to work/i
/** Sponsorship wording only: "Do you hold a valid UK visa?" is a different question. */
const SPONSORSHIP = /sponsor(ship)?\b|(require|need)s? (a )?(work |employment )?visa\b|visa (support|transfer)/i
const PREVIOUS_EMPLOYMENT = /previously (worked|been employed)|former (employee|employer)|worked (for|at|with) (us|this company|[A-Z][\w&.' -]*) (before|previously)|ever (worked|been employed) (for|at|by)/i
/** "Where you live / your country of residence" refers to the applicant's own country. */
const RESIDENCE = /where you (currently )?(live|reside)|country (of|where you) (residence|live|reside)|your (current |home )?country( of residence)?\b/i

const COUNTRY_ALIASES: string[][] = [
  ['united states', 'united states of america', 'usa', 'us', 'america'],
  ['united kingdom', 'uk', 'great britain', 'britain', 'england'],
  ['united arab emirates', 'uae'],
  ['germany', 'deutschland'],
  ['netherlands', 'the netherlands', 'holland'],
]
const countryKey = (s: string) => {
  const v = s.toLowerCase().replace(/\./g, '').replace(/^the\s+/, '').replace(/\s+/g, ' ').trim()
  return COUNTRY_ALIASES.find(group => group.includes(v))?.[0] ?? v
}

/** The place a work-eligibility question names ("…work in the United States?"), or '' when it names none. */
export function namedWorkCountry(label: string): string {
  const m = normalizeLabel(label).match(/\b(?:work|employment|employed|sponsorship|visa)\b[^?]*?\bin\s+(?:the\s+)?([A-Za-z][A-Za-z .'-]*?)(?=\s+(?:without|for|on|as|now|at|if|and|or|with)\b|[?,;(]|$)/i)
  const place = (m?.[1] || '').trim()
  if (!place || /^(this|that|the|your|any|which|what) |^(this|that) (country|location|region)$|^country\b|^(location|region|countries)$/i.test(place) || /\bcountry\b/i.test(place)) return ''
  return place
}

/**
 * Does a work-authorization / sponsorship question ask about the applicant's
 * own country? Only then may the profile answer it. A question about another
 * country, or one that names none while the job is elsewhere or remote, goes
 * to the user.
 */
export function asksAboutOwnCountry(label: string, p: JobProfile, job: Pick<JobRecord, 'location'>): boolean {
  const own = countryKey(p.applicant.country || '')
  if (!own) return false
  const named = namedWorkCountry(label)
  if (named) return countryKey(named) === own
  if (RESIDENCE.test(label)) return true
  // "…work in this country?" / no country: the job's own location decides
  const where = String(job?.location || '').toLowerCase().replace(/\./g, '')
  const city = (p.applicant.city || '').trim().toLowerCase()
  const aliases = COUNTRY_ALIASES.find(g => g[0] === own) ?? [own]
  return Boolean(where) && (aliases.some(a => a.length > 3 && where.includes(a)) || where.split(/[^a-z]+/).some(w => aliases.includes(w)) || (city.length > 2 && where.includes(city)))
}

/** Labels whose answer depends on the employer or the country, so a saved answer must not carry over. */
function isJobRelative(label: string): boolean {
  if (PREVIOUS_EMPLOYMENT.test(label)) return true
  return (WORK_ELIGIBILITY.test(label) || SPONSORSHIP.test(label)) && !namedWorkCountry(label)
}

/**
 * Label → value rules (from the Proficiently apply skill's field matching
 * table). Order matters: more specific patterns first. Signatures, consent
 * and "previously worked for…" are deliberately absent: the user answers them.
 */
export const FIELD_RULES: FieldRule[] = [
  { pattern: /legal first name|^first name|given name/i, value: p => p.applicant.firstName },
  { pattern: /legal last name|^last name|surname|family name/i, value: p => p.applicant.lastName },
  { pattern: /full name|^name$|your name/i, value: p => `${p.applicant.firstName} ${p.applicant.lastName}`.trim() },
  { pattern: /e-?mail/i, value: p => p.applicant.email },
  { pattern: /phone|mobile|telephone/i, value: p => p.applicant.phone },
  { pattern: /linkedin/i, value: p => p.applicant.linkedin },
  { pattern: /github/i, value: p => p.applicant.github },
  { pattern: /portfolio|personal website|^website|other website/i, value: p => p.applicant.portfolio },
  { pattern: /current (location|city)|^location|^city/i, value: p => [p.applicant.city, p.applicant.country].filter(Boolean).join(', ') },
  { pattern: /^country/i, value: p => p.applicant.country },
  { pattern: /how did you hear|referral source|where did you (find|hear)/i, value: p => p.applicant.howHeard || 'Job board' },
  // Authorization must be tested before sponsorship: "authorized to work without
  // requiring visa sponsorship?" is an authorization question and must answer
  // from workAuthorized, not be inverted by the sponsorship rule below.
  // Both answer only for the applicant's own country; anything else is left blank for the user.
  { pattern: WORK_ELIGIBILITY, value: (p, job, label) => asksAboutOwnCountry(label, p, job) ? yesNo(p.applicant.workAuthorized) : '' },
  { pattern: SPONSORSHIP, value: (p, job, label) => asksAboutOwnCountry(label, p, job) ? yesNo(p.applicant.needsSponsorship) : '' },
  { pattern: /gender|\brace\b|ethnicity|hispanic|veteran|disability|sexual orientation/i, value: () => 'Decline to self-identify' },
  { pattern: /current (company|employer)|^company$|^organization$/i, value: p => currentEmployer(p) },
]

function currentEmployer(p: JobProfile): string {
  const m = p.cv?.text.match(/^(.+?)\s*[|,–-]\s*.*\b(present|current)\b/im)
  return m ? m[1].trim().slice(0, 80) : ''
}

/** A form label without required-markers, extra spaces or a trailing colon. */
export function normalizeLabel(label: string): string {
  return String(label || '').replace(/\*/g, '').replace(/\(required\)/gi, '').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim()
}

/** Comparison key for saved answers: case, punctuation and spacing don't matter. */
const answerKey = (label: string) => normalizeLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Can a saved answer to this label be reused on another application? */
export function reusableAnswer(label: string): boolean {
  return !isConsentOrLegal(label) && !isJobRelative(normalizeLabel(label))
}

/**
 * Questions the user must answer themselves when the profile has no answer:
 * consent and legal wording, work eligibility, sponsorship and previous
 * employment. They are never sent to the AI.
 */
export function needsUserAnswer(label: string): boolean {
  const clean = normalizeLabel(label)
  return isConsentOrLegal(clean) || PREVIOUS_EMPLOYMENT.test(clean) || WORK_ELIGIBILITY.test(clean) || SPONSORSHIP.test(clean)
}

/**
 * Answer a form label from the profile (answers the user saved win). Consent,
 * signatures and legal declarations are never answered: they return ''.
 */
export function answerFor(label: string, profile: JobProfile, job: JobRecord): string {
  const clean = normalizeLabel(label)
  if (isConsentOrLegal(clean)) return ''
  const key = answerKey(clean)
  // What the user answered for this job only ("Have you worked for us before?")
  const forJob = Object.entries(job.jobAnswers || {}).find(([k]) => answerKey(k) === key)
  if (forJob) return forJob[1]
  if (PREVIOUS_EMPLOYMENT.test(clean)) return ''
  const cached = reusableAnswer(clean) ? Object.entries(profile.customAnswers).find(([k]) => answerKey(k) === key) : undefined
  if (cached) return cached[1]
  const rule = FIELD_RULES.find(r => r.pattern.test(clean))
  return rule ? rule.value(profile, job, clean) : ''
}

/** The standard answers shown for review before the user approves */
export function buildAnswers(profile: JobProfile): FieldAnswer[] {
  const a = profile.applicant
  const answers: FieldAnswer[] = [
    { label: 'First name', value: a.firstName },
    { label: 'Last name', value: a.lastName },
    { label: 'Email', value: a.email },
    { label: 'Phone', value: a.phone },
    { label: 'Location', value: [a.city, a.country].filter(Boolean).join(', ') },
    { label: 'LinkedIn', value: a.linkedin },
    { label: 'GitHub', value: a.github },
    { label: 'Portfolio', value: a.portfolio },
    { label: 'Authorized to work', value: yesNo(a.workAuthorized) },
    { label: 'Needs visa sponsorship', value: yesNo(a.needsSponsorship) },
    { label: 'How did you hear about us', value: a.howHeard || 'Job board' },
    { label: 'EEO questions', value: 'Decline to self-identify' },
    { label: 'Resume upload', value: profile.cv?.fileName || '(no CV file)' },
  ]
  for (const [label, value] of Object.entries(profile.customAnswers)) answers.push({ label, value })
  return answers.filter(x => x.value)
}

/** Required details the profile is missing — shown before approval */
export function missingApplicantFields(profile: JobProfile): string[] {
  const a = profile.applicant
  const missing: string[] = []
  if (!profile.cv) missing.push('CV')
  if (!a.firstName) missing.push('First name')
  if (!a.lastName) missing.push('Last name')
  if (!a.email) missing.push('Email')
  if (!a.phone) missing.push('Phone')
  return missing
}
