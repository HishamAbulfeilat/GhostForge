import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { hostedGuard } from '@/lib/hosted'
import { getJob } from '@/lib/job-hunter/store'
import { applicationPreview } from '@/lib/job-hunter/live'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  const { id } = await context.params
  if (!await getJob(user.username, id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' }
  try {
    return NextResponse.json(await applicationPreview(user.username, id, req.nextUrl.searchParams.get('preview') === '1'), { headers })
  } catch (error) {
    console.warn('[Job Hunter] Application preview unavailable:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: 'The browser preview is temporarily unavailable. Check the application window.' }, { status: 503, headers })
  }
}
