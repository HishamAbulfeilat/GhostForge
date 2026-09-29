'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import HFModelCard, { type HFModel } from '@/components/HFModelCard'

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

interface AwesomeApp {
  id: string
  name: string
  path: string
  category: string
  description: string
  url: string
}

type Tab = 'claude' | 'commands' | 'huggingface' | 'awesome'

interface Source {
  id: string
  name: string
  type: string
  description: string
  url?: string
  docs?: string
  install_command?: string
  install_alt?: string
  install_claude_code?: string
  verify_command?: string
  categories?: string[]
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

const HF_SORT_OPTIONS = [
  { value: 'downloads', label: 'Most Downloads' },
  { value: 'likes', label: 'Most Likes' },
  { value: 'lastModified', label: 'Recently Updated' },
] as const

const HF_TYPE_FILTERS = [
  { value: 'all', label: 'All Types' },
  { value: 'LLM', label: '💬 LLM' },
  { value: 'Vision', label: '👁️ Vision' },
  { value: 'Audio', label: '🔊 Audio' },
  { value: 'Diffusion', label: '🎨 Diffusion' },
  { value: 'Other', label: '📦 Other' },
] as const

const AWESOME_CATEGORY_ICONS: Record<string, string> = {
  agents: '🤖', rag: '📚', voice: '🔊', 'multi-agent': '👥',
  'generative-ui': '🎨', 'computer-use': '🖥️', code: '💻', creative: '✨', other: '📦',
}

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<Tab>('claude')

  return (
    <div className="min-h-[100dvh] bg-[#030712]" style={{ backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -5%, #0a1a2e50, transparent)' }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#030712]/90 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Link href="/dashboard" className="text-gray-500 hover:text-white transition text-lg leading-none">‹</Link>
          <span className="text-sm font-bold text-white">👻 GhostForge</span>
          <span className="text-[10px] font-mono text-gray-600 hidden sm:block">MARKETPLACE</span>
          <div className="ms-auto flex items-center gap-2">
            <Link href="/settings" className="rounded border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/40 transition">
              ⚙️ Models
            </Link>
            <Link href="/features" className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/40 transition">
              🔧 Features
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-4 pt-1">
          {([
            { key: 'claude' as Tab, label: 'Claude Marketplace', icon: '🧩' },
            { key: 'commands' as Tab, label: 'Commands', icon: '⚡' },
            { key: 'huggingface' as Tab, label: 'HuggingFace', icon: '🤗' },
            { key: 'awesome' as Tab, label: 'Awesome LLM Apps', icon: '🏆' },
          ]).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-t px-3 py-1.5 text-xs font-medium transition border border-b-0 ${
                activeTab === tab.key
                  ? 'border-white/[0.12] bg-white/[0.06] text-white'
                  : 'border-transparent text-gray-600 hover:text-gray-400'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'claude' && <ClaudeTab />}
      {activeTab === 'commands' && <CommandsTab />}
      {activeTab === 'huggingface' && <HuggingFaceTab />}
      {activeTab === 'awesome' && <AwesomeLLMTab />}
    </div>
  )
}

/* ─────────────────────── Claude Marketplace Tab ─────────────────────── */

function ClaudeTab() {
  const router = useRouter()
  const [sources, setSources] = useState<Source[]>([])
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [copied, setCopied] = useState<string | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/marketplace')
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json() as { sources: Source[]; installed: string[] }
      setSources(data.sources ?? [])
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

  const copy = useCallback((id: string, cmd: string) => {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1500)
    }).catch(() => {})
  }, [])

  const categories = useMemo(
    () => [...new Set(sources.flatMap(s => s.categories ?? []))].sort(),
    [sources],
  )

  const filtered = sources.filter(s => {
    if (category !== 'all' && !(s.categories ?? []).includes(category)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q) &&
          !(s.categories ?? []).some(c => c.toLowerCase().includes(q))) return false
    }
    return true
  })

  return (
    <>
      <div className="space-y-2 px-4 py-3">
        <input
          type="search"
          placeholder="Search Claude skills, plugins, MCP servers, tools…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-white/20"
        />
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {['all', ...categories].map(c => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${category === c ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-600">{filtered.length} of {sources.length} entries</span>
      </div>

      <main className="px-4 pb-8 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-fuchsia-400" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-600">No entries match your search.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(s => {
              const isInstalled = installed.has(s.id)
              const isBusy = actionId === s.id
              const cmd = s.install_claude_code || s.install_command || ''
              return (
                <div key={s.id}
                  className={`flex flex-col gap-2 rounded-lg border p-3 transition ${isInstalled ? 'border-emerald-800/40 bg-emerald-950/10' : 'border-white/[0.06] bg-[#080d18] hover:border-white/[0.12]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-100 leading-tight">{s.name}</p>
                    {isInstalled && <span className="shrink-0 text-[10px] text-emerald-500">✓ installed</span>}
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug line-clamp-4">{s.description}</p>
                  {s.categories && s.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {s.categories.slice(0, 4).map(c => (
                        <span key={c} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-600">#{c}</span>
                      ))}
                    </div>
                  )}
                  {cmd && (
                    <button type="button" onClick={() => copy(s.id, cmd)}
                      title="Copy install command"
                      className="rounded border border-white/[0.08] bg-black/30 px-2 py-1 text-left font-mono text-[10px] text-gray-400 hover:border-white/20 truncate">
                      {copied === s.id ? '✓ copied' : `$ ${cmd}`}
                    </button>
                  )}
                  <div className="mt-auto flex gap-1.5">
                    <button type="button" onClick={() => toggle(s.id, isInstalled)} disabled={isBusy}
                      className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                        isInstalled
                          ? 'border-red-800/50 bg-red-950/30 text-red-400 hover:bg-red-900/40'
                          : 'border-sky-800/50 bg-sky-950/30 text-sky-300 hover:bg-sky-900/40'
                      }`}>
                      {isBusy ? '…' : isInstalled ? 'Mark not installed' : 'Mark installed'}
                    </button>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="rounded border border-white/[0.08] px-3 py-1.5 text-center text-xs font-medium text-gray-400 hover:border-white/20 hover:text-white">
                        Open ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}

/* ─────────────────────── Commands Tab ─────────────────────── */

function CommandsTab() {
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
    <>
      {/* Search + filters */}
      <div className="space-y-2 px-4 py-3">
        <input
          type="search"
          placeholder="Search plugins, agents, templates…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-white/20"
        />
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {['all', 'installed'].map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${filter === f ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
              {f === 'all' ? 'All' : `✅ Installed (${installed.size})`}
            </button>
          ))}
          <div className="w-px bg-white/[0.06] mx-1 shrink-0" />
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
        <span className="text-[10px] text-gray-600">{filtered.length} items</span>
      </div>

      <main className="px-4 pb-8 max-w-6xl mx-auto">
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
    </>
  )
}

/* ─────────────────── HuggingFace Tab ─────────────────── */

function HuggingFaceTab() {
  const [models, setModels] = useState<HFModel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<string>('downloads')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [searchDebounced, setSearchDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ endpoint: 'models', sort })
      if (searchDebounced) params.set('q', searchDebounced)
      if (typeFilter !== 'all') params.set('filter', typeFilter)
      const res = await fetch(`/api/huggingface?${params}`)
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json() as { items: HFModel[] }
      setModels(data.items ?? [])
    } catch {
      setModels([])
    }
    setLoading(false)
  }, [sort, searchDebounced, typeFilter])

  useEffect(() => { void loadModels() }, [loadModels])

  const displayModels = useMemo(() => {
    let list = models
    if (typeFilter !== 'all') {
      list = list.filter(m => m.type === typeFilter)
    }
    return list
  }, [models, typeFilter])

  return (
    <>
      {/* Search + controls */}
      <div className="space-y-2 px-4 py-3">
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search HuggingFace models…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-white/20"
          />
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-400 outline-none focus:border-white/20 appearance-none cursor-pointer"
          >
            {HF_SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {HF_TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition border ${
                typeFilter === f.value
                  ? 'border-white/20 bg-white/10 text-white'
                  : 'border-transparent text-gray-600 hover:text-gray-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-600">{displayModels.length} models</span>
      </div>

      <main className="px-4 pb-8 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-violet-400" />
          </div>
        ) : displayModels.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-600">No models found. Try a different search.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayModels.map(model => (
              <HFModelCard
                key={model.id}
                model={model}
                selected={selectedModel === model.id}
                onSelect={m => setSelectedModel(prev => prev === m.id ? null : m.id)}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}

/* ─────────────────── Awesome LLM Apps Tab ─────────────────── */

function AwesomeLLMTab() {
  const [apps, setApps] = useState<AwesomeApp[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const loadApps = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ mode: 'catalog' })
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      if (search) params.set('q', search)
      const res = await fetch(`/api/awesome-llm-apps?${params}`)
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json() as { items: AwesomeApp[]; categories: string[] }
      setApps(data.items ?? [])
      setCategories(data.categories ?? [])
    } catch {
      setApps([])
      setCategories([])
    }
    setLoading(false)
  }, [categoryFilter, search])

  useEffect(() => { void loadApps() }, [loadApps])

  return (
    <>
      {/* Search + categories */}
      <div className="space-y-2 px-4 py-3">
        <input
          type="search"
          placeholder="Search awesome LLM apps…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-white/20"
        />
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
              categoryFilter === 'all' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                categoryFilter === cat ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {AWESOME_CATEGORY_ICONS[cat] ?? '📦'} {cat}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-600">{apps.length} apps</span>
      </div>

      <main className="px-4 pb-8 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-amber-400" />
          </div>
        ) : apps.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-600">No apps found.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {apps.map(app => (
              <div
                key={app.id}
                className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#080d18] p-3.5 transition hover:border-white/[0.12]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-100 leading-tight">{app.name}</p>
                  <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-700/40">
                    {AWESOME_CATEGORY_ICONS[app.category] ?? '📦'} {app.category}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 leading-snug line-clamp-3">{app.description}</p>
                <div className="mt-auto flex gap-1.5">
                  {app.url && app.url !== 'https://api.github.com/repos/Shubhamsaboo/awesome-llm-apps' ? (
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded border border-sky-800/50 bg-sky-950/30 px-3 py-1.5 text-center text-xs font-medium text-sky-300 transition hover:bg-sky-900/40"
                    >
                      View Project ↗
                    </a>
                  ) : (
                    <a
                      href="https://github.com/Shubhamsaboo/awesome-llm-apps"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded border border-sky-800/50 bg-sky-950/30 px-3 py-1.5 text-center text-xs font-medium text-sky-300 transition hover:bg-sky-900/40"
                    >
                      Browse Repo ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
