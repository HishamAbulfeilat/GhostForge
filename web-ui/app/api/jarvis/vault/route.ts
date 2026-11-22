/**
 * Knowledge Vault API — Persistent entity/fact store (inspired by vierisid/jarvis vault)
 * GET  /api/jarvis/vault?query=<search>
 * POST /api/jarvis/vault  { action: 'save', category, key, value }
 * POST /api/jarvis/vault  { action: 'search', query }
 * POST /api/jarvis/vault  { action: 'clear' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { JarvisStoreError, readVault, updateVault, upsertEntry, type VaultCategory, type VaultEntry, type VaultStore } from '@/lib/jarvis-store'

export const dynamic = 'force-dynamic'

// Each user has their own vault (~/.ghostforge/users/<username>/jarvis/vault.json);
// every action needs the `semantic_memory` permission.
const MAX_VALUE_CHARS = 500

function storeError(err: unknown) {
  const message = err instanceof JarvisStoreError ? err.message : 'Could not open the knowledge vault'
  return NextResponse.json({ error: message }, { status: 500 })
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
  const user = await requirePermission(req, 'semantic_memory')
  if (user instanceof NextResponse) return user

  const url = new URL(req.url)
  const query = url.searchParams.get('query') || ''
  let vault: VaultStore
  try {
    vault = await readVault(user)
  } catch (err) {
    return storeError(err)
  }

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
  const user = await requirePermission(req, 'semantic_memory')
  if (user instanceof NextResponse) return user

  const body = await req.json().catch(() => ({})) as {
    action?: string
    category?: VaultCategory
    key?: string
    value?: string
    query?: string
    entries?: Array<{ category: VaultCategory; key: string; value: string }>
  }

  try {
    if (body.action === 'save' || body.action === 'upsert') {
      const { category = 'notes', key, value } = body
      if (typeof key !== 'string' || typeof value !== 'string' || !key || !value) {
        return NextResponse.json({ error: 'key and value required' }, { status: 400 })
      }
      // Upsert: replace existing entry for same category+key
      const entry: VaultEntry = {
        id: `${category}-${key}-${Date.now()}`,
        category,
        key,
        value: value.slice(0, MAX_VALUE_CHARS),
        ts: Date.now(),
      }
      await updateVault(user, vault => upsertEntry(vault, entry))
      return NextResponse.json({ ok: true, entry })
    }

    if (body.action === 'batch') {
      // Batch save multiple entries at once (used by AI for silent memory saving)
      const entries = (Array.isArray(body.entries) ? body.entries : [])
        .filter(e => e && typeof e.key === 'string' && typeof e.value === 'string' && e.key && e.value)
        .slice(0, 20)
      await updateVault(user, vault => {
        for (const e of entries) {
          const category = e.category || 'notes'
          upsertEntry(vault, { id: `${category}-${e.key}-${Date.now()}`, category, key: e.key, value: e.value.slice(0, MAX_VALUE_CHARS), ts: Date.now() })
        }
      })
      return NextResponse.json({ ok: true, saved: entries.length })
    }

    if (body.action === 'search') {
      const { query = '' } = body
      const vault = await readVault(user)
      return NextResponse.json({ results: searchVault(vault, String(query)), total: vault.entries.length })
    }

    if (body.action === 'delete') {
      const { key, category } = body
      await updateVault(user, vault => {
        vault.entries = vault.entries.filter(e => !(e.key === key && e.category === category))
      })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'clear') {
      await updateVault(user, () => ({ entries: [], version: 1 }))
      return NextResponse.json({ ok: true, message: 'Vault cleared' })
    }
  } catch (err) {
    return storeError(err)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
