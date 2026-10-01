'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  buildMediaRequest, GAME_ACTIONS, YOUTUBE_ACTIONS,
  type MediaTarget,
} from './requests'

type AuthStatus = 'checking' | 'ready' | 'failed'
type Result = { ok: boolean; text: string }
type Me = { role?: string; permissions?: string[] }

function ToolCard({ target, title, description, actions, enabled }: {
  target: MediaTarget
  title: string
  description: string
  actions: ReadonlyArray<{ id: string; label: string; input: string; confirm?: string }>
  enabled: boolean
}) {
  const [action, setAction] = useState<string>(actions[0].id)
  const [value, setValue] = useState('')
  const [region, setRegion] = useState('US')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const current = actions.find(a => a.id === action) ?? actions[0]
  const showValue = current.input !== 'none' && current.input !== 'region'
  const placeholder = current.input === 'url' ? 'https://www.youtube.com/watch?v=…'
    : current.input === 'game' ? 'Game name (blank updates all games)' : 'Search YouTube…'

  async function run() {
    if (loading) return
    const built = buildMediaRequest(target, action, value, region)
    if ('error' in built) {
      setResult({ ok: false, text: built.error })
      return
    }
    if (current.confirm && !window.confirm(current.confirm)) return
    setLoading(true)
    setResult(null)
    try {
      const response = await fetch('/api/device-controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.request),
      })
      const data = await response.json().catch(() => ({})) as { result?: string; error?: string }
      if (response.ok) setResult({ ok: true, text: data.result || 'Done.' })
      else if (response.status === 401) setResult({ ok: false, text: 'Your session has expired. Sign in again and retry.' })
      else if (response.status === 403) setResult({ ok: false, text: data.error || 'Your account does not have access to this tool.' })
      else if (response.status === 502) setResult({ ok: false, text: `${data.error || 'Bridge request failed.'} Check that the GhostForge bridge is running (port 8765), then retry.` })
      else setResult({ ok: false, text: data.error || `Request failed (${response.status}).` })
    } catch {
      setResult({ ok: false, text: 'Could not reach the GhostForge server. Check your connection and retry.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-labelledby={`${target}-heading`} className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
      <h2 id={`${target}-heading`} className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-white/55">{description}</p>
      {!enabled ? (
        <p role="note" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Your account does not have access to this tool. Ask an admin to grant the permission.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <select value={action} onChange={e => { setAction(e.target.value); setValue(''); setResult(null) }} aria-label={`${title} action`} className="rounded-lg border border-white/10 bg-gray-950 px-3 py-2 text-sm text-gray-200">
            {actions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          {showValue && (
            <input value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} aria-label={`${title} input`} className="min-w-0 rounded-lg border border-white/10 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600" />
          )}
          {current.input === 'region' && (
            <input value={region} onChange={e => setRegion(e.target.value.toUpperCase())} maxLength={3} aria-label="Trending region" className="w-24 rounded-lg border border-white/10 bg-gray-950 px-3 py-2 text-sm uppercase text-gray-200" />
          )}
          <button type="button" onClick={() => void run()} disabled={loading} aria-busy={loading} className="min-h-10 self-start rounded-lg border border-sky-700/60 bg-sky-950/40 px-4 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? 'Running…' : 'Run'}
          </button>
          {result && (
            <pre role={result.ok ? 'status' : 'alert'} aria-live="polite" className={`whitespace-pre-wrap break-words rounded-lg border p-3 text-xs ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>{result.text}</pre>
          )}
        </div>
      )}
    </section>
  )
}

export default function MediaToolsPage() {
  const router = useRouter()
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [authError, setAuthError] = useState('')
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(async response => {
        if (response.status === 401) {
          router.replace('/login?next=/media-tools')
          return
        }
        if (!response.ok) throw new Error(`Unable to verify access (${response.status}).`)
        const data = await response.json() as { user?: Me }
        if (!data.user) throw new Error('Unable to verify your account.')
        if (!cancelled) {
          setMe(data.user)
          setAuthStatus('ready')
        }
      })
      .catch(error => {
        if (cancelled) return
        setAuthError(error instanceof Error ? error.message : 'Unable to verify your account.')
        setAuthStatus('failed')
      })
    return () => { cancelled = true }
  }, [router])

  const can = (permission: string) => me?.role === 'admin' || Boolean(me?.permissions?.includes(permission))

  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">Mark-LV bridge</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Media &amp; game tools</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            Search and summarize YouTube videos and manage game updates through the authenticated local bridge.
          </p>
        </header>

        {authStatus === 'checking' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Verifying access…</p>}
        {authStatus === 'failed' && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{authError}</p>}

        {authStatus === 'ready' && (
          <div className="grid gap-5 lg:grid-cols-2">
            <ToolCard target="youtube" title="YouTube" description="Search & play, summarize, inspect videos, or see what is trending." actions={YOUTUBE_ACTIONS} enabled={can('youtube')} />
            <ToolCard target="game-updater" title="Game updater" description="List Steam and Epic games, start updates and check download progress." actions={GAME_ACTIONS} enabled={can('game_manager')} />
          </div>
        )}
      </div>
    </main>
  )
}
