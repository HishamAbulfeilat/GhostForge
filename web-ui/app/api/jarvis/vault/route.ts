/**
 * Knowledge Vault API — Persistent entity/fact store (inspired by vierisid/jarvis vault)
 * GET  /api/jarvis/vault?query=<search>
 * POST /api/jarvis/vault  { action: 'save', category, key, value }
 * POST /api/jarvis/vault  { action: 'search', query }
 * POST /api/jarvis/vault  { action: 'clear' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const dynamic = 'force-dynamic'

type VaultCategory = 'identity' | 'preferences' | 'projects' | 'relationships' | 'notes' | 'facts'

interface VaultEntry {
  id: string
  category: VaultCategory
  key: string
  value: string
  ts: number
}

interface VaultStore {
  entries: VaultEntry[]
  version: number
}

const VAULT_DIR  = join(homedir(), '.ghostforge', 'jarvis')
const VAULT_FILE = join(VAULT_DIR, 'vault.json')
const MAX_ENTRIES = 500
const MAX_VALUE_CHARS = 500

function loadVault(): VaultStore {
  try {
    if (existsSync(VAULT_FILE)) {
      return JSON.parse(readFileSync(VAULT_FILE, 'utf8')) as VaultStore
    }
  } catch { /* corrupted — start fresh */ }
  return { entries: [], version: 1 }
}

function saveVault(store: VaultStore): void {
  mkdirSync(VAULT_DIR, { recursive: true })
  // Keep only most recent MAX_ENTRIES
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.sort((a, b) => b.ts - a.ts).slice(0, MAX_ENTRIES)
  }
  writeFileSync(VAULT_FILE, JSON.stringify(store, null, 2))
}

function searchVault(store: VaultStore, query: string): VaultEntry[] {
  const q = query.toLowerCase()
  return store.entries
    .filter(e => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q) || e.category.includes(q))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20)
}

function formatVaultForPrompt(store: VaultStore): string {
  const grouped: Record<string, VaultEntry[]> = {}
  for (const e of store.entries) {
    grouped[e.category] = grouped[e.category] || []
    grouped[e.category].push(e)
  }
  const parts: string[] = []
  for (const [cat, entries] of Object.entries(grouped)) {
    const lines = entries.slice(0, 10).map(e => `  ${e.key}: ${e.value.slice(0, 100)}`)
    parts.push(`${cat.charAt(0).toUpperCase() + cat.slice(1)}:\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const query = url.searchParams.get('query') || ''
  const vault = loadVault()

  if (query) {
    return NextResponse.json({ results: searchVault(vault, query), total: vault.entries.length })
  }

  return NextResponse.json({
    entries: vault.entries.slice(0, 50),
    total: vault.entries.length,
    formatted: formatVaultForPrompt(vault),
  })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    action?: string
    category?: VaultCategory
    key?: string
    value?: string
    query?: string
    entries?: Array<{ category: VaultCategory; key: string; value: string }>
  }

  const vault = loadVault()

  if (body.action === 'save' || body.action === 'upsert') {
    const { category = 'notes', key, value } = body
    if (!key || !value) return NextResponse.json({ error: 'key and value required' }, { status: 400 })

    // Upsert: replace existing entry for same category+key
    const existing = vault.entries.findIndex(e => e.category === category && e.key === key)
    const entry: VaultEntry = {
      id: `${category}-${key}-${Date.now()}`,
      category,
      key,
      value: value.slice(0, MAX_VALUE_CHARS),
      ts: Date.now(),
    }
    if (existing >= 0) vault.entries[existing] = entry
    else vault.entries.push(entry)
    saveVault(vault)
    return NextResponse.json({ ok: true, entry })
  }

  if (body.action === 'batch') {
    // Batch save multiple entries at once (used by AI for silent memory saving)
    const { entries = [] } = body
    for (const e of entries.slice(0, 20)) {
      const idx = vault.entries.findIndex(v => v.category === e.category && v.key === e.key)
      const entry: VaultEntry = { id: `${e.category}-${e.key}-${Date.now()}`, ...e, value: e.value.slice(0, MAX_VALUE_CHARS), ts: Date.now() }
      if (idx >= 0) vault.entries[idx] = entry
      else vault.entries.push(entry)
    }
    saveVault(vault)
    return NextResponse.json({ ok: true, saved: entries.length })
  }

  if (body.action === 'search') {
    const { query = '' } = body
    return NextResponse.json({ results: searchVault(vault, query), total: vault.entries.length })
  }

  if (body.action === 'delete') {
    const { key, category } = body
    vault.entries = vault.entries.filter(e => !(e.key === key && e.category === category))
    saveVault(vault)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'clear') {
    saveVault({ entries: [], version: 1 })
    return NextResponse.json({ ok: true, message: 'Vault cleared' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
