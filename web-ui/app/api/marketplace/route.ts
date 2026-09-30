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

/**
 * Locate the repository's marketplace directory (catalog.json + sources.json).
 * The web app is served from web-ui/, so walk up toward the repo root; fall back
 * to ~/GhostForge/marketplace for installed deployments.
 */
function marketplaceDir(): string {
  let probe = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(probe, 'marketplace')
    if (fs.existsSync(path.join(candidate, 'catalog.json')) || fs.existsSync(path.join(candidate, 'sources.json'))) {
      return candidate
    }
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return path.join(os.homedir(), 'GhostForge', 'marketplace')
}

// registry.json sits beside catalog.json — the same file the TUI reads
// (ROOT/marketplace/registry.json), so both surfaces share install state (ADR-004).
const MARKETPLACE_DIR = marketplaceDir()
const CATALOG_PATH = path.join(MARKETPLACE_DIR, 'catalog.json')
const SOURCES_PATH = path.join(MARKETPLACE_DIR, 'sources.json')
const REGISTRY_PATH = path.join(MARKETPLACE_DIR, 'registry.json')

interface CatalogItem {
  id: string; name: string; type: string; category: string; description: string
  source?: string; tags?: string[]; install_command?: string; install_command_windows?: string
  installed?: boolean
}

interface Source {
  id: string; name: string; type: string; description: string; url?: string
  docs?: string; install_command?: string; install_alt?: string; install_claude_code?: string
  verify_command?: string; categories?: string[]; trusted?: boolean; default?: boolean
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const catalog = readJSON<{ items: CatalogItem[] }>(CATALOG_PATH, { items: [] })
  const registry = readJSON<{ installed: string[]; removed?: string[] }>(REGISTRY_PATH, { installed: [], removed: [] })

  // registry.json is the source of truth, seeded by any catalog items that
  // ship pre-installed (installed: true) so the TUI and web UI never disagree.
  // Items the user explicitly removed (registry.removed) are not re-added.
  const removed = new Set(registry.removed ?? [])
  const installed = new Set((registry.installed ?? []).filter(id => !removed.has(id)))
  for (const item of catalog.items) {
    if (item?.installed && item.id && !removed.has(item.id)) installed.add(item.id)
  }

  // "Claude Marketplace" entries: every trusted external source (skills, plugins,
  // MCP, tools, memory, optimizers).
  const sourcesFile = readJSON<{ sources: Source[] }>(SOURCES_PATH, { sources: [] })
  const sources = (sourcesFile.sources ?? []).filter(s => s.type !== 'local')

  return NextResponse.json({ items: catalog.items ?? [], sources, installed: [...installed] })
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
  const { action, id } = parsed
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
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
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
