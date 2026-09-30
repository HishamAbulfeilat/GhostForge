import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { openjarvisAsk, openjarvisHealth } from '@/lib/openjarvis'

export const dynamic = 'force-dynamic'

/** GET — OpenJarvis install/health status (mirrors /api/bridge-status). */
export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const health = await openjarvisHealth()
  return NextResponse.json(health)
}

/** POST { prompt } — run `jarvis ask "<prompt>"` on the bridge and return its reply. */
export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { prompt?: string; timeoutS?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const prompt = (body.prompt ?? '').trim()
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  const timeoutS = Math.min(Math.max(body.timeoutS ?? 60, 1), 300)
  const response = await openjarvisAsk(prompt, timeoutS)
  return NextResponse.json({ response })
}
