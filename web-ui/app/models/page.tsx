'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  LOCAL_MODELS,
  RUNNER_META,
  getLLMFitLabel,
  getRecommendedModel,
  type RunnerId,
} from '@/lib/local-models'

interface RunnerStatus {
  runner: RunnerId
  detected: boolean
  running: boolean
  statusLabel: string
}

interface LocalModelsResponse {
  runners: Record<RunnerId, RunnerStatus>
  installedModels: Record<RunnerId, string[]>
  machine: {
    ramGB: number
    availableGB: number
    cpuBrand: string
    appleSilicon: boolean
  }
}

interface RecommendationResponse {
  machine: {
    ramGB: number
    availableGB: number
    cpuBrand: string
    appleSilicon: boolean
  }
  recommendation: {
    runner: RunnerId
    model: string
    score: number
    llmfit: string
    summary: string
    reason: string
  } | null
}

export default function ModelsPage() {
  const router = useRouter()
  const [activeRunner, setActiveRunner] = useState<RunnerId>('ollama')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<LocalModelsResponse | null>(null)
  const [recommendation, setRecommendation] = useState<RecommendationResponse['recommendation'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [localRes, recRes] = await Promise.all([
        fetch('/api/models/local'),
        fetch('/api/models/recommend'),
      ])

      if (localRes.status === 401 || recRes.status === 401) {
        router.push('/login')
        return
      }

      const localData = await localRes.json() as LocalModelsResponse
      const recData = await recRes.json() as RecommendationResponse
      setCatalog(localData)
      setRecommendation(recData.recommendation)
    } catch {
      setToast('Could not load local model status.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (!document.cookie.split(';').some(cookie => cookie.trim().startsWith('gf_token='))) {
      router.push('/login')
      return
    }

    void loadData()
  }, [loadData, router])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const runnerModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return LOCAL_MODELS
      .filter(model => model.runner === activeRunner)
      .filter(model => {
        if (!normalizedQuery) return true
        return [model.name, model.description, model.contextLength, model.size].some(value => value.toLowerCase().includes(normalizedQuery))
      })
  }, [activeRunner, query])

  const recommendedModel = useMemo(() => getRecommendedModel(activeRunner), [activeRunner])

  const installedLookup = useMemo(() => {
    const installed = catalog?.installedModels[activeRunner] ?? []
    return new Set(installed.map(entry => entry.toLowerCase()))
  }, [activeRunner, catalog])

  const installModel = useCallback(async (runner: RunnerId, modelId: string) => {
    setInstalling(modelId)
    try {
      const res = await fetch('/api/models/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runner, model: modelId, action: 'install' }),
      })

      if (res.status === 401) {
        router.push('/login')
        return
      }

      const data = await res.json() as { message?: string; status?: string; externalUrl?: string }
      if (!res.ok) {
        setToast(data.message || 'Install request failed.')
        return
      }

      if (data.externalUrl) {
        window.open(data.externalUrl, '_blank', 'noopener,noreferrer')
      }

      setToast(data.message || 'Install started.')
      await loadData()
    } catch {
      setToast('Install request failed.')
    } finally {
      setInstalling(null)
    }
  }, [loadData, router])

  // ── Custom model install via LLMfit API ──────────────────────────────────
  const [customModelInput, setCustomModelInput] = useState('')
  const [customInstalling, setCustomInstalling] = useState(false)

  const installCustomModel = useCallback(async () => {
    const modelId = customModelInput.trim()
    if (!modelId) return
    setCustomInstalling(true)
    try {
      const res = await fetch('/api/llmfit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customModel: modelId }),
      })
      const data = await res.json() as { message?: string; error?: string }
      if (data.error) {
        setToast(`Error: ${data.error}`)
      } else {
        setToast(data.message || `Installing ${modelId} in background…`)
        setCustomModelInput('')
        setTimeout(() => void loadData(), 8000)
      }
    } catch {
      setToast('Install request failed. Is Ollama running?')
    } finally {
      setCustomInstalling(false)
    }
  }, [customModelInput, loadData])

  return (
    <div
      className="min-h-screen bg-[#030712] text-white"
      style={{
        backgroundImage: 'radial-gradient(circle at top, rgba(59,130,246,0.18), transparent 34%), linear-gradient(180deg, rgba(8,17,39,0.96), #030712)',
      }}
    >
      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-lg border border-cyan-400/30 bg-cyan-950/90 px-4 py-2 text-sm text-cyan-100 shadow-lg shadow-cyan-900/20">
          {toast}
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-blue-500/15 bg-[#030712]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="text-xs font-mono text-blue-400/60 transition hover:text-blue-300">← DASHBOARD</Link>
          <span className="text-blue-400/20">|</span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-cyan-400/70">GhostForge</p>
            <h1 className="font-mono text-lg font-bold tracking-[0.22em] text-blue-100 sm:text-xl">LOCAL MODEL MANAGER</h1>
          </div>
          <div className="ms-auto hidden rounded-full border border-blue-500/20 bg-blue-950/20 px-3 py-1 font-mono text-[10px] text-blue-200/75 sm:block">
            install · score · launch
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-5 shadow-[0_0_0_1px_rgba(59,130,246,0.05)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-cyan-400/80">JARVIS RECOMMENDATION</p>
            {recommendation ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 font-mono text-[11px] text-cyan-200">
                    {RUNNER_META[recommendation.runner].label}
                  </span>
                  <span className="font-mono text-xl font-bold text-blue-100">{recommendation.model}</span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                    {recommendation.llmfit}
                  </span>
                </div>
                <p className="text-sm text-slate-300">{recommendation.summary}</p>
                <p className="font-mono text-xs text-blue-200/60">{recommendation.reason} · LLMFit score {recommendation.score}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No recommendation available yet.</p>
            )}
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-blue-300/80">HOST PROFILE</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div>
                <p className="font-mono text-[10px] text-blue-400/50">CPU</p>
                <p className="text-sm text-slate-200">{catalog?.machine.cpuBrand ?? 'Detecting...'}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] text-blue-400/50">RAM</p>
                <p className="text-sm text-slate-200">{catalog ? `${catalog.machine.availableGB}GB free for models / ${catalog.machine.ramGB}GB total` : 'Detecting...'}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] text-blue-400/50">ARCH</p>
                <p className="text-sm text-slate-200">{catalog?.machine.appleSilicon ? 'Apple Silicon' : 'Intel / unknown'}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Custom Model Install (any Ollama model by name) ──────────────── */}
        <section className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-cyan-400/80 mb-3">INSTALL ANY MODEL</p>
          <p className="text-xs text-slate-400 mb-3">
            Install any model from <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">ollama.com/library</a> by entering its name below.
            Examples: <code className="text-cyan-300 text-[11px]">qwen3:14b</code>, <code className="text-cyan-300 text-[11px]">llama3.2:3b</code>, <code className="text-cyan-300 text-[11px]">deepseek-r1:8b</code>, <code className="text-cyan-300 text-[11px]">mistral:7b</code>
          </p>
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={customModelInput}
              onChange={e => setCustomModelInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !customInstalling) void installCustomModel() }}
              placeholder="e.g. qwen2.5-coder:7b"
              className="flex-1 min-w-0 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 font-mono text-sm text-cyan-100 placeholder-cyan-700 focus:border-cyan-400/60 focus:outline-none"
            />
            <button
              onClick={() => void installCustomModel()}
              disabled={!customModelInput.trim() || customInstalling}
              className="rounded-lg border border-cyan-500/40 bg-cyan-600/20 px-4 py-2 font-mono text-sm text-cyan-200 transition hover:bg-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {customInstalling ? 'Installing…' : '⬇ Install via Ollama'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Installation runs in the background — check Ollama logs or run <code className="text-cyan-700">ollama list</code> after a few minutes.</p>
        </section>

        <section className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(RUNNER_META) as RunnerId[]).map((runner) => {
                const status = catalog?.runners[runner]
                const isActive = runner === activeRunner
                return (
                  <button
                    key={runner}
                    type="button"
                    onClick={() => setActiveRunner(runner)}
                    className="rounded-lg border px-4 py-3 text-left transition"
                    style={{
                      borderColor: isActive ? 'rgba(59,130,246,0.5)' : 'rgba(59,130,246,0.18)',
                      background: isActive ? 'rgba(59,130,246,0.12)' : 'rgba(15,23,42,0.55)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${status?.running ? 'bg-emerald-400 shadow-[0_0_10px_rgba(34,197,94,0.6)]' : 'bg-slate-600'}`} />
                      <span className="font-mono text-sm text-blue-50">{RUNNER_META[runner].label}</span>
                    </div>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.28em] text-blue-300/45">
                      {status ? status.statusLabel : 'probing'}
                    </p>
                  </button>
                )
              })}
            </div>

            <label className="block lg:w-[320px]">
              <span className="sr-only">Search models</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models, size, context, use-case..."
                className="w-full rounded-lg border border-blue-500/20 bg-[#071123] px-3 py-3 text-sm text-white placeholder:text-blue-300/30 focus:border-blue-400/60 focus:outline-none"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-200">
              Recommended
            </span>
            <h2 className="font-mono text-lg font-semibold text-white">{recommendedModel?.name}</h2>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
              {recommendedModel ? getLLMFitLabel(recommendedModel.llmfit) : 'n/a'}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">{recommendedModel?.description}</p>
          <p className="mt-2 font-mono text-xs text-cyan-100/65">
            {RUNNER_META[activeRunner].helperText} · {recommendedModel?.size} · {recommendedModel?.contextLength} context
          </p>
        </section>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-transparent border-t-blue-400" />
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {runnerModels.map((model) => {
              const isInstalled = installedLookup.has(model.name.toLowerCase()) || installedLookup.has(model.id.toLowerCase())
              const isInstalling = installing === model.id
              const isRecommended = model.id === recommendedModel?.id
              const statusLabel = isInstalling ? 'installing' : isInstalled ? 'installed' : 'not installed'

              return (
                <article
                  key={model.id}
                  className="relative rounded-lg border border-blue-500/20 bg-blue-950/10 p-4 transition hover:border-blue-400/35 hover:bg-blue-950/20"
                >
                  {isRecommended && (
                    <div className="absolute -top-3 left-4 rounded-full border border-cyan-400/30 bg-cyan-400/12 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-200">
                      RECOMMENDED
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-mono text-base font-semibold text-white">{model.name}</h3>
                      <p className="mt-1 font-mono text-[11px] text-blue-300/50">{model.size} · {model.contextLength} context</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
                      model.llmfit === 'recommended'
                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                        : model.llmfit === 'good'
                          ? 'bg-cyan-500/10 text-cyan-200 border border-cyan-500/20'
                          : 'bg-slate-700/30 text-slate-300 border border-slate-500/20'
                    }`}>
                      {getLLMFitLabel(model.llmfit)}
                    </span>
                  </div>

                  <p className="mt-4 min-h-16 text-sm leading-6 text-slate-300">{model.description}</p>

                  <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wider text-blue-200/55">
                    <span className="rounded-full border border-blue-500/15 bg-black/20 px-2 py-1">runner {RUNNER_META[model.runner].label}</span>
                    <span className="rounded-full border border-blue-500/15 bg-black/20 px-2 py-1">ctx {model.contextLength}</span>
                    <span className="rounded-full border border-blue-500/15 bg-black/20 px-2 py-1">status {statusLabel}</span>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className={`font-mono text-xs ${isInstalled ? 'text-[#22c55e]' : isInstalling ? 'text-cyan-300' : 'text-slate-400'}`}>
                      {isInstalling ? 'Installing…' : isInstalled ? 'Installed' : 'Not installed'}
                    </span>
                    <button
                      type="button"
                      disabled={isInstalling}
                      onClick={() => void installModel(model.runner, model.id)}
                      className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 font-mono text-xs text-blue-100 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {model.runner === 'ollama' ? (isInstalling ? 'Installing…' : 'Install') : RUNNER_META[model.runner].installLabel}
                    </button>
                  </div>
                </article>
              )
            })}

            {runnerModels.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-blue-500/20 bg-blue-950/10 p-8 text-center text-slate-400">
                No models matched your search.
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
