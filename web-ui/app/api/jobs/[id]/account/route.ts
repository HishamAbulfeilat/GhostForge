import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { hostedGuard } from '@/lib/hosted'
import { AccountAssistanceError, accountRequest, assistAccount } from '@/lib/job-hunter/accounts'
import { getJob } from '@/lib/job-hunter/store'
import { checkRateLimit } from '@/lib/ratelimit'
import { readRequestJsonWithLimit } from '@/lib/agent-team-api'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  if (req.nextUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname))
    return NextResponse.json({ error: 'Use HTTPS or localhost before sending website credentials.' }, { status: 403, headers })
  if (req.headers.get('origin') !== req.nextUrl.origin)
    return NextResponse.json({ error: 'Account assistance requires a same-origin request.' }, { status: 403, headers })
  const { id } = await context.params
  if (!await getJob(user.username, id)) return NextResponse.json({ error: 'Job not found' }, { status: 404, headers })
  if (!checkRateLimit(`job-account:${user.username}`, 5).allowed)
    return NextResponse.json({ error: 'Too many account attempts. Wait one minute and check the website before retrying.' }, { status: 429, headers })
  let input: ReturnType<typeof accountRequest>
  try { input = accountRequest(await readRequestJsonWithLimit(req, 8192)) } catch (error) {
    if (error instanceof Error && error.message === 'Request body exceeds the 8192 byte limit')
      return NextResponse.json({ error: 'Account request too large.' }, { status: 413, headers })
    return NextResponse.json({ error: 'Invalid account request. Approve an exact HTTPS origin and enter a valid email/password.' }, { status: 400, headers })
  }
  try {
    return NextResponse.json(await assistAccount(user.username, id, input), { headers })
  } catch (error) {
    // Browser errors can include input values; never return or log them.
    return NextResponse.json({ error: error instanceof AccountAssistanceError ? error.message : 'Account assistance could not finish safely. Check the application window, complete captcha/verification or unsupported fields there, and retry after reviewing its origin.' }, { status: 409, headers })
  } finally {
    input.password = undefined
  }
}
