'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface MarketplaceItem {
  id: string
  name: string
  type: string
  category: string
  description: string
  source: string
  tags?: string[]
  install_command?: string
  installed?: boolean
}

const TYPE_COLORS: Record<string, string> = {
  skill:        'bg-violet-900/60 text-violet-300 border-violet-700',
  agent:        'bg-sky-900/60 text-sky-300 border-sky-700',
  template:     'bg-amber-900/60 text-amber-300 border-amber-700',
  'model-agent':'bg-emerald-900/60 text-emerald-300 border-emerald-700',
  tool:         'bg-rose-900/60 text-rose-300 border-rose-700',
}

const TYPE_ICONS: Record<string, string> = {
  skill: '⚡', agent: '🤖', template: '📋', 'model-agent': '🧠', tool: '🔧',
}

const CATEGORY_ICONS: Record<string, string> = {
  Quality: '✅', Security: '🔒', Git: '⚙️', Frontend: '🎨',
  Accessibility: '♿', 'AI Models': '🧠', Database: '🗄️', Architecture: '🏛️',
}

export default function MarketplacePage() {
  const router = useRouter()
  const [items, setItems] = useState<MarketplaceItem[]>([])
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'installed' | string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/marketplace')
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json() as { items: MarketplaceItem[]; installed: string[] }
      setItems(data.items ?? [])
      setInstalled(new Set(data.installed ?? []))
    } catch { /* keep empty */ }
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback(async (id: string, isInstalled: boolean) => {
    setActionId(id)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isInstalled ? 'remove' : 'install', id }),
      })
      const data = await res.json() as { installed?: string[] }
      if (data.installed) setInstalled(new Set(data.installed))
    } catch { /* ignore */ }
    setActionId(null)
  }, [])

  const categories = [...new Set(items.map(i => i.category))]
  const types = [...new Set(items.map(i => i.type))]

  const filtered = items.filter(item => {
    if (filter === 'installed' && !installed.has(item.id)) return false
    if (filter !== 'all' && filter !== 'installed' && item.category !== filter) return false
    if (typeFilter !== 'all' && item.type !== typeFilter) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !item.description.toLowerCase().includes(search.toLowerCase()) &&
        !(item.tags ?? []).some(t => t.toLowerCase().includes(search.toLowerCase()))) return false
    return true
  })

  return (
    <div className="min-h-[100dvh] bg-[#030712]" style={{ backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -5%, #0a1a2e50, transparent)' }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#030712]/90 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Link href="/dashboard" className="text-gray-500 hover:text-white transition text-lg leading-none">‹</Link>
          <span className="text-sm font-bold text-white">👻 GhostForge</span>
          <span className="text-[10px] font-mono text-gray-600 hidden sm:block">MARKETPLACE</span>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-400">
            {filtered.length} items
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/settings" className="rounded border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/40 transition">
              ⚙️ Models
            </Link>
            <Link href="/features" className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/40 transition">
              🔧 Features
            </Link>
          </div>
        </div>

        {/* Search + filters */}
        <div className="space-y-2 px-4 pb-3">
          <input
            type="search"
            placeholder="Search plugins, agents, templates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-white/20"
          />
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {/* Status filters */}
            {['all', 'installed'].map(f => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${filter === f ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                {f === 'all' ? 'All' : `✅ Installed (${installed.size})`}
              </button>
            ))}
            <div className="w-px bg-white/[0.06] mx-1 shrink-0" />
            {/* Category filters */}
            {categories.map(cat => (
              <button key={cat} type="button" onClick={() => setFilter(filter === cat ? 'all' : cat)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${filter === cat ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                {CATEGORY_ICONS[cat] ?? '📦'} {cat}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {['all', ...types].map(t => (
              <button key={t} type="button" onClick={() => setTypeFilter(t)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition border ${typeFilter === t ? 'border-white/20 bg-white/10 text-white' : 'border-transparent text-gray-600 hover:text-gray-400'}`}>
                {t === 'all' ? 'All types' : `${TYPE_ICONS[t] ?? '📦'} ${t}`}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="p-4 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-sky-400" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-600">No items match your search.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(item => {
              const isInstalled = installed.has(item.id)
              const isBusy = actionId === item.id
              return (
                <div key={item.id}
                  className={`flex flex-col gap-2 rounded-lg border p-3 transition ${isInstalled ? 'border-emerald-800/40 bg-emerald-950/10' : 'border-white/[0.06] bg-[#080d18] hover:border-white/[0.12]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[item.type] ?? TYPE_COLORS.tool}`}>
                        {TYPE_ICONS[item.type] ?? '📦'} {item.type}
                      </span>
                      <span className="text-[10px] text-gray-600">{CATEGORY_ICONS[item.category] ?? ''} {item.category}</span>
                    </div>
                    {isInstalled && <span className="text-[10px] text-emerald-500 shrink-0">✓ installed</span>}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-100">{item.name}</p>
                    <p className="mt-0.5 text-[11px] text-gray-500 leading-snug">{item.description}</p>
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-600">#{tag}</span>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => toggle(item.id, isInstalled)} disabled={isBusy}
                    className={`mt-auto rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                      isInstalled
                        ? 'border-red-800/50 bg-red-950/30 text-red-400 hover:bg-red-900/40'
                        : 'border-sky-800/50 bg-sky-950/30 text-sky-300 hover:bg-sky-900/40'
                    }`}>
                    {isBusy ? '…' : isInstalled ? 'Remove' : 'Install'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
