import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import { requirePermission } from '@/lib/access'

const CONFIG_DIR = path.join(homedir(), '.ghostforge')
const WEBHOOKS_FILE = path.join(CONFIG_DIR, 'webhooks.json')

interface WebhookTrigger {
  id: string
  source: string
  eventType: string
  action: string
}

/** Only well-formed triggers are stored; anything else in the body is dropped. */
function toTriggers(value: unknown): WebhookTrigger[] | null {
  if (!Array.isArray(value)) return null
  const out: WebhookTrigger[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const t = item as Record<string, unknown>
    if (![t.id, t.source, t.eventType, t.action].every(v => typeof v === 'string' && v.length <= 2000)) return null
    out.push({ id: String(t.id), source: String(t.source), eventType: String(t.eventType), action: String(t.action) })
  }
  return out
}

/**
 * Replace the shared trigger config (~/.ghostforge/webhooks.json). This is an
 * admin action with its own route, so no delivery to /api/webhook can reach it.
 */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'admin_tools')
  if (user instanceof NextResponse) return user
  let body: unknown
  try {
    body = JSON.parse(await req.text())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const triggers = toTriggers(body)
  if (!triggers) {
    return NextResponse.json({ error: 'Expected a list of triggers with id, source, eventType and action' }, { status: 400 })
  }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(WEBHOOKS_FILE, JSON.stringify(triggers, null, 2), { mode: 0o600 })
  return NextResponse.json({ ok: true })
}
