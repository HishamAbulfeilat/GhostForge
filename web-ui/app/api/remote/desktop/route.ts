import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { auditLog } from '@/lib/audit'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { getClientIP } from '@/lib/ratelimit'
import { captureScreen, desktopSupport, sendInput, type DesktopInput } from '@/lib/remote/desktop'
import { readRemote, updateRemote } from '@/lib/remote/store'
import { verifyPassword } from '@/lib/users'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Remote desktop for admins, from a paired phone or another computer.
 *
 * GET                       status (enabled, what is installed)
 * GET ?frame=1              one JPEG of the screen (only while enabled)
 * POST { action: 'enable', password }   switch on — needs the account password
 * POST { action: 'disable' }
 * POST { input: DesktopInput }          click / text / key / scroll (only while enabled)
 *
 * Off by default. Turning it on asks for the password again (5 tries per 15
 * minutes), so a lost phone or a stolen session cannot silently take over the
 * computer, and it switches itself off after 20 idle minutes, 4 hours, or a
 * server restart.
 */
async function adminUser(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user)) return { error: NextResponse.json({ error: 'Remote desktop is for admin accounts only.' }, { status: 403 }) }
  return { user }
}

// Control switches itself off: after IDLE_MS without use, MAX_MS after it was turned on,
// and on every server restart (lastUse starts at 0), so it is never left on by accident.
const IDLE_MS = 20 * 60_000
const MAX_MS = 4 * 60 * 60_000
let lastUse = 0

async function isOn(): Promise<boolean> {
  const state = await readRemote()
  if (!state.desktopEnabled) return false
  const now = Date.now()
  const since = Date.parse(state.desktopEnabledAt || '') || 0
  if (now - lastUse > IDLE_MS || now - since > MAX_MS) {
    await updateRemote(s => { s.desktopEnabled = false })
    void auditLog({ level: 'security', event: 'remote_desktop_expired', params: { idleMin: Math.round((now - lastUse) / 60_000) } })
    return false
  }
  lastUse = now
  return true
}

// Wrong passwords per user+IP: the password re-check must not become a guessing oracle.
const failures = new Map<string, { n: number; until: number }>()
const MAX_FAILURES = 5

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { user, error } = await adminUser(req)
  if (error) return error
  const on = await isOn()
  if (req.nextUrl.searchParams.get('frame')) {
    if (!on) return NextResponse.json({ error: 'Remote desktop is off.' }, { status: 409 })
    try {
      const { jpeg, width, height } = await captureScreen()
      return new NextResponse(new Uint8Array(jpeg), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-screen-width': String(width), 'x-screen-height': String(height) },
      })
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Capture failed' }, { status })
    }
  }
  const state = await readRemote()
  return NextResponse.json({ enabled: on, enabledAt: on ? state.desktopEnabledAt : undefined, idleMinutes: IDLE_MS / 60_000, support: desktopSupport(), user: user!.username })
}

let lastInputLog = 0

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { user, error } = await adminUser(req)
  if (error) return error
  let body: { action?: string; password?: string; input?: DesktopInput } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const ip = getClientIP(req)

  if (body.action === 'enable') {
    const key = `${user!.username}|${ip}`
    const now = Date.now()
    const f = failures.get(key)
    if (f && f.until > now && f.n >= MAX_FAILURES) {
      return NextResponse.json({ error: 'Too many wrong passwords. Try again in 15 minutes.' }, { status: 429 })
    }
    if (!body.password || !user!.passwordHash || !verifyPassword(body.password, user!.passwordHash)) {
      failures.set(key, { n: (f && f.until > now ? f.n : 0) + 1, until: now + 15 * 60_000 })
      if (failures.size > 1000) failures.clear()
      void auditLog({ level: 'security', event: 'remote_desktop_enable_denied', ip, params: { username: user!.username } })
      return NextResponse.json({ error: 'Wrong password.' }, { status: 403 })
    }
    failures.delete(key)
    lastUse = now
    await updateRemote(s => { s.desktopEnabled = true; s.desktopEnabledAt = new Date(now).toISOString() })
    void auditLog({ level: 'security', event: 'remote_desktop_enabled', ip, params: { username: user!.username } })
    return NextResponse.json({ enabled: true })
  }
  if (body.action === 'disable') {
    await updateRemote(s => { s.desktopEnabled = false })
    void auditLog({ level: 'security', event: 'remote_desktop_disabled', ip, params: { username: user!.username } })
    return NextResponse.json({ enabled: false })
  }
  if (body.input) {
    if (!(await isOn())) return NextResponse.json({ error: 'Remote desktop is off.' }, { status: 409 })
    try {
      const result = await sendInput(body.input)
      // Log control sessions, but not every keystroke.
      if (Date.now() - lastInputLog > 60_000) {
        lastInputLog = Date.now()
        void auditLog({ level: 'security', event: 'remote_desktop_input', ip, params: { username: user!.username, type: body.input.type } })
      }
      return NextResponse.json({ ok: true, result })
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Input failed' }, { status })
    }
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
