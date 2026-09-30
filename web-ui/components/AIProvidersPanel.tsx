'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ProviderModel { id: string; label: string; free: boolean }

interface ProviderRow {
  id: string
  name: string
  keyEnv: string | null
  keyUrl: string | null
  paid: boolean
  keySource: 'none-needed' | 'env' | 'settings' | 'missing'
  available: boolean
  defaultModel: string
  models: ProviderModel[]
  error: string | null
}

interface CustomModelRow { id: string; name: string; baseURL: string; model: string; hasKey: boolean; free?: boolean }

interface ModelsResponse {
  providers: ProviderRow[]
  custom: CustomModelRow[]
  ollama: { running: boolean; models: string[] }
  omniroute: { up: boolean; url: string; dashboard: string }
  active: { provider: string; model: string }
  isDefault: boolean
  canEditKeys: boolean
}

type Selection = { provider: string; model: string }

const KEY_SOURCE_LABEL: Record<ProviderRow['keySource'], string> = {
  'none-needed': 'no key needed',
  env: 'key from .env',
  settings: 'key saved in Settings',
  missing: 'no key yet',
}

const input = 'rounded border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-sky-500/50'
const button = 'rounded border px-3 py-1.5 text-xs transition disabled:opacity-40'

function ModelList({ models, provider, active, disabled, onSelect }: {
  models: ProviderModel[]
  provider: string
  active: Selection
  disabled: boolean
  onSelect: (s: Selection) => void
}) {
  const [filter, setFilter] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return models.filter(m => (!freeOnly || m.free) && (!q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)))
  }, [models, filter, freeOnly])
  const freeCount = models.filter(m => m.free).length

  return (
    <div className="space-y-2">
      {models.length > 8 && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter models…" aria-label="Filter models" className={`min-w-[160px] flex-1 ${input}`} />
          {freeCount > 0 && freeCount < models.length && (
            <label className="flex items-center gap-1 text-[11px] text-gray-400">
              <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} /> free only
            </label>
          )}
        </div>
      )}
      <div className="max-h-64 overflow-y-auto rounded border border-white/[0.05]">
        {shown.map(m => {
          const isActive = active.provider === provider && active.model === m.id
          return (
            <button key={m.id} type="button" disabled={isActive || disabled} onClick={() => onSelect({ provider, model: m.id })}
              title={disabled ? 'Add a key for this provider first' : `Use ${m.id}`}
              className={`flex w-full items-center gap-2 border-b border-white/[0.03] px-3 py-1.5 text-start text-xs transition last:border-0 disabled:cursor-default ${isActive ? 'bg-emerald-950/40 text-emerald-300' : disabled ? 'text-gray-600' : 'text-gray-300 hover:bg-white/[0.04]'}`}>
              <span className="truncate">{m.label}</span>
              {m.label !== m.id && <code className="truncate text-[10px] text-gray-600">{m.id}</code>}
              {m.free && <span className="ms-auto shrink-0 rounded bg-sky-950/60 px-1.5 text-[10px] text-sky-300">free</span>}
              {isActive && <span className="shrink-0 text-[10px]">✓ active</span>}
            </button>
          )
        })}
        {shown.length === 0 && <p className="px-3 py-2 text-[11px] text-gray-600">No models match.</p>}
      </div>
    </div>
  )
}

function ProviderCard({ provider, active, canEditKeys, onSelect, onKeySaved }: {
  provider: ProviderRow
  active: Selection
  canEditKeys: boolean
  onSelect: (s: Selection) => void
  onKeySaved: (message: string) => Promise<void>
}) {
  const [open, setOpen] = useState(provider.id === active.provider)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const freeCount = provider.models.filter(m => m.free).length

  const saveKey = async (value: string) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/models/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.id, key: value }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      setKey('')
      await onKeySaved(`${value ? 'Key saved' : 'Key removed'} for ${provider.name}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  return (
    <div className={`rounded-lg border p-3 ${active.provider === provider.id ? 'border-emerald-800/50 bg-emerald-950/10' : 'border-white/[0.06] bg-[#080d18]'}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full flex-wrap items-center gap-2 text-start">
        <span className={`h-2 w-2 rounded-full ${provider.available ? 'bg-emerald-400' : 'bg-gray-700'}`} />
        <span className="text-sm font-bold text-gray-200">{provider.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${provider.paid ? 'bg-amber-950/60 text-amber-300' : 'bg-sky-950/60 text-sky-300'}`}>
          {provider.paid ? 'paid · only when selected' : 'free'}
        </span>
        <span className="text-[10px] text-gray-500">{KEY_SOURCE_LABEL[provider.keySource]}</span>
        {provider.models.length > 0 && (
          <span className="text-[10px] text-gray-500">· {provider.models.length} models{freeCount ? ` (${freeCount} free)` : ''}</span>
        )}
        <span className="ms-auto text-xs text-gray-600">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {provider.keyEnv && canEditKeys && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}
                  placeholder={provider.keySource === 'missing' ? `Paste ${provider.keyEnv}` : 'Paste a new key to replace it'}
                  className={`min-w-[200px] flex-1 font-mono ${input}`} />
                <button type="button" disabled={!key.trim() || saving} onClick={() => saveKey(key)}
                  className={`${button} border-sky-800/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/40`}>
                  {saving ? 'Saving…' : 'Save key'}
                </button>
                {provider.keySource === 'settings' && (
                  <button type="button" disabled={saving} onClick={() => saveKey('')}
                    className={`${button} border-white/10 text-gray-400 hover:text-red-300`}>Remove</button>
                )}
              </div>
              {provider.keyUrl && (
                <p className="text-[10px] text-gray-600">
                  Get a {provider.paid ? '' : 'free '}key: <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-sky-500 hover:underline">{provider.keyUrl.replace(/^https:\/\//, '')}</a>
                  {provider.keySource === 'env' && ' · a key saved here overrides the one in .env'}
                </p>
              )}
            </div>
          )}
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {provider.error && <p className="text-[11px] text-amber-400">{provider.error}</p>}
          {provider.models.length > 0 && (
            <ModelList models={provider.models} provider={provider.id} active={active} disabled={!provider.available} onSelect={onSelect} />
          )}
        </div>
      )}
    </div>
  )
}

function CustomModels({ models, active, canEdit, onSelect, onChanged }: {
  models: CustomModelRow[]
  active: Selection
  canEdit: boolean
  onSelect: (s: Selection) => void
  onChanged: (message: string) => Promise<void>
}) {
  const empty = { name: '', baseURL: '', model: '', apiKey: '', free: false }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const call = async (label: string, init: RequestInit, url = '/api/models/custom') => {
    setBusy(label)
    setError(null)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      const body = await res.json() as { error?: string; ok?: boolean; reply?: string; ms?: number }
      if (!res.ok || body.ok === false) throw new Error(body.error || `Failed (${res.status})`)
      return body
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    if (await call('add', { method: 'POST', body: JSON.stringify(form) })) {
      setForm(empty)
      await onChanged(`Added custom model ${form.name}`)
    }
  }

  return (
    <div className="rounded-lg border border-violet-800/40 bg-violet-950/10 p-3 space-y-3">
      <div>
        <p className="text-sm font-bold text-violet-200">Custom models</p>
        <p className="text-[11px] text-gray-500">Any OpenAI-compatible endpoint — LM Studio, vLLM, LocalAI, a company gateway, or another provider.</p>
      </div>
      {models.map(m => {
        const isActive = active.provider === 'custom' && active.model === m.id
        return (
          <div key={m.id} className="flex flex-wrap items-center gap-2 rounded border border-white/[0.06] px-3 py-2 text-xs">
            <span className="font-semibold text-gray-200">{m.name}</span>
            <code className="text-[10px] text-gray-500">{m.model} @ {m.baseURL}</code>
            {m.free && <span className="rounded bg-sky-950/60 px-1.5 text-[10px] text-sky-300">free</span>}
            <div className="ms-auto flex gap-2">
              {canEdit && (
                <button type="button" disabled={!!busy} className={`${button} border-white/10 text-gray-300`}
                  onClick={async () => {
                    const r = await call(`test-${m.id}`, { method: 'POST', body: JSON.stringify({ action: 'test', id: m.id }) })
                    if (r) await onChanged(`✓ ${m.name} answered "${r.reply}" in ${r.ms} ms`)
                  }}>{busy === `test-${m.id}` ? 'Testing…' : 'Test'}</button>
              )}
              <button type="button" disabled={isActive} onClick={() => onSelect({ provider: 'custom', model: m.id })}
                className={`${button} ${isActive ? 'border-emerald-800 text-emerald-300' : 'border-violet-800/60 text-violet-300 hover:bg-violet-900/30'}`}>
                {isActive ? '✓ active' : 'Use'}
              </button>
              {canEdit && (
                <button type="button" disabled={!!busy} className={`${button} border-white/10 text-gray-500 hover:text-red-300`}
                  onClick={async () => {
                    if (await call(`del-${m.id}`, { method: 'DELETE' }, `/api/models/custom?id=${encodeURIComponent(m.id)}`)) await onChanged(`Removed ${m.name}`)
                  }}>Remove</button>
              )}
            </div>
          </div>
        )
      })}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="Name (e.g. LM Studio Qwen)" aria-label="Custom model name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={input} placeholder="Base URL (e.g. http://localhost:1234/v1)" aria-label="Custom model base URL" value={form.baseURL} onChange={e => setForm({ ...form, baseURL: e.target.value })} />
          <input className={input} placeholder="Model id (e.g. qwen2.5-7b-instruct)" aria-label="Custom model ID" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
          <input className={`${input} font-mono`} type="password" autoComplete="off" placeholder="API key (optional)" aria-label="Custom model API key" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} />
          <label className="flex items-center gap-2 text-[11px] text-gray-400">
            <input type="checkbox" checked={form.free} onChange={e => setForm({ ...form, free: e.target.checked })} /> free to use
          </label>
          <button type="button" disabled={!form.name || !form.baseURL || !form.model || !!busy} onClick={add}
            className={`${button} border-violet-800/60 bg-violet-950/40 text-violet-300 hover:bg-violet-900/40`}>
            {busy === 'add' ? 'Adding…' : '+ Add custom model'}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

/** Settings → AI Models: automatic free models, every provider, Ollama, custom models, OmniRoute */
export default function AIProvidersPanel() {
  const router = useRouter()
  const [data, setData] = useState<ModelsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const notify = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 5000)
  }

  const load = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`)
      if (res.status === 401) { router.push('/login'); return }
      setData(await res.json() as ModelsResponse)
    } catch { /* keep previous data */ }
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  const select = useCallback(async ({ provider, model }: Selection) => {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, modelId: model }),
    })
    if (res.ok) {
      setData(prev => prev ? { ...prev, active: { provider, model }, isDefault: false } : prev)
      notify(`✓ Chat and JARVIS now use ${model}`)
    } else {
      notify('Could not save the model choice')
    }
  }, [])

  const useAutomatic = async () => {
    await fetch('/api/models', { method: 'DELETE' })
    notify('✓ Back to automatic free models')
    await load()
  }

  if (loading) {
    return <div className="flex h-24 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-sky-400" /></div>
  }
  if (!data) return <p className="text-xs text-red-400">Couldn&apos;t load AI providers.</p>

  const activeName = data.providers.find(p => p.id === data.active.provider)?.name
    ?? (data.active.provider === 'custom' ? 'custom model' : data.active.provider)
  const reload = async (message: string) => { notify(message); await load(true) }
  const omni = data.providers.find(p => p.id === 'omniroute')

  return (
    <div className="space-y-3">
      {toast && (
        <div className="fixed end-4 top-4 z-50 max-w-sm rounded-lg border border-emerald-700/50 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-300 shadow-lg backdrop-blur">{toast}</div>
      )}

      <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Chat &amp; JARVIS model</p>
          <div className="ms-auto flex gap-2">
            {!data.isDefault && (
              <button type="button" onClick={useAutomatic} className={`${button} border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/30`}>Use automatic free models</button>
            )}
            <button type="button" onClick={() => load(true)} className={`${button} border-white/10 text-gray-400 hover:text-white`}>↻ Refresh</button>
          </div>
        </div>
        {data.isDefault ? (
          <>
            <p className="text-sm font-bold text-emerald-300">Automatic — free models</p>
            <p className="text-[11px] text-gray-500">Tries your free-tier keys first, then OmniRoute (if running), then Pollinations (free, no key needed), then local Ollama models. Pick any model below to pin it.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-emerald-300">{data.active.model}</p>
            <p className="text-[11px] text-gray-500">via {activeName} · if it fails, JARVIS falls back to the automatic free models. Paid providers are only used when selected.</p>
          </>
        )}
      </div>

      {data.providers.filter(p => p.id !== 'omniroute').map(p => (
        <ProviderCard key={p.id} provider={p} active={data.active} canEditKeys={data.canEditKeys} onSelect={select} onKeySaved={reload} />
      ))}

      <div className="rounded-lg border border-white/[0.06] bg-[#080d18] p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${data.ollama.running ? 'bg-emerald-400' : 'bg-gray-700'}`} />
          <span className="text-sm font-bold text-gray-200">Ollama (local)</span>
          <span className="rounded bg-sky-950/60 px-1.5 py-0.5 text-[10px] text-sky-300">free · private</span>
          <span className="text-[10px] text-gray-500">{data.ollama.running ? `${data.ollama.models.length} installed` : 'not running'}</span>
          <a href="/models" className="ms-auto text-[11px] text-sky-500 hover:underline">Install models →</a>
        </div>
        {data.ollama.models.length > 0 ? (
          <ModelList models={data.ollama.models.map(id => ({ id, label: id, free: true }))} provider="ollama" active={data.active} disabled={false} onSelect={select} />
        ) : (
          <p className="text-[11px] text-gray-600">{data.ollama.running ? 'No models yet — e.g. run: ollama pull qwen3.5:4b' : 'Install Ollama from ollama.com to run models on this computer.'}</p>
        )}
      </div>

      <CustomModels models={data.custom} active={data.active} canEdit={data.canEditKeys} onSelect={select} onChanged={reload} />

      <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${data.omniroute.up ? 'bg-emerald-400' : 'bg-gray-700'}`} />
          <span className="text-sm font-bold text-amber-200">OmniRoute</span>
          <span className="text-[10px] text-gray-500">optional gateway · {data.omniroute.up ? `running at ${data.omniroute.url}` : 'not running (start with: omniroute serve)'}</span>
          {data.omniroute.up && (
            <a href={data.omniroute.dashboard} target="_blank" rel="noreferrer" className="ms-auto text-[11px] text-amber-300 hover:underline">Dashboard ↗</a>
          )}
        </div>
        {data.omniroute.up && omni && omni.models.length > 0 && (
          <ModelList models={omni.models} provider="omniroute" active={data.active} disabled={false} onSelect={select} />
        )}
        {omni?.error && data.omniroute.up && <p className="text-[11px] text-amber-400">{omni.error}</p>}
      </div>

      {!data.canEditKeys && <p className="text-[11px] text-gray-600">Only admins can add keys or custom models.</p>}
    </div>
  )
}
