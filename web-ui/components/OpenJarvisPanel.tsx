'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

interface OpenJarvisPanelProps {
  ringColor?: string
}

interface OpenJarvisHealth {
  installed: boolean
  binary: string | null
}

/**
 * Self-contained panel for the OpenJarvis endpoints (web-ui/app/api/openjarvis,
 * which proxies to mark-l-bridge's /api/openjarvis/*). Shows whether the
 * `jarvis` CLI is installed on the bridge host and lets the user ask it a
 * question.
 */
export default function OpenJarvisPanel({ ringColor = '#1a6fff' }: OpenJarvisPanelProps) {
  const [health, setHealth] = useState<OpenJarvisHealth | null>(null)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/openjarvis')
      if (!res.ok) return
      const data = await res.json() as OpenJarvisHealth
      setHealth(data)
    } catch {
      setHealth(null)
    }
  }, [])

  useEffect(() => { void loadHealth() }, [loadHealth])

  const ask = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/openjarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      })
      const data = await res.json() as { response?: string; error?: string }
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`)
      } else {
        setResponse(data.response ?? '')
      }
    } catch {
      setError('Network error reaching the bridge.')
    } finally {
      setLoading(false)
    }
  }, [prompt, loading])

  return (
    <div className="flex flex-col gap-3 font-mono text-[10px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={11} style={{ color: ringColor, opacity: 0.8 }} />
          <span className="text-[11px] tracking-widest" style={{ color: ringColor }}>OPENJARVIS</span>
        </div>
        <span
          className="rounded px-1.5 py-0.5 text-[9px]"
          style={{
            background: health?.installed ? '#00ff8818' : `${ringColor}18`,
            color: health?.installed ? '#00ff88' : `${ringColor}99`,
          }}
        >
          {health === null ? 'CHECKING…' : health.installed ? 'INSTALLED' : 'NOT INSTALLED'}
        </span>
      </div>

      {health && !health.installed && (
        <p className="text-[9px] leading-snug" style={{ color: `${ringColor}66` }}>
          Install the `jarvis` CLI from Marketplace → &quot;OpenJarvis&quot; to enable this panel.
        </p>
      )}

      <div className="flex gap-1.5">
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void ask() }}
          placeholder="Ask OpenJarvis…"
          aria-label="Ask OpenJarvis"
          disabled={!health?.installed || loading}
          className="flex-1 rounded border bg-transparent px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none disabled:opacity-40"
          style={{ borderColor: `${ringColor}33` }}
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={!health?.installed || loading || !prompt.trim()}
          className="rounded border px-2 py-1 text-[9px] transition disabled:opacity-30"
          style={{ borderColor: `${ringColor}33`, color: `${ringColor}cc`, background: `${ringColor}08` }}
        >
          {loading ? '…' : 'ASK'}
        </button>
      </div>

      {error && <p className="text-[9px] text-red-400/80">{error}</p>}

      {response && (
        <div
          className="rounded border p-2 text-[10px] leading-relaxed text-gray-300 whitespace-pre-wrap"
          style={{ borderColor: `${ringColor}22`, background: `${ringColor}08` }}
        >
          {response}
        </div>
      )}
    </div>
  )
}
