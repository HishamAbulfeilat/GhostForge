import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { requirePermission } from '@/lib/access'
import { getLiveBridgeToken } from '@/lib/bridge-token'

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const access = await requirePermission(req, 'terminal')
  if (access instanceof NextResponse) return access
  const token = getLiveBridgeToken()
  if (!token) {
    return NextResponse.json({ error: 'Bridge token not configured' }, { status: 503 })
  }
  return NextResponse.json({ token })
}
