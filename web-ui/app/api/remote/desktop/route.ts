import { NextRequest, NextResponse } from 'next/server'
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
 * Off by default. Turning it on asks for the password again, so a lost phone
 * or a stolen session cannot silently take over the computer.
 */
async function adminUser(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user)) return { error: NextResponse.json({ error: 'Remote desktop is for admin accounts only.' }, { status: 403 }) }
  return { user }
}

export async function GET(req: NextRequest) {
  const { user, error } = await adminUser(req)
  if (error) return error
  const state = await readRemote()
  if (req.nextUrl.searchParams.get('frame')) {
    if (!state.desktopEnabled) return NextResponse.json({ error: 'Remote desktop is off.' }, { status: 409 })
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
  return NextResponse.json({ enabled: state.desktopEnabled, enabledAt: state.desktopEnabledAt, support: desktopSupport(), user: user!.username })
}

let lastInputLog = 0

export async function POST(req: NextRequest) {
  const { user, error } = await adminUser(req)
  if (error) return error
  let body: { action?: string; password?: string; input?: DesktopInput } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const ip = getClientIP(req)

  if (body.action === 'enable') {
    if (!body.password || !user!.passwordHash || !verifyPassword(body.password, user!.passwordHash)) {
      void auditLog({ level: 'security', event: 'remote_desktop_enable_denied', ip, params: { username: user!.username } })
      return NextResponse.json({ error: 'Wrong password.' }, { status: 403 })
    }
    await updateRemote(s => { s.desktopEnabled = true; s.desktopEnabledAt = new Date().toISOString() })
    void auditLog({ level: 'security', event: 'remote_desktop_enabled', ip, params: { username: user!.username } })
    return NextResponse.json({ enabled: true })
  }
  if (body.action === 'disable') {
    await updateRemote(s => { s.desktopEnabled = false })
    void auditLog({ level: 'security', event: 'remote_desktop_disabled', ip, params: { username: user!.username } })
    return NextResponse.json({ enabled: false })
  }
  if (body.input) {
    if (!(await readRemote()).desktopEnabled) return NextResponse.json({ error: 'Remote desktop is off.' }, { status: 409 })
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
