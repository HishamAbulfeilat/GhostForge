import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { isAuthorizedRequest } from '@/lib/auth'
import { requirePermission } from '@/lib/access'
import { ensureMarkLivBridge } from '@/lib/mark-liv-bridge'
import { getLiveBridgeToken } from '@/lib/bridge-token'
import { getMarkLBridgeUrl } from '@/lib/bridge-url'

export const dynamic = 'force-dynamic'

const YOUTUBE_ACTIONS = new Set(['play', 'summarize', 'get_info', 'trending'])
const GAME_ACTIONS = new Set(['list', 'update', 'schedule', 'cancel_schedule', 'schedule_status', 'download_status'])
const YOUTUBE_URL = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return invalid('Invalid JSON body')
  }

  const target = body.target
  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  if (target !== 'youtube' && target !== 'game-updater') return invalid('target must be youtube or game-updater')
  const access = await requirePermission(req, target === 'youtube' ? 'youtube' : 'game_manager')
  if (access instanceof NextResponse) return access
  const actions = target === 'youtube' ? YOUTUBE_ACTIONS : GAME_ACTIONS
  if (!actions.has(action)) return invalid(`Unsupported ${target} action`)

  const text = (key: string, max: number): string | undefined | null => {
    const value = body[key]
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string' || value.trim().length > max) return null
    return value.trim()
  }

  const query = text('query', 500)
  const url = text('url', 2048)
  const region = text('region', 3)?.toUpperCase()
  const gameName = text('game_name', 200)
  if ([query, url, region, gameName].includes(null)) return invalid('One or more fields are invalid or too long')

  if (target === 'youtube' && (action === 'play' && !query)) return invalid('query is required for play')
  if (target === 'youtube' && ['summarize', 'get_info'].includes(action) && (!url || !YOUTUBE_URL.test(url))) {
    return invalid('a valid YouTube URL is required for this action')
  }
  if (target === 'youtube' && action === 'trending' && (!region || !/^[A-Z]{2,3}$/.test(region))) {
    return invalid('region must be a 2-3 letter country code')
  }

  const request = {
    action,
    ...(query ? { query } : {}),
    ...(url ? { url } : {}),
    ...(region ? { region } : {}),
    ...(gameName ? { game_name: gameName } : {}),
  }

  try {
    // Validated: loopback only unless GF_ALLOW_REMOTE_BRIDGE=1, so the bridge token never leaves the host.
    const bridgeUrl = getMarkLBridgeUrl()
    if (!(await ensureMarkLivBridge())) throw new Error('Bridge is not running and could not be started.')
    const endpoint = target === 'youtube' ? '/api/mark-l/youtube' : '/api/mark-l/game-updater'
    const response = await fetch(`${bridgeUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getLiveBridgeToken()}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(180_000),
    })
    if (!response.ok) {
      const responseBody = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(typeof responseBody?.detail === 'string' ? responseBody.detail : `Bridge request failed (${response.status}).`)
    }
    const responseBody = await response.json().catch(() => null) as { data?: unknown } | null
    const result = typeof responseBody?.data === 'string'
      ? responseBody.data
      : responseBody?.data == null ? 'Done.' : JSON.stringify(responseBody.data, null, 2)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Device control failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
