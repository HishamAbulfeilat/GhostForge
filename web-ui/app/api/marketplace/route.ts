import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getCurrentUser, hasPermission, isAuthorizedRequest } from '@/lib/auth'
import { requirePermission } from '@/lib/access'
import { getEffectiveMarketplaceState, recordMarked, recordRemoved } from '@/lib/marketplace-state'

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
// The effective sets are computed by lib/marketplace-state.ts, which mirrors
// tui/lib/marketplace-state.js (parity-tested).
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

// Install/remove marks are shared by every user of this server (and the TUI),
// so changing them is an admin action.
const EDIT_PERMISSION = 'admin_tools'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const catalog = readJSON<{ items: CatalogItem[] }>(CATALOG_PATH, { items: [] })
  const registryRaw = readJSON<unknown>(REGISTRY_PATH, {})

  // installed: verified installs (TUI ran the command) + catalog-seeded items,
  // minus registry.removed. marked: ids someone marked installed by hand on the
  // web — nothing ran, so they are reported separately. Non-string entries in
  // registry.installed (older "Generate" records) are ignored, exactly like the TUI.
  const { installedSet, markedSet } = getEffectiveMarketplaceState(catalog, registryRaw)

  // "Claude Marketplace" entries: every trusted external source (skills, plugins,
  // MCP, tools, memory, optimizers).
  const sourcesFile = readJSON<{ sources: Source[] }>(SOURCES_PATH, { sources: [] })
  const sources = (sourcesFile.sources ?? []).filter(s => s.type !== 'local')

  const user = await getCurrentUser(req).catch(() => null)
  return NextResponse.json({
    items: catalog.items ?? [],
    sources,
    installed: [...installedSet],
    marked: [...markedSet],
    canEdit: hasPermission(user, EDIT_PERMISSION),
  })
}

export async function POST(req: NextRequest) {
  const access = await requirePermission(req, EDIT_PERMISSION)
  if (access instanceof NextResponse) return access

  let parsed: { action?: string; id?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action, id } = parsed ?? {}
  // 'install' is accepted as an alias of 'mark' for older clients: the web UI
  // never runs an install command, it only records a mark.
  const op = action === 'mark' || action === 'install' ? 'mark' : action === 'unmark' || action === 'remove' ? 'unmark' : null
  if (typeof id !== 'string' || !id || id.length > 200 || !op) {
    return NextResponse.json({ error: 'Invalid action or id' }, { status: 400 })
  }

  const catalog = readJSON<{ items: { id: string; installed?: boolean }[] }>(CATALOG_PATH, { items: [] })
  // A registry that exists but can't be parsed is left untouched rather than
  // overwritten (it also holds custom_agents, custom_models and generated[]).
  let registryRaw: unknown = {}
  try {
    registryRaw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return NextResponse.json({ error: 'The marketplace registry (registry.json) could not be read' }, { status: 500 })
    }
  }
  const seededByCatalog = (catalog.items ?? []).some(i => i?.id === id && i.installed)

  const registry = op === 'mark' ? recordMarked(registryRaw, id) : recordRemoved(registryRaw, id, seededByCatalog)
  try {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2))
  } catch {
    return NextResponse.json({ error: 'Cannot write the marketplace registry (registry.json)' }, { status: 500 })
  }

  const { installedSet, markedSet } = getEffectiveMarketplaceState(catalog, registry)
  return NextResponse.json({ ok: true, installed: [...installedSet], marked: [...markedSet] })
}
