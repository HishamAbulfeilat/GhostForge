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
  value: (p: JobProfile, job: JobRecord) => string
}

const yesNo = (v: string) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '')

/**
 * Label → value rules (from the Proficiently apply skill's field matching
 * table). Order matters: more specific patterns first.
 */
export const FIELD_RULES: FieldRule[] = [
  { pattern: /legal first name|^first name|given name/i, value: p => p.applicant.firstName },
  { pattern: /legal last name|^last name|surname|family name/i, value: p => p.applicant.lastName },
  { pattern: /full name|^name$|your name|electronic signature|signature/i, value: p => `${p.applicant.firstName} ${p.applicant.lastName}`.trim() },
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
  // from workAuthorized, not be inverted by the "visa"/"sponsorship" rule below.
  { pattern: /authori[sz]ed to work|work authori[sz]ation|legally (eligible|able) to work|right to work/i, value: p => yesNo(p.applicant.workAuthorized) },
  { pattern: /sponsorship|visa/i, value: p => yesNo(p.applicant.needsSponsorship) },
  { pattern: /previously (worked|been employed)|former employee/i, value: () => 'No' },
  { pattern: /gender|\brace\b|ethnicity|hispanic|veteran|disability|sexual orientation/i, value: () => 'Decline to self-identify' },
  { pattern: /current (company|employer)|^company$|^organization$/i, value: p => currentEmployer(p) },
]

function currentEmployer(p: JobProfile): string {
  const m = p.cv?.text.match(/^(.+?)\s*[|,–-]\s*.*\b(present|current)\b/im)
  return m ? m[1].trim().slice(0, 80) : ''
}

/** A form label without required-markers, extra spaces or a trailing colon. */
export function normalizeLabel(label: string): string {
  return String(label || '').replace(/[*✱]/g, '').replace(/\(required\)/gi, '').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim()
}

/** Comparison key for saved answers: case, punctuation and spacing don't matter. */
const answerKey = (label: string) => normalizeLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Answer a form label from the profile (answers the user saved win) */
export function answerFor(label: string, profile: JobProfile, job: JobRecord): string {
  const clean = normalizeLabel(label)
  const key = answerKey(clean)
  const cached = Object.entries(profile.customAnswers).find(([k]) => answerKey(k) === key)
  if (cached) return cached[1]
  const rule = FIELD_RULES.find(r => r.pattern.test(clean))
  return rule ? rule.value(profile, job) : ''
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
