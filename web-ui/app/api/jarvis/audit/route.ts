import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { getAuditFilePath } from '@/lib/audit'

/** GET /api/jarvis/audit — return last N audit entries */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const auditFile = getAuditFilePath()
  if (!existsSync(auditFile)) {
    return NextResponse.json({ entries: [], size: 0 })
  }

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
    const content = await readFile(auditFile, 'utf8')
    const stats = await stat(auditFile)
    const lines = content.trim().split('\n').filter(Boolean)
    const entries = lines.slice(-limit).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean).reverse()

    return NextResponse.json({ entries, total: lines.length, size: stats.size })
  } catch {
    return NextResponse.json({ error: 'Failed to read audit log' }, { status: 500 })
  }
}
