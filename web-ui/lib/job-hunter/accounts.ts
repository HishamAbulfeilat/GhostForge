import type { Locator, Page } from 'playwright-core'
import { resolvesPublicly, withProfileLock } from './apply'
import { applicationPage, trackApplicationPage, updateApplicationActivity } from './live'
import { getJob, getProfile, updateJob, withJobOperation, type JobProfile } from './store'
import { notifyJob } from './notifications'
import { isConsentOrLegal } from './writer'

export class AccountAssistanceError extends Error {}

export type AccountMode = 'login' | 'fill-signup' | 'open-signup' | 'register'
export interface AccountRequest {
  mode: AccountMode
  origin: string
  consent: true
  email?: string
  password?: string
}

const CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, #captcha, [data-sitekey]'
const SIGNUP = /^(create (an? )?account|sign up|register|create profile)$/i
const LOGIN = /^(sign in|log in|login|sign me in)$/i
/**
 * Terms/privacy consent that the account action itself would give. Only
 * wording that agrees to something counts: "By creating an account you agree
 * to…", "I accept the terms". Bare "Terms" / "Privacy Policy" / "User
 * Agreement" links (page footers, navigation) are on almost every site and
 * accept nothing, so they no longer block sign-in assistance.
 */
const IMPLICIT_CONSENT = /\bby (creating|registering|signing|logging|continuing|clicking|tapping|submitting|proceeding|joining)\b.{0,160}?\b(agree|accept|consent|acknowledg|certif|attest|terms|privacy|polic(y|ies))/i
const EXPLICIT_CONSENT = /\bI (have read and |hereby |fully )?(agree|accept|consent|acknowledge)\b|\b(read|reviewed) and (agree|accept)\b/i
/** A button that would accept terms: "I agree", "Accept terms", "Agree and continue". */
const CONSENT_BUTTON = /^\s*(i\s+)?(agree|accept|consent)\b|\b(agree|accept|consent)\w* (to )?(the |our |all )?(terms|conditions|privacy|polic(y|ies)|user agreement|eula)\b/i
const COOKIES = /\bcookie/i
const ACCOUNT_CONFIRMED = /\b(account (has been |was )?(successfully )?(created|registered)|registration (successful|complete)|successfully (registered|created (your |an? )?account))\b/i

export function accountRequest(value: unknown): AccountRequest {
  if (!value || typeof value !== 'object') throw new Error('Account details required.')
  const body = value as Record<string, unknown>
  if (!['login', 'fill-signup', 'open-signup', 'register'].includes(String(body.mode)) || body.consent !== true)
    throw new Error('Choose an account action and explicitly approve the website.')
  if (typeof body.origin !== 'string') throw new Error('Website origin required.')
  const origin = new URL(body.origin)
  if (origin.protocol !== 'https:' || origin.origin !== body.origin || origin.username || origin.password)
    throw new Error('Approve an exact HTTPS website origin, without a path or credentials.')
  const mode = body.mode as AccountMode
  if (mode === 'open-signup') return { mode, origin: body.origin, consent: true }
  if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    throw new Error('Enter the email address for this website account.')
  if (typeof body.password !== 'string' || !body.password || body.password.length > 512)
    throw new Error('Enter a password of at most 512 characters.')
  return { mode, origin: body.origin, consent: true, email: body.email, password: body.password }
}

async function assertOrigin(page: Page, origin: string) {
  if (page.isClosed() || new URL(page.url()).origin !== origin)
    throw new AccountAssistanceError('The application website changed. Review its new origin before entering credentials.')
}

async function one(locator: Locator, message: string): Promise<Locator> {
  if (await locator.count() !== 1) throw new AccountAssistanceError(message)
  return locator
}

async function assertForm(form: Locator, origin: string) {
  const target = await form.evaluate(el => {
    const f = el as HTMLFormElement
    return { action: f.action, method: f.method }
  })
  const action = new URL(target.action)
  if (action.origin !== origin || action.username || action.password || target.method.toLowerCase() !== 'post')
    throw new AccountAssistanceError('This account form has an unsupported or cross-site submission target. Complete it in the browser.')
}

async function optionalFill(form: Locator, selector: string, value: string) {
  if (!value) return
  const input = form.locator(selector)
  const count = await input.count()
  if (count > 1) throw new AccountAssistanceError('Account fields are ambiguous. Complete this form in the browser.')
  if (count === 1) await input.fill(value, { timeout: 5000 })
}

async function openSignup(page: Page, origin: string) {
  const link = await one(page.getByRole('link', { name: SIGNUP }).filter({ visible: true }),
    'No unique signup link was found. Open the registration form yourself in the browser.')
  const href = await link.getAttribute('href')
  const target = new URL(href || '', page.url())
  if (!href || target.origin !== origin || target.username || target.password)
    throw new AccountAssistanceError('Signup points to another website. Open it manually, then approve its origin.')
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await assertOrigin(page, origin)
}

export async function accountBlocker(page: Page): Promise<string | null> {
  if (await page.locator(CAPTCHA).count()) return 'Captcha requires your attention. Complete it in the application browser; no bypass was attempted.'
  if (await page.locator('input[autocomplete="one-time-code"]:visible').count() ||
      await page.getByLabel(/verification code|one.?time (code|password)|authentication code|security code/i).filter({ visible: true }).count() ||
      /verify (your )?(email|account|identity)|verification (code|email|link)|check your (email|inbox)|two.factor|\bMFA\b/i.test(await page.locator('body').innerText()))
    return 'Account verification or MFA requires your attention. Complete it in the application browser.'
  if (termsConsent(await page.locator('body').innerText(), await consentControls(page)))
    return 'Terms or privacy consent require your review. GhostForge did not accept terms or submit registration. Review and finish in the application browser.'
  return null
}

/**
 * True when the page asks for terms/privacy consent: a visible checkbox, radio
 * or toggle whose wording is consent, terms, a signature or a legal declaration
 * (the same test the application form agent uses), an "I agree"/"Accept terms"
 * button, or a sentence saying the account action accepts terms. Cookie banners
 * are not account consent; footer and navigation links never count.
 */
export function termsConsent(bodyText: string, controls: { toggles: string[]; buttons: string[] }): boolean {
  if (controls.toggles.some(label => isConsentOrLegal(label))) return true
  if (controls.buttons.some(name => CONSENT_BUTTON.test(name) && !COOKIES.test(name))) return true
  return bodyText.split(/\n+|(?<=[.!?])\s+/)
    .some(sentence => !COOKIES.test(sentence) && (IMPLICIT_CONSENT.test(sentence) || EXPLICIT_CONSENT.test(sentence)))
}

/** Labels of the visible consent-capable controls on the page (read in the browser). */
async function consentControls(page: Page): Promise<{ toggles: string[]; buttons: string[] }> {
  return page.evaluate(() => {
    const shown = (el: Element | null | undefined): boolean => {
      if (!el) return false
      const r = (el as HTMLElement).getBoundingClientRect()
      const st = getComputedStyle(el as HTMLElement)
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
    }
    const text = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
    const labelOf = (el: Element) => {
      const id = el.getAttribute('id')
      const by = el.getAttribute('aria-labelledby')
      const forLabel = id ? text(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : ''
      const labelled = by ? by.split(/\s+/).map(x => text(document.getElementById(x))).join(' ') : ''
      return (el.getAttribute('aria-label') || labelled || forLabel || text(el.closest('label')) || text(el) || text(el.parentElement)).slice(0, 300)
    }
    // Styled checkboxes hide the input itself; its label or wrapper is what shows.
    const visible = (el: Element) => shown(el) || shown(el.closest('label')) || shown(el.parentElement)
    const toggles = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="switch"], [role="radio"]'))
      .filter(visible).map(labelOf)
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
      .filter(shown)
      .map(el => {
        const name = (el.getAttribute('aria-label') || (el as HTMLInputElement).value || text(el)).slice(0, 120)
        // A cookie banner's "Accept" is not account consent; a button inside the sign-in form always counts.
        const banner = !el.closest('form')?.querySelector('input[type="password"]') && /cookie/i.test(text(el.parentElement?.parentElement))
        return banner ? `${name} (cookie notice)` : name
      })
    return { toggles, buttons }
  })
}

async function submissionResult(page: Page, mode: AccountMode, before: string) {
  await page.waitForFunction(({ before, confirmation }) => {
    const text = document.body?.innerText || ''
    return text !== before && (new RegExp(confirmation, 'i').test(text) ||
      /verify|verification|MFA|two.factor|captcha|already exists|invalid|error|failed/i.test(text))
  }, { before, confirmation: ACCOUNT_CONFIRMED.source }, { timeout: 8000 }).catch(error => {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error
  })
  const blocker = await accountBlocker(page)
  if (blocker) return { message: blocker, confirmed: false }
  const after = await page.locator('body').innerText()
  const confirmed = mode === 'register' && !ACCOUNT_CONFIRMED.test(before) && ACCOUNT_CONFIRMED.test(after)
  const message = confirmed
    ? 'Account creation confirmed by the website. Your browser session is retained. Use Open & fill again to continue the approved job application.'
    : `${mode === 'register' ? 'Registration' : 'Sign-in'} requested, not yet confirmed. Check the application browser for validation errors or verification, then use Open & fill again. The job application has not been submitted. Do not retry registration if an account already exists.`
  return { message, confirmed }
}

async function fillAccountForm(page: Page, profile: JobProfile, request: AccountRequest) {
  const form = await one(page.locator('form').filter({ has: page.locator('input[type="password"]:visible') }),
    'No unique password form was found. Email-first, SSO and embedded login forms must be completed in the browser.')
  await assertForm(form, request.origin)
  const passwords = form.locator('input[type="password"]:visible')
  const [count, email, button] = await Promise.all([
    passwords.count(),
    one(form.locator('input[type="email"]:visible, input[autocomplete="username"]:visible, input[name="email" i]:visible, input[name="username" i]:visible'),
      'No unique account email field was found. Complete this form in the browser.'),
    one(form.getByRole('button', { name: request.mode === 'login' ? LOGIN : SIGNUP }).filter({ visible: true }),
      'No unique account submission button was found. Open the correct login/signup form in the browser first.'),
  ])
  if (count < 1 || count > 2 || (request.mode === 'login' && count !== 1))
    throw new AccountAssistanceError('This does not match the selected sign-in/signup action. Complete the form in the browser.')
  const submit = request.mode === 'fill-signup' ? null : button
  if (submit) {
    const target = await submit.getAttribute('formaction')
    const action = target ? new URL(target, page.url()) : null
    if (action && (action.origin !== request.origin || action.username || action.password))
      throw new AccountAssistanceError('The account button submits to another website. Complete it in the browser.')
    const method = await submit.getAttribute('formmethod')
    if (method && method.toLowerCase() !== 'post') throw new AccountAssistanceError('Account submission must use a POST form.')
  }
  await assertOrigin(page, request.origin)
  await email.fill(request.email!, { timeout: 5000 })
  if (request.mode !== 'login') {
    await optionalFill(form, 'input[autocomplete="given-name"]:visible, input[name="firstName" i]:visible, input[name="first_name" i]:visible', profile.applicant.firstName)
    await optionalFill(form, 'input[autocomplete="family-name"]:visible, input[name="lastName" i]:visible, input[name="last_name" i]:visible', profile.applicant.lastName)
    await optionalFill(form, 'input[autocomplete="name"]:visible, input[name="fullName" i]:visible', [profile.applicant.firstName, profile.applicant.lastName].filter(Boolean).join(' '))
  }
  for (let i = 0; i < count; i++) {
    await assertOrigin(page, request.origin)
    await passwords.nth(i).fill(request.password!, { timeout: 5000 })
  }
  return { form, submit }
}

/** Credentials are used only for this request; never stored, logged or passed to a model. */
export async function assistAccount(username: string, id: string, request: AccountRequest) {
  try {
    accountRequest(request)
    return await withJobOperation(username, id, () => withProfileLock(username, async () => {
      const job = await getJob(username, id)
      if (!job || job.status !== 'needs_user') throw new AccountAssistanceError('Account assistance requires your application to be waiting for you.')
      const record = async (message: string, confirmed = false) => {
        const activity = updateApplicationActivity(username, id, message, 'needs_user')
        const updated = await updateJob(username, id, { activity }, message)
        if (!updated) throw new AccountAssistanceError('Job no longer exists; account progress could not be saved.')
        const notification = await notifyJob(username, updated.id, { title: `${confirmed ? 'Account created' : 'Needs you'}: ${updated.title}`, body: message.slice(0, 180) })
        return { job: updated, message, accountCreated: confirmed, notification }
      }
      try {
      if (job.ats === 'linkedin' || (job.ats === 'workday' && request.mode !== 'login'))
        throw new AccountAssistanceError('Create LinkedIn and Workday accounts manually in the application browser.')
      const page = applicationPage(username, id)
      if (!page) throw new AccountAssistanceError('The application browser is closed. Use Open & fill again first.')
      await assertOrigin(page, request.origin)
      if (!await resolvesPublicly(request.origin)) throw new AccountAssistanceError('Account assistance is limited to public HTTPS websites.')
      const initialBlocker = await accountBlocker(page)
      if (initialBlocker && request.mode !== 'fill-signup') return await record(initialBlocker)
      if (initialBlocker && /captcha|verification|MFA/i.test(initialBlocker)) return await record(initialBlocker)

      const profile = await getProfile(username)
      let message: string
      let confirmed = false
      if (request.mode === 'register' && !await page.getByRole('button', { name: SIGNUP }).filter({ visible: true }).count()) {
        await openSignup(page, request.origin)
        const blocker = await accountBlocker(page)
        if (blocker) return await record(blocker)
      }
      if (request.mode === 'open-signup') {
        await openSignup(page, request.origin)
        message = 'Registration form opened. Review the form, then choose Fill signup form. Terms, signup submission and verification remain yours to complete.'
      } else {
        const { form, submit } = await fillAccountForm(page, profile, request)
        if (submit) {
          await assertOrigin(page, request.origin)
          await assertForm(form, request.origin)
          const blocker = await accountBlocker(page)
          if (blocker) return await record(blocker)
          const valid = await form.evaluate(el => (el as HTMLFormElement).checkValidity())
          if (!valid || !await submit.isEnabled()) return await record('Required account fields, password rules or a disabled button need your attention. Registration was not submitted.')
          const before = await page.locator('body').innerText()
          await submit.click({ timeout: 10_000 })
          const activePage = applicationPage(username, id) || page
          await assertOrigin(activePage, request.origin)
          const result = await submissionResult(activePage, request.mode, before)
          message = result.message
          confirmed = result.confirmed
        } else {
          message = 'Signup fields filled. Save your password in your password manager, review and accept terms yourself, and press Create account in the browser. Complete verification, then use Open & fill again. Account creation is not yet confirmed.'
        }
      }
      trackApplicationPage(username, id, applicationPage(username, id) || page)
      return await record(message, confirmed)
      } catch (error) {
        const message = error instanceof AccountAssistanceError ? error.message : 'Account automation stopped safely. Check the application browser for an unsupported form, navigation failure or validation error.'
        await record(message)
        throw new AccountAssistanceError(message)
      }
    }))
  } finally {
    request.password = undefined
  }
}
