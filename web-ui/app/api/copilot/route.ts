import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { getLiveBridgeToken, getBridgeUrl } from '@/lib/bridge-token'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsed: { prompt?: string; mode?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { prompt: rawPrompt, mode } = parsed
  const prompt = rawPrompt?.trim()

  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const bridgeUrl = getBridgeUrl()
  const bridgeToken = getLiveBridgeToken()

  if (!bridgeToken) {
    return NextResponse.json({
      error: '🔌 Mac bridge not connected. Run: bash ~/GhostForge/scripts/bridge.sh start',
      connected: false,
    })
  }

  try {
    const res = await fetch(`${bridgeUrl}/copilot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({ prompt, mode: mode ?? 'suggest' }),
      signal: AbortSignal.timeout(65000),
    })

    const data = (await res.json()) as { output?: string; error?: boolean }
    return NextResponse.json({ output: data.output, connected: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Bridge unreachable: ${message}`, connected: false })
  }
}
