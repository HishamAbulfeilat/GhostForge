import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { isAuthorizedRequest } from '@/lib/auth'

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

const CATALOG_PATH = path.join(os.homedir(), 'GhostForge/marketplace/catalog.json')
const REGISTRY_PATH = path.join(os.homedir(), 'GhostForge/marketplace/registry.json')

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const catalog = readJSON<{ items: { id: string; installed?: boolean }[] }>(CATALOG_PATH, { items: [] })
  const registry = readJSON<{ installed: string[]; removed?: string[] }>(REGISTRY_PATH, { installed: [], removed: [] })

  // registry.json is the source of truth, seeded by any catalog items that
  // ship pre-installed (installed: true) so the TUI and web UI never disagree.
  // Items the user explicitly removed (registry.removed) are not re-added.
  const removed = new Set(registry.removed ?? [])
  const installed = new Set((registry.installed ?? []).filter(id => !removed.has(id)))
  for (const item of catalog.items) {
    if (item?.installed && item.id && !removed.has(item.id)) installed.add(item.id)
  }

  return NextResponse.json({ items: catalog.items, installed: [...installed] })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsed: { action?: string; id?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action, id } = parsed as { action: string; id: string }
  if (!id || (action !== 'install' && action !== 'remove')) {
    return NextResponse.json({ error: 'Invalid action or id' }, { status: 400 })
  }

  const catalog = readJSON<{ items: { id: string; installed?: boolean }[] }>(CATALOG_PATH, { items: [] })
  const registry = readJSON<{ installed: string[]; removed?: string[] }>(REGISTRY_PATH, { installed: [], removed: [] })
  const installed = new Set(registry.installed ?? [])
  const removed = new Set(registry.removed ?? [])
  const seededByCatalog = catalog.items.some(i => i?.id === id && i.installed)

  if (action === 'install') {
    installed.add(id)
    removed.delete(id)
  } else {
    installed.delete(id)
    // Catalog-seeded items aren't in registry.installed, so record an explicit
    // removal to keep GET's catalog-seed merge from re-adding them.
    if (seededByCatalog) removed.add(id)
  }

  registry.installed = [...installed]
  registry.removed = [...removed]
  try {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2))
  } catch {
    return NextResponse.json({ error: 'Cannot write registry' }, { status: 500 })
  }

  const effective = new Set(registry.installed)
  for (const item of catalog.items) {
    if (item?.installed && item.id && !removed.has(item.id)) effective.add(item.id)
  }
  return NextResponse.json({ ok: true, installed: [...effective] })
}
