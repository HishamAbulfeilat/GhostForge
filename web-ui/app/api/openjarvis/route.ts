import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { OpenJarvisError, openjarvisAsk, openjarvisHealth } from '@/lib/openjarvis'

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
  let body: { prompt?: unknown; timeoutS?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  if (body.timeoutS !== undefined && (typeof body.timeoutS !== 'number' || !Number.isFinite(body.timeoutS))) {
    return NextResponse.json({ error: 'timeoutS must be a number of seconds' }, { status: 400 })
  }
  const timeoutS = Math.min(Math.max(Math.round((body.timeoutS as number | undefined) ?? 60), 1), 300)
  try {
    const response = await openjarvisAsk(prompt, timeoutS)
    return NextResponse.json({ response })
  } catch (error) {
    if (error instanceof OpenJarvisError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'OpenJarvis request failed' }, { status: 502 })
  }
}
