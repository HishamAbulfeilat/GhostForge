import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { getLiveBridgeToken, getBridgeUrl } from '@/lib/bridge-token'
import { executeBridgeCommand } from '@/lib/ws-client'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as { command?: string }
  const command = body.command?.trim()

  if (!command) {
    return NextResponse.json({ error: 'Command is required' }, { status: 400 })
  }

  const bridgeUrl = getBridgeUrl()
  const bridgeToken = getLiveBridgeToken()

  if (!bridgeToken) {
    return NextResponse.json({
      error: 'Mac bridge not connected. Run: bash ~/GhostForge/scripts/bridge.sh start',
      connected: false,
    })
  }

  try {
    const data = await executeBridgeCommand(bridgeUrl, bridgeToken, command)
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown bridge error'
    return NextResponse.json({ error: `Bridge unreachable: ${message}`, connected: false })
  }
}
