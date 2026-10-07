import type { Page } from 'playwright-core'

export type ApplicationPhase = 'opening' | 'filling' | 'waiting_ai' | 'submitting' | 'login' | 'captcha' | 'questions' | 'blocked' | 'submitted' | 'failed'
export interface ApplicationActivity {
  phase: ApplicationPhase
  message: string
  updatedAt: string
}
interface LiveApplication extends ApplicationActivity {
  page?: Page
}
const runtime = globalThis as typeof globalThis & { ghostforgeJobLive?: Map<string, LiveApplication> }
const sessions = runtime.ghostforgeJobLive ??= new Map<string, LiveApplication>()
const key = (username: string, id: string) => JSON.stringify([username, id])

export function applicationPhase(message: string, status?: string): ApplicationPhase {
  if (status === 'failed') return 'failed'
  if (status === 'submitted') return 'submitted'
  if (/waiting for AI/i.test(message)) return 'waiting_ai'
  if (/captcha/i.test(message)) return 'captcha'
  if (/sign in|log.?in|create an account|authentication/i.test(message)) return 'login'
  if (/question.+answer/i.test(message)) return 'questions'
  if (status === 'needs_user') return 'blocked'
  if (/submitting/i.test(message)) return 'submitting'
  if (/opening/i.test(message)) return 'opening'
  return 'filling'
}

export function updateApplicationActivity(username: string, id: string, message: string, status?: string): ApplicationActivity {
  const cutoff = Date.now() - 2 * 60 * 60_000
  for (const [sessionKey, session] of sessions) {
    if (Date.parse(session.updatedAt) < cutoff && (!session.page || session.page.isClosed())) sessions.delete(sessionKey)
  }
  const previous = sessions.get(key(username, id))
  const activity = { phase: applicationPhase(message, status), message, updatedAt: new Date().toISOString() }
  sessions.set(key(username, id), { ...previous, ...activity })
  return activity
}

export function trackApplicationPage(username: string, id: string, page: Page): void {
  const entry = sessions.get(key(username, id))
  if (entry) entry.page = page
}

export async function applicationPreview(username: string, id: string, screenshot: boolean) {
  const entry = sessions.get(key(username, id))
  if (!entry) return { activity: null, available: false, image: null }
  const { phase, message, updatedAt, page } = entry
  const activity = { phase, message, updatedAt }
  if (!page || page.isClosed()) return { activity, available: false, image: null }
  // No cookies, credentials, page HTML or URL query tokens leave the server.
  let origin = ''
  try { origin = new URL(page.url()).origin } catch { /* loading page */ }
  if (!screenshot) return { activity, origin, available: true, image: null }
  const image = await page.screenshot({
    type: 'jpeg', quality: 55, timeout: 5000,
    mask: [page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')],
  })
  return { activity, origin, available: true, image: `data:image/jpeg;base64,${image.toString('base64')}` }
}
