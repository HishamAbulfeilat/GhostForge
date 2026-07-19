'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface ModelEntry {
  id: string
  name: string
  provider: string
  providerName: string
  description: string
  free: boolean
  requiresKey: string
  category: string
  context: string
}

interface ModelsData {
  models: ModelEntry[]
  activeModel: string
  activeProvider: string
  keysAvailable: Record<string, boolean>
}

const PROVIDER_COLORS: Record<string, string> = {
  google:      'border-blue-800/50 bg-blue-950/20 text-blue-300',
  openrouter:  'border-violet-800/50 bg-violet-950/20 text-violet-300',
  groq:        'border-orange-800/50 bg-orange-950/20 text-orange-300',
  nvidia:      'border-green-800/50 bg-green-950/20 text-green-300',
}

const PROVIDER_ICONS: Record<string, string> = {
  google: '🔵', openrouter: '🔀', groq: '⚡', nvidia: '🟢',
}

const CATEGORY_BADGE: Record<string, string> = {
  premium:     'bg-amber-900/60 text-amber-300',
  recommended: 'bg-emerald-900/60 text-emerald-300',
  free:        'bg-sky-900/60 text-sky-300',
}

export default function SettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<ModelsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/models')
      if (res.status === 401) { router.push('/login'); return }
      setData(await res.json() as ModelsData)
    } catch { /* ignore */ }
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  const switchModel = useCallback(async (modelId: string, provider: string) => {
    setSwitching(modelId)
    try {
      await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, provider }),
      })
      setData(prev => prev ? { ...prev, activeModel: modelId, activeProvider: provider } : prev)
      setToast(`✓ Switched to ${modelId}`)
      setTimeout(() => setToast(null), 3000)
    } catch { /* ignore */ }
    setSwitching(null)
  }, [])

  const grouped = data?.models.reduce<Record<string, ModelEntry[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider].push(m)
    return acc
  }, {}) ?? {}

  return (
    <div className="min-h-[100dvh] bg-[#030712]" style={{ backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -5%, #1a0a0050, transparent)' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-emerald-700/50 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-300 shadow-lg backdrop-blur">
          {toast}
        </div>
      )}

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/[0.06] bg-[#030712]/90 px-4 py-2.5 backdrop-blur">
        <Link href="/dashboard" className="text-gray-500 hover:text-white transition text-lg leading-none">‹</Link>
        <span className="text-sm font-bold text-white">👻 GhostForge</span>
        <span className="text-[10px] font-mono text-gray-600 hidden sm:block">SETTINGS · AI MODELS</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/marketplace" className="rounded border border-sky-800/50 bg-sky-950/30 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/40 transition">
            🛒 Marketplace
          </Link>
          <Link href="/chat" className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/40 transition">
            💬 Chat
          </Link>
        </div>
      </header>

      <main className="p-4 max-w-4xl mx-auto space-y-6">
        {/* Active model banner */}
        {data && (
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-1">Currently Active</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg">{PROVIDER_ICONS[data.activeProvider] ?? '🤖'}</span>
              <div>
                <p className="text-sm font-bold text-emerald-300">{data.activeModel}</p>
                <p className="text-[11px] text-gray-500">via {data.activeProvider} · changes apply to next chat message</p>
              </div>
            </div>
          </div>
        )}

        {/* Key status */}
        {data && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600">API Keys Detected</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.keysAvailable).map(([provider, hasKey]) => (
                <div key={provider} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${hasKey ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300' : 'border-gray-800 bg-gray-900/30 text-gray-600'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${hasKey ? 'bg-emerald-400' : 'bg-gray-700'}`} />
                  {provider}
                  {!hasKey && <span className="text-[10px]">— add key in .env.local</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-sky-400" />
          </div>
        ) : (
          Object.entries(grouped).map(([provider, models]) => (
            <div key={provider}>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-base">{PROVIDER_ICONS[provider] ?? '🤖'}</span>
                <span className="text-sm font-bold text-gray-200">{models[0]?.providerName ?? provider}</span>
                {!data?.keysAvailable[provider] && (
                  <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] text-red-400">no key</span>
                )}
                <div className="flex-1 border-t border-white/[0.04]" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {models.map(model => {
                  const isActive = data?.activeModel === model.id
                  const isSwitching = switching === model.id
                  const hasKey = data?.keysAvailable[model.provider] ?? false
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => switchModel(model.id, model.provider)}
                      disabled={isSwitching || isActive}
                      className={`
                        relative flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition
                        disabled:cursor-default
                        ${isActive
                          ? 'border-emerald-700/60 bg-emerald-950/20 ring-1 ring-emerald-700/30'
                          : `${PROVIDER_COLORS[model.provider] ?? 'border-gray-800 bg-gray-900/30 text-gray-300'} hover:brightness-110 active:scale-[0.99]`
                        }
                      `}
                    >
                      {isActive && (
                        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] text-white font-bold">✓</span>
                      )}
                      {isSwitching && (
                        <div className="absolute right-2 top-2 h-4 w-4 animate-spin rounded-full border-2 border-transparent border-t-current opacity-60" />
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">{model.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_BADGE[model.category] ?? CATEGORY_BADGE.free}`}>
                          {model.category}
                        </span>
                        {!hasKey && <span className="text-[10px] text-red-500">⚠ no key</span>}
                      </div>
                      <p className="text-[11px] text-gray-500 leading-snug">{model.description}</p>
                      <div className="flex items-center gap-3 text-[10px] text-gray-600">
                        <span>📐 {model.context}</span>
                        <code className="text-gray-700 truncate max-w-[140px]">{model.requiresKey}</code>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}

        {/* Add key instructions */}
        <div className="rounded-lg border border-white/[0.05] bg-[#080d18] p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Add API Keys</p>
          <p className="text-xs text-gray-500">Edit <code className="text-gray-400">~/GhostForge/web-ui/.env.local</code> and add:</p>
          <div className="space-y-1 font-mono text-xs">
            {[
              { key: 'GOOGLE_GENERATIVE_AI_API_KEY', url: 'aistudio.google.com', hint: 'Free with Google AI Plus' },
              { key: 'OPENROUTER_API_KEY', url: 'openrouter.ai/keys', hint: 'Free tier available' },
              { key: 'GROQ_API_KEY', url: 'console.groq.com', hint: 'Free, ultra-fast inference' },
              { key: 'NVIDIA_API_KEY', url: 'build.nvidia.com', hint: 'Free tier, Llama 3.3 70B' },
            ].map(item => (
              <div key={item.key} className="flex flex-col gap-0.5 rounded bg-black/30 px-3 py-2">
                <code className="text-emerald-400">{item.key}=your_key_here</code>
                <span className="text-gray-600 text-[10px]">{item.hint} · {item.url}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-600">Then restart the web UI for new keys to take effect.</p>
        </div>
      </main>
    </div>
  )
}
