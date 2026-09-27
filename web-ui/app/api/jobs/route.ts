import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { approveJob, dismissJob, getProfile, listJobs, missingApplicantFields, prepareJob, runSearch } from '@/lib/job-hunter'
import { jsearchKey } from '@/lib/job-hunter/sources'

export const dynamic = 'force-dynamic'
// Searching, tailoring and form filling can take a few minutes
export const maxDuration = 300

/** GET /api/jobs — the caller's jobs, newest first, plus profile readiness */
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  const [jobs, profile] = await Promise.all([listJobs(user.username), getProfile(user.username)])
  return NextResponse.json({
    jobs: jobs.filter(j => j.status !== 'dismissed').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    ready: { hasCv: Boolean(profile.cv), missing: missingApplicantFields(profile), titles: profile.preferences.titles },
    sources: { linkedInViaJSearch: Boolean(jsearchKey()) },
  })
}

/**
 * POST /api/jobs { action, id?, terms? }
 *   search   run the pipeline (sources → match → score → auto-prepare top fits)
 *   prepare  tailor CV + cover letter for one job
 *   approve  fill (and where safe, submit) the application — the user's one click
 *   dismiss  hide a job
 */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user

  let body: { action?: string; id?: string; terms?: string[]; autoPrepare?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    switch (body.action) {
      case 'search': {
        const terms = Array.isArray(body.terms) ? body.terms.map(String).slice(0, 5) : undefined
        const autoPrepare = Math.max(0, Math.min(5, Number(body.autoPrepare ?? 3)))
        return NextResponse.json({ result: await runSearch(user.username, { terms, autoPrepare }) })
      }
      case 'prepare':
        if (!body.id) return NextResponse.json({ error: 'Job id required' }, { status: 400 })
        return NextResponse.json({ job: await prepareJob(user.username, body.id) })
      case 'approve':
        if (!body.id) return NextResponse.json({ error: 'Job id required' }, { status: 400 })
        return NextResponse.json(await approveJob(user.username, body.id))
      case 'dismiss':
        if (!body.id) return NextResponse.json({ error: 'Job id required' }, { status: 400 })
        return NextResponse.json({ job: await dismissJob(user.username, body.id) })
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Job Hunter failed' }, { status: 400 })
  }
}
