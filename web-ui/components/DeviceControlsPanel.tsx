'use client'

import { useState } from 'react'

type Target = 'youtube' | 'game-updater'

interface Result {
  ok: boolean
  text: string
}

export default function DeviceControlsPanel() {
  const [target, setTarget] = useState<Target>('youtube')
  const [action, setAction] = useState('play')
  const [value, setValue] = useState('')
  const [region, setRegion] = useState('US')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const isYoutube = target === 'youtube'
  const needsUrl = isYoutube && (action === 'summarize' || action === 'get_info')
  const needsRegion = isYoutube && action === 'trending'
  const placeholder = isYoutube
    ? needsUrl ? 'https://www.youtube.com/watch?v=…' : 'Search YouTube…'
    : 'Game name (blank updates all games)'

  async function run() {
    const trimmed = value.trim()
    if (loading || (action === 'play' && isYoutube && !trimmed) || (needsUrl && !/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed))) {
      setResult({ ok: false, text: needsUrl ? 'Enter a valid YouTube URL.' : 'Enter a search query.' })
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const response = await fetch('/api/device-controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          action,
          ...(isYoutube
            ? needsUrl ? { url: trimmed } : { query: trimmed }
            : trimmed ? { game_name: trimmed } : {}),
          ...(needsRegion ? { region } : {}),
        }),
      })
      const data = await response.json() as { result?: string; error?: string }
      setResult({ ok: response.ok, text: response.ok ? data.result || 'Done.' : data.error || `Request failed (${response.status}).` })
    } catch {
      setResult({ ok: false, text: 'Network error reaching the bridge.' })
    } finally {
      setLoading(false)
    }
  }

  function changeTarget(next: Target) {
    setTarget(next)
    setAction(next === 'youtube' ? 'play' : 'list')
    setValue('')
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-[#080d18] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">🎮 Direct device controls</h2>
          <p className="mt-1 text-[10px] text-gray-500">Run YouTube and game updater actions through the local bridge.</p>
        </div>
        <span className="rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1 text-[10px] text-emerald-300">BRIDGE CONTROL</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
        <select value={target} onChange={e => changeTarget(e.target.value as Target)} aria-label="Control target" className="rounded border border-white/10 bg-gray-950 px-2 py-2 text-xs text-gray-200">
          <option value="youtube">YouTube</option>
          <option value="game-updater">Game updater</option>
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} aria-label="Control action" className="rounded border border-white/10 bg-gray-950 px-2 py-2 text-xs text-gray-200">
          {isYoutube ? (
            <>
              <option value="play">Search &amp; play</option>
              <option value="summarize">Summarize video</option>
              <option value="get_info">Video info</option>
              <option value="trending">Trending</option>
            </>
          ) : (
            <>
              <option value="list">List installed games</option>
              <option value="update">Update games</option>
              <option value="download_status">Download status</option>
              <option value="schedule_status">Schedule status</option>
            </>
          )}
        </select>
        <input value={value} onChange={e => setValue(e.target.value)} disabled={action === 'list' || action === 'download_status' || action === 'schedule_status'} placeholder={placeholder} aria-label={isYoutube ? 'YouTube query or URL' : 'Game name'} className="min-w-0 rounded border border-white/10 bg-gray-950 px-2 py-2 text-xs text-gray-200 placeholder-gray-600 disabled:opacity-50" />
        {needsRegion && <input value={region} onChange={e => setRegion(e.target.value.toUpperCase())} maxLength={3} aria-label="Trending region" className="w-16 rounded border border-white/10 bg-gray-950 px-2 py-2 text-xs uppercase text-gray-200" />}
        <button type="button" onClick={() => void run()} disabled={loading} className="rounded border border-sky-700/60 bg-sky-950/40 px-4 py-2 text-xs font-medium text-sky-200 transition hover:bg-sky-900/50 disabled:opacity-50">{loading ? 'Running…' : 'Run'}</button>
      </div>
      {result && <pre role="status" className={`mt-3 whitespace-pre-wrap break-words rounded border px-3 py-2 text-xs ${result.ok ? 'border-emerald-800/50 bg-emerald-950/20 text-emerald-200' : 'border-red-800/50 bg-red-950/20 text-red-300'}`}>{result.text}</pre>}
    </section>
  )
}
