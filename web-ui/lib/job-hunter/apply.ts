/**
 * Application form filler — runs after the user approves a prepared job.
 *
 * Opens the form in the host's Chrome/Edge (visible by default so the user can
 * watch), fills every field it can answer from the profile, uploads the
 * original CV, and pastes/uploads the cover letter.
 *
 * It only presses Submit when all of these hold:
 *   - the ATS is one with predictable single-page forms (Lever, Greenhouse, Ashby)
 *   - every required field has a value
 *   - no captcha is present
 * Otherwise the pre-filled form is left open and the job is marked
 * `needs_user`. LinkedIn and Workday always need the user (login walls and
 * LinkedIn's automation rules).
 */
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { JobProfile, JobRecord } from './store'
import { userDir } from './store'
import { answerFor } from './writer'

export interface ApplyResult {
  status: 'submitted' | 'needs_user' | 'failed'
  message: string
  filled: string[]
  missing: string[]
}

const AUTO_SUBMIT_ATS = new Set(['lever', 'greenhouse', 'ashby'])

// Browsers left open for the user to finish — keep a reference so they aren't collected
const openBrowsers = new Set<{ close(): Promise<void> }>()

/**
 * Apply URLs come from third-party job boards. Only open public http(s)
 * pages — never localhost, the LAN, or other schemes a hostile listing
 * could use to point the browser at this machine.
 */
export function isSafeApplyUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false
  return true
}

/** Loopback, private, link-local, CGNAT and unspecified addresses (v4 and v6) */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.toLowerCase()
  if (a.includes(':')) {
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || /^fe[89ab]/.test(a)
  }
  const [p, q] = a.split('.').map(Number)
  return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31)
    || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127)
}

/**
 * The hostname check above only sees the name. Resolve every A/AAAA record so
 * a public-looking name that points at this machine or the LAN is rejected too.
 */
export async function resolvesPublicly(raw: string, lookup = async (host: string) => {
  const { lookup: dnsLookup } = await import('dns/promises')
  return (await dnsLookup(host, { all: true })).map(r => r.address)
}): Promise<boolean> {
  if (!isSafeApplyUrl(raw)) return false
  try {
    const addresses = await lookup(new URL(raw).hostname.replace(/^\[|\]$/g, ''))
    return addresses.length > 0 && !addresses.some(isPrivateAddress)
  } catch {
    return false
  }
}

function formUrl(job: JobRecord): string {
  if (job.ats === 'lever') return job.applyUrl.endsWith('/apply') ? job.applyUrl : `${job.applyUrl.replace(/\/$/, '')}/apply`
  if (job.ats === 'ashby' && !/\/application\/?$/.test(job.applyUrl)) return `${job.applyUrl.replace(/\/$/, '')}/application`
  return job.applyUrl || job.url
}

async function launchBrowser(headless: boolean) {
  const { chromium } = await import('playwright-core')
  const executablePath = process.env.JOB_HUNTER_BROWSER
  if (executablePath) return chromium.launch({ executablePath, headless })
  let lastError: unknown
  for (const channel of ['chrome', 'msedge', 'chromium']) {
    try {
      return await chromium.launch({ channel, headless })
    } catch (e) {
      lastError = e
    }
  }
  throw new Error(`No Chrome or Edge found for form filling (set JOB_HUNTER_BROWSER to a browser path). ${String(lastError).slice(0, 120)}`)
}

interface ScannedField {
  idx: number
  label: string
  tag: string
  type: string
  required: boolean
  hasValue: boolean
  options: string[]
}

export async function applyToJob(job: JobRecord, profile: JobProfile, username: string): Promise<ApplyResult> {
  if (!(await resolvesPublicly(formUrl(job)))) {
    return { status: 'failed', message: 'This listing\'s application link is not a public web address, so it was not opened.', filled: [], missing: [] }
  }
  const headless = process.env.JOB_HUNTER_HEADLESS === '1'
  const browser = await launchBrowser(headless)
  const page = await browser.newPage()
  const filled: string[] = []
  const keepOpen = (message: string, missing: string[] = []): ApplyResult => {
    if (headless) void browser.close()
    else openBrowsers.add(browser)
    return { status: 'needs_user', message, filled, missing }
  }

  try {
    await page.goto(formUrl(job), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2500)

    if (job.ats === 'linkedin') return keepOpen('LinkedIn applications are finished by you — the listing is open in the browser. Your answers are in the Review panel.')
    if (job.ats === 'workday') return keepOpen('Workday needs you to sign in first. The form is open; sign in and GhostForge answers are in the Review panel.')

    // Write the cover letter to a file for upload fields
    const docsDir = join(userDir(username), 'applications', job.id)
    await mkdir(docsDir, { recursive: true })
    let coverPath = ''
    if (job.coverLetter) {
      coverPath = join(docsDir, 'cover-letter.txt')
      await writeFile(coverPath, job.coverLetter, 'utf8')
    }

    // Tag every visible field with an index and read its label (runs in the page)
    const fields: ScannedField[] = await page.evaluate(() => {
      const labelFor = (el: Element): string => {
        const id = el.getAttribute('id')
        const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null
        const txt = (byFor?.textContent || el.getAttribute('aria-label') || el.closest('label')?.textContent
          || el.closest('fieldset')?.querySelector('legend')?.textContent
          || el.closest('[class*="field"],[class*="question"],li,div')?.querySelector('label,.label,[class*="label"]')?.textContent
          || el.getAttribute('placeholder') || el.getAttribute('name') || '')
        return txt.replace(/\s+/g, ' ').trim().slice(0, 160)
      }
      const els = Array.from(document.querySelectorAll('input, textarea, select'))
        .filter(el => {
          const t = (el.getAttribute('type') || '').toLowerCase()
          if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) return false
          const r = (el as HTMLElement).getBoundingClientRect()
          return t === 'file' || (r.width > 0 && r.height > 0)
        })
      return els.map((el, idx) => {
        el.setAttribute('data-gf-idx', String(idx))
        const input = el as HTMLInputElement
        return {
          idx,
          label: labelFor(el),
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute('type') || el.tagName).toLowerCase(),
          required: input.required || el.getAttribute('aria-required') === 'true' || /\*/.test(labelFor(el)),
          hasValue: input.type === 'checkbox' || input.type === 'radio' ? input.checked : Boolean(input.value),
          options: el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(o => o.text.trim()) : [],
        }
      })
    })

    const handledRadioGroups = new Set<string>()
    for (const f of fields) {
      const loc = page.locator(`[data-gf-idx="${f.idx}"]`)
      const label = f.label

      try {
        if (f.type === 'file') {
          if (/resume|cv|curriculum/i.test(label) && profile.cv?.filePath) {
            await loc.setInputFiles(profile.cv.filePath); filled.push('Resume upload')
          } else if (/cover/i.test(label) && coverPath) {
            await loc.setInputFiles(coverPath); filled.push('Cover letter upload')
          }
          continue
        }
        if (f.hasValue) continue

        if (f.tag === 'textarea' && /cover letter|additional information|anything else|comments|message to/i.test(label) && job.coverLetter) {
          await loc.fill(job.coverLetter); filled.push(label || 'Cover letter'); continue
        }

        if (f.type === 'checkbox') {
          if (/privacy|consent|agree|acknowledg|terms|certify/i.test(label)) { await loc.check(); filled.push(label) }
          continue
        }

        const value = answerFor(label, profile, job)
        if (!value) continue

        if (f.type === 'radio') {
          const group = await loc.getAttribute('name') || label
          if (handledRadioGroups.has(group)) continue
          // Escape backslashes before quotes so the attribute selector can't be broken out of
          const radios = page.locator(`input[type="radio"][name="${group.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
          const n = await radios.count()
          for (let i = 0; i < n; i++) {
            const r = radios.nth(i)
            const rLabel = await r.evaluate(el => (el.closest('label')?.textContent || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || (el as HTMLInputElement).value || '').trim())
            if (rLabel.toLowerCase().startsWith(value.toLowerCase().slice(0, 3))) { await r.check(); handledRadioGroups.add(group); filled.push(label); break }
          }
          continue
        }

        if (f.tag === 'select') {
          const match = f.options.find(o => o.toLowerCase() === value.toLowerCase())
            || f.options.find(o => o.toLowerCase().includes(value.toLowerCase()))
            || f.options.find(o => value.toLowerCase().includes(o.toLowerCase()) && o.length > 2)
          if (match) { await loc.selectOption({ label: match }); filled.push(label) }
          continue
        }

        await loc.fill(value)
        filled.push(label)
      } catch {
        // field not fillable (custom widget) — reported below if required
      }
    }

    // Re-check which required fields are still empty
    const missing: string[] = await page.evaluate(() => Array.from(document.querySelectorAll('[data-gf-idx]'))
      .filter(el => {
        const i = el as HTMLInputElement
        const required = i.required || el.getAttribute('aria-required') === 'true'
        if (!required) return false
        if (i.type === 'checkbox') return !i.checked
        if (i.type === 'radio') return !document.querySelector(`input[type="radio"][name="${CSS.escape(i.name)}"]:checked`)
        if (i.type === 'file') return !(i.files && i.files.length)
        return !i.value
      })
      .map(el => {
        const id = el.getAttribute('id')
        return ((id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || el.getAttribute('aria-label') || el.getAttribute('name') || 'field').replace(/\s+/g, ' ').trim()
      }))
    const uniqueMissing = [...new Set(missing)]

    const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha').count()
    if (captcha) return keepOpen('This form has a captcha — solve it and press Submit in the open browser.', uniqueMissing)
    if (!AUTO_SUBMIT_ATS.has(job.ats)) return keepOpen('Form pre-filled. This site isn\'t on the auto-submit list — review it and press Submit.', uniqueMissing)
    if (uniqueMissing.length) return keepOpen(`Pre-filled ${filled.length} fields; ${uniqueMissing.length} required question(s) need you.`, uniqueMissing)

    const submit = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit application"), button:has-text("Submit")').first()
    await submit.click({ timeout: 10_000 })
    const confirmed = await page.waitForFunction(
      () => /thank you|application (has been )?(received|submitted)|we('| ha)ve received/i.test(document.body.innerText),
      undefined, { timeout: 25_000 },
    ).then(() => true).catch(() => false)

    if (!confirmed) return keepOpen('Submit was pressed but no confirmation appeared — check the open browser.', [])
    await browser.close()
    return { status: 'submitted', message: `Submitted to ${job.company} (${filled.length} fields filled).`, filled, missing: [] }
  } catch (e) {
    await browser.close().catch(() => {})
    return { status: 'failed', message: `Form filling failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`, filled, missing: [] }
  }
}
