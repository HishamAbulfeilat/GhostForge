import type { Locator, Page } from 'playwright-core'
import { resolvesPublicly, withProfileLock } from './apply'
import { applicationPage, trackApplicationPage, updateApplicationActivity } from './live'
import { getJob, getProfile, updateJob, withJobOperation } from './store'

export class AccountAssistanceError extends Error {}

export type AccountMode = 'login' | 'fill-signup' | 'open-signup'
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

export function accountRequest(value: unknown): AccountRequest {
  if (!value || typeof value !== 'object') throw new Error('Account details required.')
  const body = value as Record<string, unknown>
  if (!['login', 'fill-signup', 'open-signup'].includes(String(body.mode)) || body.consent !== true)
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

/** Credentials are used only for this request; never stored, logged or passed to a model. */
export async function assistAccount(username: string, id: string, request: AccountRequest) {
  try {
    accountRequest(request)
    return await withJobOperation(username, id, () => withProfileLock(username, async () => {
      const job = await getJob(username, id)
      if (!job || job.status !== 'needs_user') throw new AccountAssistanceError('Account assistance requires your application to be waiting for you.')
      if (job.ats === 'linkedin') throw new AccountAssistanceError('Sign in and create LinkedIn accounts manually in the application browser.')
      const page = applicationPage(username, id)
      if (!page) throw new AccountAssistanceError('The application browser is closed. Use Open & fill again first.')
      await assertOrigin(page, request.origin)
      if (!await resolvesPublicly(request.origin)) throw new AccountAssistanceError('Account assistance is limited to public HTTPS websites.')
      if (await page.locator(CAPTCHA).count()) throw new AccountAssistanceError('Complete the captcha in the browser before account assistance.')

      const profile = await getProfile(username)
      let message: string
      if (request.mode === 'open-signup') {
        const link = await one(page.getByRole('link', { name: SIGNUP }).filter({ visible: true }),
          'No unique signup link was found. Open the registration form yourself in the browser.')
        const href = await link.getAttribute('href')
        const target = new URL(href || '', page.url())
        if (!href || target.origin !== request.origin || target.username || target.password)
          throw new AccountAssistanceError('Signup points to another website. Open it manually, then approve its origin.')
        await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await assertOrigin(page, request.origin)
        message = 'Registration form opened. Review the form, then choose Fill signup form. Terms, signup submission and verification remain yours to complete.'
      } else {
        const form = await one(page.locator('form').filter({ has: page.locator('input[type="password"]:visible') }),
          'No unique password form was found. Email-first, SSO and embedded login forms must be completed in the browser.')
        await assertForm(form, request.origin)
        const passwords = form.locator('input[type="password"]:visible')
        const count = await passwords.count()
        if (count < 1 || count > 2 || (request.mode === 'login' && count !== 1))
          throw new AccountAssistanceError('This does not match the selected sign-in/signup action. Complete the form in the browser.')
        const email = await one(form.locator('input[type="email"]:visible, input[autocomplete="username"]:visible, input[name="email" i]:visible, input[name="username" i]:visible'),
          'No unique account email field was found. Complete this form in the browser.')
        const submit = request.mode === 'login'
          ? await one(form.getByRole('button', { name: LOGIN }).filter({ visible: true }), 'No unique sign-in button was found. Complete this form in the browser.')
          : null
        if (request.mode === 'fill-signup') {
          await one(form.getByRole('button', { name: SIGNUP }).filter({ visible: true }),
            'This is not a recognizable signup form. Open the registration form in the browser first.')
        }
        if (submit) {
          const target = await submit.getAttribute('formaction')
          const action = target ? new URL(target, page.url()) : null
          if (action && (action.origin !== request.origin || action.username || action.password))
            throw new AccountAssistanceError('The sign-in button submits to another website. Complete it in the browser.')
          const method = await submit.getAttribute('formmethod')
          if (method && method.toLowerCase() !== 'post') throw new AccountAssistanceError('Sign-in must use a POST form.')
        }
        await assertOrigin(page, request.origin)
        await email.fill(request.email!, { timeout: 5000 })
        if (request.mode === 'fill-signup') {
          await optionalFill(form, 'input[autocomplete="given-name"]:visible, input[name="firstName" i]:visible, input[name="first_name" i]:visible', profile.applicant.firstName)
          await optionalFill(form, 'input[autocomplete="family-name"]:visible, input[name="lastName" i]:visible, input[name="last_name" i]:visible', profile.applicant.lastName)
          await optionalFill(form, 'input[autocomplete="name"]:visible, input[name="fullName" i]:visible', [profile.applicant.firstName, profile.applicant.lastName].filter(Boolean).join(' '))
        }
        for (let i = 0; i < count; i++) {
          await assertOrigin(page, request.origin)
          await passwords.nth(i).fill(request.password!, { timeout: 5000 })
        }
        if (submit) {
          await assertOrigin(page, request.origin)
          await assertForm(form, request.origin)
          await submit.click({ timeout: 10_000 })
          message = 'Sign-in requested, not yet verified. Complete any MFA, email verification or account error in the browser, then use Open & fill again. The application has not been submitted.'
        } else {
          message = 'Signup fields filled. Save your password in your password manager, review and accept terms yourself, and press Create account in the browser. Complete verification, then use Open & fill again. Account creation is not yet confirmed.'
        }
      }
      trackApplicationPage(username, id, page)
      const activity = updateApplicationActivity(username, id, message, 'needs_user')
      const updated = await updateJob(username, id, { activity }, message)
      return { job: updated, message }
    }))
  } finally {
    request.password = undefined
  }
}
