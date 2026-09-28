/**
 * CV improvement: an honest review plus a rewritten CV.
 *
 * The rewrite follows the same accuracy rules as job tailoring — it
 * reorganizes and rewords what the CV already says and never invents facts.
 * Nothing replaces the user's CV until they adopt the improved version, and
 * the original is kept so adopting can be undone.
 */
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { auditLog } from '../audit'
import { extractJson } from './match'
import { getProfile, saveProfile, userDir, type CvFile, type CvReview, type JobProfile } from './store'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

const ACCURACY = `STRICT ACCURACY: use only facts stated in the CV. Never invent employers, dates, titles,
metrics, skills, degrees or certifications. Never inflate scope or seniority. Where a bullet lacks a
result, strengthen the wording, but do not make up numbers. No em dashes, no clichés
("results-driven", "team player", "passionate").`

const clampList = (v: unknown, max = 8) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x.trim()).slice(0, max).map(x => String(x).slice(0, 400))

/** Honest review of the CV as it stands */
export async function reviewCv(cvText: string, targetRoles: string[], generate: Generate): Promise<CvReview> {
  const out = await generate({
    system: `You are a senior recruiter and resume coach. Review the CV honestly against these criteria:
clear headline/summary for the target roles; impact-focused bullets (action + scope + result);
relevant skills surfaced; consistent dates and formatting; ATS-readability (standard headings, no tables/graphics);
length and focus. Be specific — quote or name the section you mean.
Return ONLY JSON: {"score": 0-100, "summary": "2 sentences", "strengths": [..], "issues": [..], "suggestions": [..]}`,
    prompt: `TARGET ROLES: ${targetRoles.join(', ') || 'not specified'}\n\nCV:\n${cvText.slice(0, 12000)}`,
    maxTokens: 1200,
  })
  const j = extractJson<Partial<CvReview>>(out)
  if (!j) throw new Error('The model did not return a review — try again or pick another model')
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))),
    summary: String(j.summary || '').slice(0, 600),
    strengths: clampList(j.strengths),
    issues: clampList(j.issues),
    suggestions: clampList(j.suggestions),
  }
}

/** Rewrite the CV applying the review, in clean Markdown */
export async function rewriteCv(cvText: string, review: CvReview, targetRoles: string[], generate: Generate): Promise<string> {
  const out = await generate({
    system: `You are an expert resume writer. Rewrite the CV to fix the review's issues and apply its suggestions.
Structure: "# Full Name", a contact line, "## Summary" (2-3 sentences aimed at the target roles),
"## Experience" (### Title | Company | Dates, then "- " bullets, most relevant first, action verb + scope + result),
"## Skills" (grouped), then Education / Certifications / Projects only if the CV has them.
Standard headings only, no tables. ${ACCURACY}
Output only the Markdown CV.`,
    prompt: `TARGET ROLES: ${targetRoles.join(', ') || 'not specified'}\n\nREVIEW ISSUES:\n- ${review.issues.join('\n- ')}\n\nSUGGESTIONS:\n- ${review.suggestions.join('\n- ')}\n\nORIGINAL CV:\n${cvText.slice(0, 12000)}`,
    maxTokens: 3000,
  })
  const text = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:markdown|md)?\s*|```\s*$/gi, '').replace(/—/g, ', ').trim()
  if (text.length < 200) throw new Error('The rewritten CV came back too short — try again or pick another model')
  return text
}

/** Review + rewrite the user's current CV and save the result (not adopted yet) */
export async function improveCv(username: string, generate: Generate): Promise<NonNullable<JobProfile['improvedCv']>> {
  const profile = await getProfile(username)
  // Always improve the user's own words, not an earlier AI rewrite
  const source = profile.originalCv?.text || profile.cv?.text
  if (!source) throw new Error('Upload your CV first')
  const roles = profile.preferences.titles
  const review = await reviewCv(source, roles, generate)
  const text = await rewriteCv(source, review, roles, generate)
  const improvedCv = { text, review, createdAt: new Date().toISOString() }
  await saveProfile(username, { improvedCv })
  void auditLog({ level: 'info', event: 'cv_improved', params: { username, score: review.score } })
  return improvedCv
}

// ── Markdown → DOCX ─────────────────────────────────────────────────────────

/** Inline **bold** and [text](url) → docx runs */
async function inlineRuns(line: string) {
  const { TextRun, ExternalHyperlink } = await import('docx')
  const runs: Array<InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>> = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) runs.push(new TextRun(line.slice(last, m.index)))
    if (m[1]) runs.push(new TextRun({ text: m[1], bold: true }))
    else runs.push(new ExternalHyperlink({ link: m[3], children: [new TextRun({ text: m[2], style: 'Hyperlink' })] }))
    last = m.index + m[0].length
  }
  if (last < line.length) runs.push(new TextRun(line.slice(last)))
  return runs
}

/** Convert the Markdown CV (headings, bullets, bold, links) to a .docx buffer */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import('docx')
  const children = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      const level = h[1].length === 1 ? HeadingLevel.TITLE : h[1].length === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2
      children.push(new Paragraph({ heading: level, children: await inlineRuns(h[2]) }))
      continue
    }
    const b = line.match(/^\s*[-*•]\s+(.*)$/)
    if (b) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: await inlineRuns(b[1]) }))
      continue
    }
    children.push(new Paragraph({ children: await inlineRuns(line) }))
  }
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}

function fileStem(profile: JobProfile): string {
  const name = `${profile.applicant.firstName} ${profile.applicant.lastName}`.trim() || 'cv'
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cv'
}

/**
 * Make the improved CV the active one: tailoring uses its text and application
 * forms upload a generated .docx. The original is kept for undo.
 */
export async function adoptImprovedCv(username: string): Promise<CvFile> {
  const profile = await getProfile(username)
  if (!profile.improvedCv) throw new Error('Improve your CV first')
  const dir = join(userDir(username), 'cv')
  await mkdir(dir, { recursive: true })
  const fileName = `${fileStem(profile)}-cv-improved.docx`
  const filePath = join(dir, fileName)
  await writeFile(filePath, await markdownToDocx(profile.improvedCv.text))
  const cv: CvFile = { text: profile.improvedCv.text, fileName, filePath, uploadedAt: new Date().toISOString() }
  await saveProfile(username, { cv, originalCv: profile.originalCv || profile.cv })
  void auditLog({ level: 'info', event: 'cv_improved_adopted', params: { username } })
  return cv
}

/** Go back to the user's own CV */
export async function restoreOriginalCv(username: string): Promise<CvFile> {
  const profile = await getProfile(username)
  if (!profile.originalCv) throw new Error('You are already using your original CV')
  await saveProfile(username, { cv: profile.originalCv, originalCv: null })
  return profile.originalCv
}
