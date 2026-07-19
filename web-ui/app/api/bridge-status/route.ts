import { NextResponse } from 'next/server'
import { getLiveBridgeToken, getBridgeUrl } from '@/lib/bridge-token'

export async function GET() {
  const bridgeUrl = getBridgeUrl()
  const bridgeToken = getLiveBridgeToken()

  if (!bridgeToken) {
    return NextResponse.json({ status: 'unconfigured' })
  }

  try {
    const res = await fetch(`${bridgeUrl}/health`, {
      headers: { Authorization: `Bearer ${bridgeToken}` },
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) return NextResponse.json({ status: 'connected' })
    return NextResponse.json({ status: 'disconnected' })
  } catch {
    return NextResponse.json({ status: 'disconnected' })
  }
}
