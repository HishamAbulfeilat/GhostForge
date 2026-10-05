import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { isScannerId, listScanners, runScanner } from './scanners'

export const dynamic = 'force-dynamic'
export const maxDuration = 150

// One scan at a time per server process; scanners are CPU and disk heavy.
let scanInProgress = false

async function requireAdmin(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(me)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { me }
}

/** GET — list the allowlisted defensive scanners and whether each is installed. */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { error } = await requireAdmin(req)
  if (error) return error
  return NextResponse.json({ scanners: listScanners() })
}

/**
 * POST { scanner } — run one allowlisted scanner on this repository.
 * The body may only name a scanner; arguments, paths and options are rejected.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { me, error } = await requireAdmin(req)
  if (error) return error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
  }
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'scanner') {
    return NextResponse.json({ error: 'Only { "scanner": "<id>" } is accepted; arguments and paths are not allowed' }, { status: 400 })
  }
  const scanner = (body as { scanner: unknown }).scanner
  if (!isScannerId(scanner)) {
    return NextResponse.json({ error: 'Unknown scanner' }, { status: 400 })
  }

  if (scanInProgress) {
    return NextResponse.json({ error: 'A scan is already running' }, { status: 409 })
  }
  scanInProgress = true
  try {
    const result = await runScanner(scanner)
    void auditLog({
      level: 'security',
      event: 'security_scan',
      tool: scanner,
      params: { user: me.username },
      result: result.status,
    })
    return NextResponse.json(result)
  } finally {
    scanInProgress = false
  }
}
