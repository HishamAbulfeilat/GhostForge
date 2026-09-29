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

// User-installed state lives in the home dir so the version-controlled repo
// files are never mutated by install/remove clicks.
const REGISTRY_PATH = path.join(os.homedir(), '.ghostforge', 'marketplace', 'registry.json')

interface CatalogItem {
  id: string; name: string; type: string; category: string; description: string
  source?: string; tags?: string[]; install_command?: string
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

  const dir = marketplaceDir()
  const catalog = readJSON<{ items: CatalogItem[] }>(path.join(dir, 'catalog.json'), { items: [] })
  const sourcesFile = readJSON<{ sources: Source[] }>(path.join(dir, 'sources.json'), { sources: [] })
  const registry = readJSON<{ installed: string[] }>(REGISTRY_PATH, { installed: [] })

  // "Claude Marketplace" entries: every trusted external source (skills, plugins,
  // MCP, tools, memory, optimizers) — this is the "claude marketplace and everything".
  const sources = (sourcesFile.sources ?? []).filter(s => s.type !== 'local')

  return NextResponse.json({
    items: catalog.items ?? [],
    sources,
    installed: registry.installed ?? [],
  })
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
    return NextResponse.json({ error: 'Provide action "install"|"remove" and an id' }, { status: 400 })
  }

  const registry = readJSON<{ installed: string[] }>(REGISTRY_PATH, { installed: [] })
  const installed = new Set(registry.installed ?? [])
  if (action === 'install') installed.add(id)
  else installed.delete(id)
  registry.installed = [...installed]

  try {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2))
  } catch {
    return NextResponse.json({ error: 'Cannot write registry' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, installed: registry.installed })
}
