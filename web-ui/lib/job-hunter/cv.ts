/**
 * CV intake: extract text from PDF / DOCX / TXT and pull out contact details
 * and suggested target roles so the profile pre-fills itself.
 */
import { extname } from 'path'
import { extractJson } from './match'
import type { ApplicantData } from './store'

export const CV_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']
export const MAX_CV_BYTES = 5 * 1024 * 1024

export async function extractCvText(fileName: string, data: Buffer): Promise<string> {
  const ext = extname(fileName).toLowerCase()
  if (!CV_EXTENSIONS.includes(ext)) throw new Error(`Unsupported CV format ${ext || '(none)'} — use PDF, DOCX or TXT`)
  if (data.length > MAX_CV_BYTES) throw new Error('CV is larger than 5 MB')

  let text = ''
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(data))
    const result = await extractText(pdf, { mergePages: true })
    text = Array.isArray(result.text) ? result.text.join('\n') : result.text
  } else if (ext === '.docx') {
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ buffer: data })).value
  } else {
    text = data.toString('utf8')
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 40) throw new Error('Could not read any text from this CV — is it a scanned image?')
  return text.slice(0, 40_000)
}

export interface CvInsights {
  applicant: Partial<ApplicantData>
  titles: string[]
  skills: string[]
}

/** Regex pass for details every CV states plainly */
export function parseContactDetails(text: string): Partial<ApplicantData> {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || ''
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || ''
  const linkedin = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w-]+\/?/i)?.[0] || ''
  const github = text.match(/(?:https?:\/\/)?github\.com\/[\w-]+\/?/i)?.[0] || ''
  const withScheme = (u: string) => (u && !/^https?:/i.test(u) ? `https://${u}` : u)
  // First non-empty line of a CV is almost always the candidate's name
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l && l.length < 60 && !/@|\d{3}/.test(l)) || ''
  const [firstName = '', ...rest] = firstLine.split(/\s+/)
  return {
    email, phone,
    linkedin: withScheme(linkedin), github: withScheme(github),
    ...(firstLine && /^[\p{L}'. -]+$/u.test(firstLine) ? { firstName, lastName: rest.join(' ') } : {}),
  }
}

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

/** Regex details, enriched by the AI with location, target roles and key skills */
export async function analyzeCv(text: string, generate: Generate | null): Promise<CvInsights> {
  const applicant = parseContactDetails(text)
  const insights: CvInsights = { applicant, titles: [], skills: [] }
  if (!generate) return insights
  try {
    const out = await generate({
      system: 'You extract facts from a CV. Use only what the CV states. Return ONLY JSON.',
      prompt: `CV:\n${text.slice(0, 8000)}\n\nReturn JSON: {"firstName":"","lastName":"","city":"","country":"","titles":["2-4 job titles this person should search for, based on their most recent roles"],"skills":["up to 12 core skills"]}`,
      maxTokens: 500,
    })
    const j = extractJson<{ firstName?: string; lastName?: string; city?: string; country?: string; titles?: string[]; skills?: string[] }>(out)
    if (j) {
      for (const k of ['firstName', 'lastName', 'city', 'country'] as const) {
        if (typeof j[k] === 'string' && j[k]!.trim()) applicant[k] = j[k]!.trim()
      }
      insights.titles = (j.titles || []).filter(t => typeof t === 'string').slice(0, 4)
      insights.skills = (j.skills || []).filter(s => typeof s === 'string').slice(0, 12)
    }
  } catch {
    // regex details are enough to continue
  }
  return insights
}
