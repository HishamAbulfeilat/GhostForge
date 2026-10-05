/**
 * Job Hunter form agent: completes an application on any site, page by page.
 *
 * Each step it reads every visible field, answers from the profile first
 * (contact details, saved answers, standard questions), asks the AI for the
 * rest using ONLY facts in the CV/profile, uploads the CV and cover letter,
 * then presses Next/Continue/Review until it reaches Submit.
 *
 * It stops and hands over (status `needs_user`) instead of guessing when:
 *   - a captcha or a sign-in/account wall appears (never solved or bypassed)
 *   - a required question can't be answered truthfully from the CV/profile —
 *     those come back as `questions`; once the user answers them they are
 *     saved and reused on every later form
 *   - the page stops changing (unknown layout) and no vision fallback helps
 *
 * Optional "computer use": with a vision model, when the DOM approach is stuck
 * it looks at a screenshot and clicks/types like a person would (still never
 * on captchas or logins).
 */
import type { Page } from 'playwright-core'
import { extractJson } from './match'
import { CLOSED_POSTING, detectAts } from './sources'
import type { FieldAnswer, JobProfile, JobRecord } from './store'
import { answerFor, normalizeLabel } from './writer'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>
export type Vision = (imageBase64: string, prompt: string) => Promise<string>

export interface PendingQuestion { label: string; type: string; options: string[] }

export interface AgentContext {
  profile: JobProfile
  job: JobRecord
  /** Cover letter as a file, for upload fields ('' when there is none) */
  coverPath: string
  generate: Generate | null
  /** Press the final Submit when everything required is answered */
  allowSubmit: boolean
  /** Screenshot model for the computer-use fallback (only when the user allowed it) */
  vision?: Vision | null
  log?: (msg: string) => void
  maxSteps?: number
}

export interface AgentOutcome {
  status: 'submitted' | 'needs_user' | 'failed'
  message: string
  filled: string[]
  missing: string[]
  questions: PendingQuestion[]
  /** Answers the AI wrote on this application (shown to the user, not saved as their own) */
  aiAnswers: FieldAnswer[]
  /** The posting is closed ("no longer accepting applications") */
  closed?: boolean
}

interface Field {
  id: string            // data-gf-idx of the element, or "r:<name>" for a radio group
  /** combo = a custom dropdown (react-select, Workday/ARIA listbox) whose options appear when opened */
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'number' | 'date' | 'combo'
  label: string
  required: boolean
  empty: boolean
  invalid: boolean
  options: string[]
}

const CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[title*="captcha" i], .g-recaptcha, .h-captcha, #captcha, [data-sitekey]'
const CONFIRMED = /thank(s| you) for (applying|your application|your interest)|application (has been |was )?(received|submitted|sent|complete)|we('| ha)ve received your application|your application (was|has been) (sent|submitted)|successfully (applied|submitted)/i
const SUBMIT = /^(submit( (my |your )?application)?|send( (my )?application)?|finish( application)?|complete( application)?)$/i
/** "Apply" / "Apply now" submits only when it belongs to a form; on a job page it opens the form. */
const APPLY = /^apply( now)?$/i
const NEXT = /^(next|continue|review( (my |your )?application)?|proceed|save (and|&) continue|next step|continue to (next|application))\b/i
const START = /^(easy apply|apply( (now|manually|for (this|the) (job|position|role)|to (this )?(job|position|role)|on company (site|website)))?|apply for job|i'?m interested|start (my )?application)$/i
/** Upload buttons of custom file pickers that create their file input on click */
const UPLOAD_BUTTON = /^(attach|upload|choose file|select file|browse|add (a )?(file|resume|cv))\b/i
const DECLINE = /decline|prefer not|don'?t wish|do not wish|choose not|not to (say|disclose|answer)|rather not/i
const SENSITIVE = /criminal|convict|felony|arrest|background check|drug (test|screen)|disabilit|veteran|gender|\brace\b|ethnic|sexual|pregnan|religio|marital|\bage\b|date of birth|birth ?date|social security|ssn|passport (number|no)|national id|bank|credit card/i

/** Read the visible form fields inside the active dialog (if any) or the page. */
async function scan(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const st = getComputedStyle(el as HTMLElement)
      // Off-screen (left: -9999px) honeypots are not visible either
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && r.right + scrollX > 0 && r.bottom + scrollY > 0
    }
    // Styled radios/checkboxes hide the input itself; they are shown when their label or group is.
    // Inputs in a hidden step or section have no visible label or group either, so they are skipped.
    const shown = (el: Element) => {
      if (visible(el)) return true
      const id = el.getAttribute('id')
      const label = id ? scope(el).querySelector(`label[for="${CSS.escape(id)}"]`) : null
      return [label, el.closest('label'), el.closest('fieldset, [role="radiogroup"], [role="group"]')].some(x => x && visible(x))
    }
    // querySelectorAll that also walks open shadow roots (SmartRecruiters & co. build forms from web components)
    const deepAll = (root: ParentNode, sel: string): Element[] => {
      const out: Element[] = []
      const walk = (node: ParentNode) => {
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (el.matches(sel)) out.push(el)
          if (el.shadowRoot) walk(el.shadowRoot)
        }
      }
      walk(root)
      return out
    }
    const dialogs = deepAll(document, '[role="dialog"], dialog[open], [aria-modal="true"]').filter(d => visible(d) && d.querySelector('input,select,textarea,button'))
    const root: ParentNode = dialogs[dialogs.length - 1] || document
    // Markers from an earlier step (now hidden) would make the locators ambiguous
    deepAll(document, '[data-gf-idx]').forEach(el => el.removeAttribute('data-gf-idx'))
    const scope = (el: Element) => el.getRootNode() as Document | ShadowRoot
    const text = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()
    /**
     * The label-like element nearest to a control: climbs a few wrappers
     * (Lever's .application-label beside .application-field, Workday's
     * data-automation-id containers) but stops at a wrapper that holds other
     * fields, so a form's first label is never borrowed. `group` = the name of
     * the radio group the control belongs to (its radios don't count as others).
     */
    const nearLabel = (el: Element, group?: string): Element | null => {
      const labelish = 'legend, label, .label, [class*="label"], [class*="question-title"], [class*="questionTitle"]'
      let node = el.parentElement
      for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
        const others = Array.from(node.querySelectorAll('input:not([type="hidden"]), select, textarea'))
          .filter(x => x !== el && !(group && (x as HTMLInputElement).name === group))
        if (others.length) return null
        const found = Array.from(node.querySelectorAll(labelish)).find(x => !x.contains(el) && !x.querySelector('input, select, textarea') && text(x.textContent))
        if (found) return found
      }
      return null
    }
    const labelFor = (el: Element): string => {
      const id = el.getAttribute('id')
      const byFor = id ? scope(el).querySelector(`label[for="${CSS.escape(id)}"]`) : null
      const by = el.getAttribute('aria-labelledby')
      const labelled = by ? by.split(/\s+/).map(x => (scope(el).getElementById?.(x) || document.getElementById(x))?.textContent || '').join(' ') : ''
      // A custom host element (<spl-input label="…">) labels the input in its shadow root
      const host = (el.getRootNode() as ShadowRoot).host
      return text(byFor?.textContent || labelled || el.getAttribute('aria-label') || el.closest('label')?.textContent
        || host?.getAttribute('label') || host?.getAttribute('aria-label')
        || el.closest('fieldset')?.querySelector('legend')?.textContent
        || nearLabel(el)?.textContent
        || el.getAttribute('placeholder') || el.getAttribute('name') || '').slice(0, 200)
    }
    const isRequired = (el: Element, label: string) => (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true'
      || ((el.getRootNode() as ShadowRoot).host?.hasAttribute('required') ?? false) || /[*✱]\s*$|[*✱]\s|\brequired\b/i.test(label)
    const placeholderOption = (s: string) => /^(select|choose|please select|pick|--|—|-)\b/i.test(s.trim()) || !s.trim()
    const out: Array<Record<string, unknown>> = []
    const seenGroups = new Set<string>()
    let idx = 0
    for (const el of deepAll(root, 'input, textarea, select, button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(select)')) {
      const input = el as HTMLInputElement
      // Custom dropdowns: an ARIA combobox input (react-select) or a listbox button (Workday)
      if (el.tagName === 'BUTTON' || (el.getAttribute('role') === 'combobox' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA')) {
        if (!visible(el) || input.disabled || el.getAttribute('aria-disabled') === 'true') continue
        const i = idx++
        el.setAttribute('data-gf-idx', String(i))
        const label = labelFor(el)
        let empty: boolean
        if (el.tagName === 'INPUT') {
          const box = el.closest('[class*="select"], [class*="combobox"], [class*="dropdown"], [class*="field"]')
          const chosen = box?.querySelector('[class*="single-value"], [class*="singleValue"], [class*="selected-value"], [class*="multi-value"]')?.textContent
          const hidden = (box?.querySelector('input[type="hidden"]') as HTMLInputElement | null)?.value
          empty = !input.value && !text(chosen) && !hidden
        } else {
          empty = placeholderOption(text(el.textContent).replace(label, ''))
        }
        out.push({ id: String(i), kind: 'combo', label, required: isRequired(el, label), empty, invalid: el.getAttribute('aria-invalid') === 'true', options: [] })
        continue
      }
      const type = (el.getAttribute('type') || el.tagName).toLowerCase()
      if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue
      // File inputs are usually hidden behind an "Attach" button: they count when their label or wrapper shows
      if (type === 'file' ? !(shown(el) || (el.parentElement && visible(el.parentElement))) : !(type === 'radio' || type === 'checkbox' ? shown(el) : visible(el))) continue
      if (input.disabled || input.readOnly) continue
      const i = idx++
      el.setAttribute('data-gf-idx', String(i))
      if (type === 'radio') {
        const name = input.name || `__radio${i}`
        if (seenGroups.has(name)) continue
        seenGroups.add(name)
        const radios = deepAll(scope(el), `input[type="radio"][name="${CSS.escape(name)}"]`) as HTMLInputElement[]
        const fs = el.closest('fieldset')
        const groupLabel = text(fs?.querySelector('legend')?.textContent || fs?.getAttribute('aria-label') || el.closest('[role="radiogroup"]')?.getAttribute('aria-label')
          || nearLabel(el, name)?.textContent || name)
        out.push({
          id: `r:${name}`, kind: 'radio', label: groupLabel.slice(0, 200),
          required: radios.some(r => r.required) || el.closest('[aria-required="true"]') !== null || /[*✱]/.test(groupLabel),
          empty: !radios.some(r => r.checked), invalid: radios.some(r => r.getAttribute('aria-invalid') === 'true'),
          options: radios.map(r => text((r.id && scope(r).querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent) || r.closest('label')?.textContent || r.value)),
        })
        continue
      }
      const label = labelFor(el)
      const select = el.tagName === 'SELECT' ? el as HTMLSelectElement : null
      const selectedText = select ? text(select.options[select.selectedIndex]?.text) : ''
      out.push({
        id: String(i),
        kind: type === 'textarea' ? 'textarea' : select ? 'select' : type === 'checkbox' ? 'checkbox' : type === 'file' ? 'file' : type === 'number' ? 'number' : type === 'date' ? 'date' : 'text',
        label,
        required: isRequired(el, label),
        // LinkedIn & co. preselect a placeholder option such as "Select an option"
        empty: select ? (!select.value || placeholderOption(selectedText)) : type === 'checkbox' ? !input.checked : type === 'file' ? !(input.files && input.files.length) : !input.value,
        invalid: el.getAttribute('aria-invalid') === 'true',
        options: select ? Array.from(select.options).map(o => text(o.text)).filter(o => !placeholderOption(o)) : [],
      })
    }
    return out
  }) as unknown as Promise<Field[]>
}

/** Visible buttons in the active dialog/page, with their text. */
async function buttons(page: Page): Promise<Array<{ idx: number; text: string; inForm: boolean }>> {
  return page.evaluate(() => {
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const deepAll = (root: ParentNode, sel: string): Element[] => {
      const out: Element[] = []
      const walk = (node: ParentNode) => {
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (el.matches(sel)) out.push(el)
          if (el.shadowRoot) walk(el.shadowRoot)
        }
      }
      walk(root)
      return out
    }
    const dialogs = deepAll(document, '[role="dialog"], dialog[open], [aria-modal="true"]').filter(d => visible(d) && d.querySelector('button'))
    const root: ParentNode = dialogs[dialogs.length - 1] || document
    deepAll(document, '[data-gf-btn]').forEach(el => el.removeAttribute('data-gf-btn'))
    return deepAll(root, 'button, input[type="submit"], input[type="button"], a[role="button"], a[href]')
      // Dropdown triggers are fields, not navigation
      .filter(el => el.getAttribute('aria-haspopup') !== 'listbox')
      .filter(el => visible(el) && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true')
      // Real buttons first, so "Continue" on a form wins over a "Continue reading" link
      .sort((a, b) => Number(a.tagName === 'A' && !a.getAttribute('role')) - Number(b.tagName === 'A' && !b.getAttribute('role')))
      .map((el, i) => {
        el.setAttribute('data-gf-btn', String(i))
        const t = (el.getAttribute('aria-label') || (el as HTMLInputElement).value || el.textContent || '').replace(/\s+/g, ' ').trim()
        const form = el.closest('form, [role="dialog"], dialog') || ((el.getRootNode() as ShadowRoot).host ? el.getRootNode() as ShadowRoot : null)
        const inForm = Boolean(form && deepAll(form, 'input:not([type="hidden"]):not([type="search"]):not([type="submit"]):not([type="button"]), textarea, select').length >= 2)
        return { idx: i, text: t.slice(0, 80), inForm }
      })
  })
}

const loc = (page: Page, f: Field) => page.locator(`[data-gf-idx="${f.id}"]`)

function bestOption(options: string[], value: string): string | undefined {
  const v = value.trim().toLowerCase()
  if (!v) return undefined
  return options.find(o => o.toLowerCase() === v)
    || (DECLINE.test(v) ? options.find(o => DECLINE.test(o)) : undefined)
    || options.find(o => new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(o))
    || options.find(o => o.toLowerCase().includes(v) && v.length > 2)
    || options.find(o => v.includes(o.toLowerCase()) && o.length > 2)
}

const OPTIONS = '[role="option"]:visible, [role="listbox"] li:visible'
const optionText = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Open a custom dropdown and read its options (then close it again). */
async function comboOptions(page: Page, f: Field, typed = ''): Promise<string[]> {
  const l = loc(page, f)
  await l.click({ timeout: 5000 })
  if (typed && await l.evaluate(el => el.tagName === 'INPUT')) await l.fill(typed)
  await page.locator(OPTIONS).first().waitFor({ timeout: 2000 }).catch(() => {})
  return (await page.locator(OPTIONS).allInnerTexts()).map(optionText).filter(Boolean).slice(0, 60)
}

/** Pick the option matching `value` in a custom dropdown. */
async function setCombo(page: Page, f: Field, value: string): Promise<boolean> {
  // Typing narrows autocomplete lists (location, school); short answers like "Yes" are picked from the full list
  const isInput = await loc(page, f).evaluate(el => el.tagName === 'INPUT')
  let options = await comboOptions(page, f, isInput && value.length > 3 ? value : '')
  let opt = bestOption(options, value)
  if (!opt && isInput && value.length > 3) {
    options = await comboOptions(page, f, value.split(/[,(]/)[0].trim())
    opt = bestOption(options, value)
  }
  if (!opt) { await page.keyboard.press('Escape').catch(() => {}); return false }
  const all = page.locator(OPTIONS)
  const n = await all.count()
  for (let i = 0; i < n; i++) {
    if (optionText(await all.nth(i).innerText()) === opt) { await all.nth(i).click({ timeout: 5000 }); return true }
  }
  return false
}

/** Put a value into a field. Returns true when it took. */
async function setField(page: Page, f: Field, value: string): Promise<boolean> {
  try {
    if (f.kind === 'combo') return await setCombo(page, f, value)
    if (f.kind === 'select') {
      const opt = bestOption(f.options, value)
      if (!opt) return false
      await loc(page, f).selectOption({ label: opt })
      return true
    }
    if (f.kind === 'radio') {
      const opt = bestOption(f.options, value)
      if (!opt) return false
      const name = f.id.slice(2)
      const radios = page.locator(`input[type="radio"][name="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
      const n = await radios.count()
      for (let i = 0; i < n; i++) {
        const r = radios.nth(i)
        const text = await r.evaluate(el => ((el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.closest('label')?.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim())
        if (text === opt) { await r.check({ force: true }); return true }
      }
      return false
    }
    if (f.kind === 'checkbox') {
      if (/^(yes|true|checked|agree)/i.test(value)) { await loc(page, f).check({ force: true }); return true }
      return false
    }
    if (f.kind === 'number') {
      const n = value.match(/-?\d+(\.\d+)?/)?.[0]
      if (!n) return false
      await loc(page, f).fill(n)
      return true
    }
    const l = loc(page, f)
    await l.fill(value)
    // Autocomplete inputs (city, school…) need a suggestion picked
    const listbox = page.locator('[role="listbox"] [role="option"]').first()
    if (await listbox.isVisible({ timeout: 600 }).catch(() => false)) await listbox.click().catch(() => {})
    return true
  } catch {
    return false
  }
}

/** Ask the model for answers it can ground in the CV/profile; "ASK" means the user must answer. */
async function aiAnswers(fields: Field[], ctx: AgentContext): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ctx.generate || !fields.length) return out
  const a = ctx.profile.applicant
  const prefs = ctx.profile.preferences
  const facts = [
    `Name: ${a.firstName} ${a.lastName}`, `Email: ${a.email}`, `Phone: ${a.phone}`, `Location: ${[a.city, a.country].filter(Boolean).join(', ')}`,
    a.linkedin && `LinkedIn: ${a.linkedin}`, a.github && `GitHub: ${a.github}`, a.portfolio && `Portfolio: ${a.portfolio}`,
    a.workAuthorized && `Authorized to work where they live: ${a.workAuthorized}`, a.needsSponsorship && `Needs visa sponsorship: ${a.needsSponsorship}`,
    prefs.minSalary ? `Minimum acceptable salary: ${prefs.minSalary}` : '',
    prefs.remote !== 'any' ? `Work preference: ${prefs.remote}` : '',
    ...Object.entries(ctx.profile.customAnswers).map(([q, v]) => `Previously answered "${q}": ${v}`),
  ].filter(Boolean).join('\n')
  const list = fields.map((f, i) => `[${i}] (${f.kind}${f.required ? ', required' : ''}) ${f.label}${f.options.length ? ` — options: ${f.options.slice(0, 15).join(' | ')}` : ''}`).join('\n')
  try {
    const text = await ctx.generate({
      system: `You fill in a job application for a real person. Answer each question ONLY with facts from their CV and profile below.
- Years of experience with a skill: count from the CV's dates for roles that clearly used it; if the CV doesn't show it, answer "ASK".
- Yes/No skill or experience questions: "Yes" only if the CV shows it; if it clearly doesn't, "No"; if unsure, "ASK".
- Never invent employers, degrees, certifications, numbers, salaries, notice periods or availability. Never answer legal, criminal, medical, demographic, identity-document or background-check questions: answer "ASK" (except EEO self-identification, which is "Decline to self-identify" or the closest decline option).
- Short "why this company/role" or "summary" text questions: write 2-4 honest sentences from the CV and the job, no clichés.
- For options, answer with one option exactly as written.
Return ONLY JSON: [{"i": <index>, "value": "<answer or ASK>"}]`,
      prompt: `PROFILE:\n${facts}\n\nCV:\n${(ctx.profile.cv?.text || '').slice(0, 9000)}\n\nJOB: ${ctx.job.title} at ${ctx.job.company}\n${ctx.job.description.slice(0, 2500)}\n\nQUESTIONS:\n${list}`,
      maxTokens: 1500,
    })
    for (const r of extractJson<Array<{ i: number; value: string }>>(text) || []) {
      const f = fields[r?.i]
      const v = typeof r?.value === 'string' ? r.value.trim() : ''
      if (!f || !v || /^ask$/i.test(v)) continue
      // The model is told not to, but double-check: sensitive questions are the user's to answer
      if (SENSITIVE.test(f.label) && !DECLINE.test(v)) continue
      out.set(f.id, v.slice(0, 2000))
    }
  } catch { /* unanswered fields become questions for the user */ }
  return out
}

/** Computer-use fallback: one screenshot → one action. Returns false when it can't help. */
async function visionStep(page: Page, ctx: AgentContext, goal: string): Promise<boolean> {
  if (!ctx.vision) return false
  const shot = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64')
  const vp = page.viewportSize() || { width: 1280, height: 800 }
  const raw = await ctx.vision(shot, `You are operating a web browser to complete a job application for ${ctx.profile.applicant.firstName} ${ctx.profile.applicant.lastName} (job: ${ctx.job.title} at ${ctx.job.company}). Goal: ${goal}
The screenshot is ${vp.width}x${vp.height} pixels. Reply with ONLY JSON, one action:
{"action":"click","x":<px>,"y":<px>,"why":"..."} | {"action":"type","text":"...","why":"..."} | {"action":"scroll","why":"..."} | {"action":"stop","why":"..."}
Use "stop" for captchas, sign-in or account-creation pages, anything needing a password, or questions you can't answer from the application itself. Never type facts that aren't the applicant's.`).catch(() => '')
  const act = extractJson<{ action?: string; x?: number; y?: number; text?: string; why?: string }>(raw)
  if (!act?.action || act.action === 'stop') return false
  ctx.log?.(`Computer use: ${act.action}${act.why ? ` (${String(act.why).slice(0, 80)})` : ''}`)
  if (act.action === 'click' && Number.isFinite(act.x) && Number.isFinite(act.y)) {
    await page.mouse.click(Math.max(0, Math.min(vp.width - 1, Number(act.x))), Math.max(0, Math.min(vp.height - 1, Number(act.y))))
  } else if (act.action === 'type' && act.text) {
    await page.keyboard.type(String(act.text).slice(0, 500))
  } else if (act.action === 'scroll') {
    await page.mouse.wheel(0, 600)
  } else return false
  await page.waitForTimeout(1500)
  return true
}

async function blocked(page: Page): Promise<string | null> {
  if (await page.locator(CAPTCHA).count().catch(() => 0)) return 'captcha'
  const url = page.url()
  if (/\/(login|signin|sign-in|authwall|checkpoint|uas\/login)\b/i.test(url)) return 'login'
  const password = await page.locator('input[type="password"]:visible').count().catch(() => 0)
  if (password) return 'login'
  return null
}

const bodyText = (page: Page) => page.evaluate(() => document.body?.innerText || '').catch(() => '')

/**
 * A confirmation that was not on the page before we pressed Submit. Job
 * descriptions often say "Thank you for your interest in …", which must not
 * count as a submitted application.
 */
export function isNewConfirmation(before: string, after: string): boolean {
  const re = new RegExp(CONFIRMED.source, 'gi')
  const was: string[] = before.match(re) || []
  const now = after.match(re) || []
  const seen = new Set(was)
  return now.length > was.length || now.some(m => !seen.has(m))
}

/**
 * Run the agent on an open page (already navigated to the job or its form).
 * The caller owns the browser; this never closes it.
 */
export async function runFormAgent(page: Page, ctx: AgentContext): Promise<AgentOutcome> {
  const filled: string[] = []
  const aiUsed: FieldAnswer[] = []
  const maxSteps = ctx.maxSteps ?? 15
  let lastSignature = ''
  let stuckCount = 0
  let resumeUploaded = false
  let visionTries = 0
  // Page text just before we pressed Submit (or let computer use act); null until then
  let beforeSubmit: string | null = null
  const opened = new Set<string>()
  const outcome = (status: AgentOutcome['status'], message: string, missing: string[] = [], questions: PendingQuestion[] = []): AgentOutcome =>
    ({ status, message, filled, missing, questions, aiAnswers: aiUsed })

  // A site may open the form in a new tab; follow it.
  let current = page
  page.context().on('page', p => { current = p })

  for (let step = 0; step < maxSteps; step++) {
    const pg = current
    await pg.waitForLoadState('domcontentloaded').catch(() => {})
    await pg.waitForTimeout(800)
    if (beforeSubmit !== null && isNewConfirmation(beforeSubmit, await bodyText(pg))) return outcome('submitted', `Submitted to ${ctx.job.company} (${filled.length} fields filled).`)
    const wall = await blocked(pg)
    if (wall === 'captcha') return outcome('needs_user', 'This form has a captcha. Solve it and press Submit; everything else is filled in.')
    if (wall === 'login') {
      const signUp = /create (an |your )?account|sign up|register|verify (new )?password/i.test(await bodyText(pg))
      return outcome('needs_user', signUp
        ? `${new URL(pg.url()).hostname} asks you to create an account before applying. GhostForge never creates accounts or passwords for you: create it once in the GhostForge browser, and the next attempt continues signed in.`
        : `${new URL(pg.url()).hostname} wants you to sign in first. Sign in once in the GhostForge browser and the next attempt continues from there.`)
    }

    const fields = await scan(pg)
    const btns = await buttons(pg)
    const looksLikeForm = fields.some(f => f.kind === 'file' || (f.kind !== 'checkbox' && f.required))

    if (!fields.length && CLOSED_POSTING.test(await bodyText(pg))) {
      return { ...outcome('failed', 'This posting is closed: the site says it no longer accepts applications.'), closed: true }
    }

    // Career sites often embed the ATS form in an iframe (Greenhouse, iCIMS, Workable…):
    // open the form itself, once. Only known ATS hosts are followed.
    if (!looksLikeForm) {
      const embed = (await pg.locator('iframe[src]').evaluateAll(els => els.map(e => (e as HTMLIFrameElement).src)).catch(() => [] as string[]))
        .find(src => !['other', 'linkedin'].includes(detectAts(src)) && !opened.has(`frame|${src}`))
      if (embed) {
        opened.add(`frame|${embed}`)
        ctx.log?.(`Opening the embedded application form (${new URL(embed).hostname})`)
        await pg.goto(embed, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
        continue
      }
    }

    // Job page, not the form yet (at most a search or newsletter box): press the
    // site's own Apply / Easy Apply button, once per page.
    if (!looksLikeForm) {
      const start = btns.find(b => START.test(b.text) && !b.inForm)
      const key = start ? `${pg.url()}|${start.text}` : ''
      if (start && !opened.has(key)) {
        opened.add(key)
        ctx.log?.(`Opening the form (${start.text})`)
        await pg.locator(`[data-gf-btn="${start.idx}"]`).click({ timeout: 10_000 }).catch(() => {})
        await pg.waitForTimeout(2000)
        continue
      }
    }

    // 1. Answer what the profile already knows.
    const unknown: Field[] = []
    for (const f of fields) {
      if (f.kind === 'file') {
        if (!f.empty) { if (/resume|cv/i.test(f.label)) resumeUploaded = true; continue }
        const wantsCover = /cover/i.test(f.label)
        const path = wantsCover ? ctx.coverPath : (/resume|cv|curriculum/i.test(f.label) || (!resumeUploaded && (f.required || fields.filter(x => x.kind === 'file').length === 1))) ? ctx.profile.cv?.filePath : ''
        if (path) {
          try { await loc(pg, f).setInputFiles(path); filled.push(wantsCover ? 'Cover letter upload' : 'Resume upload'); if (!wantsCover) resumeUploaded = true } catch { /* custom uploader */ }
        }
        continue
      }
      if (!f.empty && !f.invalid) continue
      if (f.kind === 'checkbox') {
        if (/privacy|consent|agree|acknowledg|terms|certify|confirm (that )?(the )?information/i.test(f.label)) {
          if (await setField(pg, f, 'yes')) filled.push(f.label)
        }
        continue
      }
      if (f.kind === 'textarea' && ctx.job.coverLetter && /cover letter|additional information|anything else|message to (the )?(hiring|recruit)/i.test(f.label)) {
        if (await setField(pg, f, ctx.job.coverLetter)) { filled.push(f.label || 'Cover letter'); continue }
      }
      const value = answerFor(f.label, ctx.profile, ctx.job)
      if (value && await setField(pg, f, value)) { filled.push(f.label); continue }
      unknown.push(f)
    }

    // Custom uploaders that only create their file input when the button is pressed
    if (!resumeUploaded && ctx.profile.cv?.filePath && fields.length && !fields.some(f => f.kind === 'file')) {
      const upload = btns.find(b => UPLOAD_BUTTON.test(b.text) && !opened.has(`upload|${pg.url()}|${b.text}`))
      if (upload) {
        opened.add(`upload|${pg.url()}|${upload.text}`)
        const chooser = pg.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null)
        await pg.locator(`[data-gf-btn="${upload.idx}"]`).click({ timeout: 5000 }).catch(() => {})
        const fc = await chooser
        if (fc) { await fc.setFiles(ctx.profile.cv.filePath).then(() => { filled.push('Resume upload'); resumeUploaded = true }).catch(() => {}) }
      }
    }

    // Custom dropdowns show their options only when opened: read them so answers can match
    for (const f of unknown) {
      if (f.kind === 'combo' && !f.options.length) {
        f.options = await comboOptions(pg, f).catch(() => [])
        await pg.keyboard.press('Escape').catch(() => {})
      }
    }

    // 2. Ask the AI for the rest (grounded in the CV); never for sensitive questions.
    const answerable = unknown.filter(f => !SENSITIVE.test(f.label) || /gender|race|ethnic|veteran|disabilit|sexual/i.test(f.label))
    const ai = await aiAnswers(answerable, ctx)
    for (const f of unknown) {
      const v = ai.get(f.id)
      if (v && await setField(pg, f, v)) { filled.push(f.label); aiUsed.push({ label: f.label, value: v }) }
    }

    // 3. Anything required still empty is a question for the user.
    await pg.waitForTimeout(300)
    const after = await scan(pg)
    const missing = after.filter(f => (f.required || f.invalid) && f.empty && f.kind !== 'file')
    const missingFile = after.filter(f => f.required && f.empty && f.kind === 'file')
    if (missing.length || missingFile.length) {
      const questions = missing.map(f => ({ label: normalizeLabel(f.label) || 'Unlabelled field', type: f.kind, options: f.options.slice(0, 20) }))
      return outcome('needs_user', `${questions.length + missingFile.length} question(s) need your answer. Answer them once and they are reused on every later application.`, [...questions.map(q => q.label), ...missingFile.map(f => f.label || 'File upload')], questions)
    }

    // 4. Move on: Submit, or Next/Continue/Review.
    const submit = btns.find(b => SUBMIT.test(b.text) || /submit application|send application/i.test(b.text) || (APPLY.test(b.text) && b.inForm))
    const next = btns.find(b => NEXT.test(b.text))
    if (submit) {
      if (!ctx.allowSubmit) return outcome('needs_user', 'Everything is filled in and ready. Review it and press Submit.')
      ctx.log?.(`Submitting (${submit.text})`)
      const before = await bodyText(pg)
      beforeSubmit = before
      await pg.locator(`[data-gf-btn="${submit.idx}"]`).click({ timeout: 10_000 })
      const ok = await pg.waitForFunction(([re, prev]) => {
        const rx = new RegExp(re, 'gi')
        const was: string[] = prev.match(rx) || []
        const now = (document.body?.innerText || '').match(rx) || []
        const seen = new Set(was)
        return now.length > was.length || now.some(m => !seen.has(m))
      }, [CONFIRMED.source, before] as const, { timeout: 25_000 }).then(() => true).catch(() => false)
      if (ok) return outcome('submitted', `Submitted to ${ctx.job.company} (${filled.length} fields filled).`)
      // Some sites show errors instead of confirming (or confirm on a new page): loop once more to read them
      await pg.waitForTimeout(1000)
      if (isNewConfirmation(before, await bodyText(current))) return outcome('submitted', `Submitted to ${ctx.job.company} (${filled.length} fields filled).`)
      stuckCount++
      if (stuckCount > 2) return outcome('needs_user', 'Submit was pressed but no confirmation appeared. Check the application in the browser.')
      continue
    }
    if (next) {
      const signature = `${pg.url()}|${after.map(f => f.label).join('|')}|${btns.map(b => b.text).join('|')}`
      if (signature === lastSignature) stuckCount++
      else { stuckCount = 0; lastSignature = signature }
      if (stuckCount < 2) {
        ctx.log?.(`Next page (${next.text})`)
        await pg.locator(`[data-gf-btn="${next.idx}"]`).click({ timeout: 10_000 }).catch(() => {})
        await pg.waitForTimeout(1500)
        continue
      }
    }

    // 5. Stuck: let computer use try, else hand over.
    const beforeVision = await bodyText(pg)
    if (visionTries < 6 && await visionStep(pg, ctx, 'reach and complete the application form, then stop before any final submit you are unsure about')) {
      beforeSubmit ??= beforeVision // computer use may have pressed Submit itself
      visionTries++
      continue
    }
    return outcome('needs_user', 'The form uses a layout GhostForge could not finish on its own. It is pre-filled; finish it in the browser.')
  }
  return outcome('needs_user', 'The application has more steps than expected. It is pre-filled; finish it in the browser.')
}
