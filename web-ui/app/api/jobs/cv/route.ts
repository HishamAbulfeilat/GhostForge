import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { generatorFor, getProfile } from '@/lib/job-hunter'
import { adoptImprovedCv, improveCv, markdownToDocx, restoreOriginalCv } from '@/lib/job-hunter/improve'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

/**
 * GET  /api/jobs/cv                    current CV, latest improvement, whether an original is kept
 * GET  /api/jobs/cv?download=md|docx   download the improved CV
 * POST /api/jobs/cv { action: 'improve' | 'adopt' | 'restore' }
 */
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  const p = await getProfile(user.username)

  const download = req.nextUrl.searchParams.get('download')
  if (download) {
    if (!p.improvedCv) return NextResponse.json({ error: 'Improve your CV first' }, { status: 404 })
    const stem = `${p.applicant.firstName}-${p.applicant.lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cv'
    if (download === 'docx') {
      return new NextResponse(new Uint8Array(await markdownToDocx(p.improvedCv.text)), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${stem}-cv-improved.docx"`,
        },
      })
    }
    return new NextResponse(p.improvedCv.text, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${stem}-cv-improved.md"` },
    })
  }

  return NextResponse.json({
    cv: p.cv ? { fileName: p.cv.fileName, text: p.cv.text } : null,
    improvedCv: p.improvedCv || null,
    usingImproved: Boolean(p.originalCv),
  })
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  try {
    switch (body.action) {
      case 'improve': {
        const { model } = await getProfile(user.username)
        return NextResponse.json({ improvedCv: await improveCv(user.username, generatorFor(model)) })
      }
      case 'adopt':
        return NextResponse.json({ cv: { fileName: (await adoptImprovedCv(user.username)).fileName } })
      case 'restore':
        return NextResponse.json({ cv: { fileName: (await restoreOriginalCv(user.username)).fileName } })
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'CV improvement failed' }, { status: 400 })
  }
}
