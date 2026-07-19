import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { getLiveBridgeToken } from '@/lib/bridge-token'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = getLiveBridgeToken()
  if (!token) {
    return NextResponse.json({ error: 'Bridge token not configured' }, { status: 503 })
  }
  return NextResponse.json({ token })
}
