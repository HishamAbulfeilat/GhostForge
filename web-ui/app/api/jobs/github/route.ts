import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { requirePermission } from '@/lib/access'
import { isOwner } from '@/lib/users'
import { generatorFor, getProfile } from '@/lib/job-hunter'
import { publishGithubProfile, validGithubUsername } from '@/lib/job-hunter/github-profile'
import { DESIGN_STYLES, generateGithubDesigns, renderPreview, selectGithubDesign } from '@/lib/job-hunter/github-designs'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const execFileAsync = promisify(execFile)

/** Token of the GitHub CLI login on this machine (owner only) */
async function localGhToken(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10_000, windowsHide: true })
    return stdout.trim()
  } catch {
    return ''
  }
}

/** GET /api/jobs/github — the saved draft and generated designs */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  const p = await getProfile(user.username)
  return NextResponse.json({ draft: p.githubProfile || null, designs: p.githubDesigns || [], styles: DESIGN_STYLES, canUseLocalGh: isOwner(user) })
}

/**
 * POST /api/jobs/github
 *   { action: 'designs', github, notes?, creative? }   several designs, the best fit marked recommended
 *   { action: 'select', style }                        load one design into the editable draft
 *   { action: 'preview', markdown }                    GitHub-rendered HTML for a sandboxed preview
 *   { action: 'publish', draft: {username, readme, bio, location, blog, company}, token? | useLocalGh?, updateProfile? }
 * The token is used for this request only — never stored or logged.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user

  let body: {
    action?: string; github?: string; notes?: string; creative?: boolean; style?: string; markdown?: string
    draft?: { username?: string; readme?: string; bio?: string; location?: string; blog?: string; company?: string }
    token?: string; useLocalGh?: boolean; updateProfile?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    if (body.action === 'designs') {
      const github = String(body.github || '').trim().replace(/^@/, '')
      if (!validGithubUsername(github)) return NextResponse.json({ error: 'Enter a valid GitHub username' }, { status: 400 })
      const { model } = await getProfile(user.username)
      const set = await generateGithubDesigns(user.username, github, { notes: String(body.notes || ''), creative: body.creative === true }, generatorFor(model))
      return NextResponse.json({ ...set, draft: (await getProfile(user.username)).githubProfile })
    }

    if (body.action === 'select') {
      return NextResponse.json({ draft: await selectGithubDesign(user.username, String(body.style || '')) })
    }

    if (body.action === 'preview') {
      return NextResponse.json({ html: await renderPreview(String(body.markdown || '')) })
    }

    if (body.action === 'publish') {
      const d = body.draft || {}
      if (!validGithubUsername(String(d.username || ''))) return NextResponse.json({ error: 'Draft the profile first' }, { status: 400 })
      let token = String(body.token || '').trim()
      if (!token && body.useLocalGh) {
        // The host's gh login is the owner's account — nobody else may publish with it
        if (!isOwner(user)) return NextResponse.json({ error: 'Only the owner can use this machine\'s GitHub login' }, { status: 403 })
        token = await localGhToken()
        if (!token) return NextResponse.json({ error: 'GitHub CLI is not logged in on this machine (run: gh auth login)' }, { status: 400 })
      }
      if (!token) return NextResponse.json({ error: 'Paste a GitHub token to publish' }, { status: 400 })
      const result = await publishGithubProfile(user.username, token, {
        username: String(d.username),
        readme: String(d.readme || '').slice(0, 60_000),
        bio: String(d.bio || '').slice(0, 160),
        location: String(d.location || '').slice(0, 100),
        blog: String(d.blog || '').slice(0, 200),
        company: String(d.company || '').slice(0, 100),
      }, { updateProfile: body.updateProfile !== false })
      return NextResponse.json({ result })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'GitHub profile setup failed' }, { status: 400 })
  }
}
