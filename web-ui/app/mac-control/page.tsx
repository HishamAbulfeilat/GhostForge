'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

interface HistoryEntry {
  id: string
  command: string
  script: string
  output: string
  error: string | null
  ts: number
}

const QUICK_ACTIONS = [
  { label: '📱 iMessage', icon: '💬', placeholder: 'Send iMessage to Rawzi saying lunch at 1pm', template: 'Send iMessage to [name] saying [message]' },
  { label: '👥 Teams', icon: '🔵', placeholder: 'Open Teams and message Rawzi', template: 'Open Teams and message [name]: [message]' },
  { label: '📸 Screenshot', icon: '📸', template: 'Take a screenshot and save to Desktop' },
  { label: '🔊 Volume', icon: '🔊', template: 'Set system volume to 50%' },
  { label: '🔇 Mute', icon: '🔇', template: 'Mute the system audio' },
  { label: '🔒 Lock', icon: '🔒', template: 'Lock the screen' },
  { label: '🔋 Battery', icon: '🔋', template: 'Show battery percentage as a notification' },
  { label: '🌐 Open URL', icon: '🌐', template: 'Open https://github.com in Safari' },
  { label: '📧 Email', icon: '📧', template: 'Send email to rawzi@example.com with subject "Hello" and body "How are you?"' },
  { label: '📂 Finder', icon: '📂', template: 'Open Finder at my Downloads folder' },
  { label: '🎵 Music', icon: '🎵', template: 'Play music in Spotify' },
  { label: '🔔 Notify', icon: '🔔', template: 'Show a notification saying "GhostForge is ready"' },
]

export default function MacControlPage() {
  const [command, setCommand] = useState('')
  const [script, setScript] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'natural' | 'script'>('natural')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scriptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const run = async (overrideCommand?: string, directScript?: string) => {
    const cmd = overrideCommand ?? command.trim()
    const scr = directScript ?? (tab === 'script' ? script.trim() : undefined)
    if (!cmd && !scr) return
    setLoading(true)
    setOutput('')
    setError(null)

    try {
      const res = await fetch('/api/mac-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scr ? { script: scr } : { command: cmd }),
      })
      const data = await res.json() as { script?: string; output?: string; error?: string | null }
      const generatedScript = data.script ?? scr ?? ''
      const out = data.output ?? ''
      const err = data.error ?? null
      setScript(generatedScript)
      setOutput(out)
      setError(err)
      setHistory(prev => [
        { id: Date.now().toString(), command: cmd || '(direct script)', script: generatedScript, output: out, error: err, ts: Date.now() },
        ...prev.slice(0, 19),
      ])
      if (generatedScript && tab === 'natural') setTab('script')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void run()
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur px-4 py-3 flex items-center gap-3">
        <Link href="/dashboard" className="text-gray-500 hover:text-white transition text-sm">← Dashboard</Link>
        <span className="text-gray-700">|</span>
        <span className="text-2xl">🍎</span>
        <div>
          <h1 className="text-sm font-bold text-white">Mac Control</h1>
          <p className="text-[10px] text-gray-500">Natural language → AppleScript → runs on your Mac</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Main panel */}
        <div className="flex flex-col gap-4">
          {/* Quick actions */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Quick Actions</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.label}
                  type="button"
                  onClick={() => { setCommand(qa.template); setTab('natural'); inputRef.current?.focus() }}
                  className="rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 py-1.5 text-xs text-gray-300 hover:border-violet-600 hover:bg-violet-950/40 hover:text-violet-300 transition active:scale-95"
                >
                  {qa.icon} {qa.label.split(' ').slice(1).join(' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Input tabs */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <div className="flex border-b border-gray-800">
              <button
                type="button"
                onClick={() => setTab('natural')}
                className={`px-4 py-2.5 text-xs font-semibold transition ${tab === 'natural' ? 'bg-gray-800 text-white border-b-2 border-violet-500' : 'text-gray-500 hover:text-gray-300'}`}
              >
                💬 Natural Language
              </button>
              <button
                type="button"
                onClick={() => setTab('script')}
                className={`px-4 py-2.5 text-xs font-semibold transition ${tab === 'script' ? 'bg-gray-800 text-white border-b-2 border-violet-500' : 'text-gray-500 hover:text-gray-300'}`}
              >
                📜 AppleScript Editor
              </button>
            </div>

            <div className="p-3">
              {tab === 'natural' ? (
                <>
                  <textarea
                    ref={inputRef}
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    onKeyDown={handleKey}
                    rows={3}
                    placeholder={'Open Teams and send a message to Rawzi saying "I\'ll be late"\nTip: Press ⌘Enter to run'}
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-violet-600 transition"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-gray-600">⌘ Enter to run • AI will generate and execute AppleScript</span>
                    <button
                      type="button"
                      onClick={() => void run()}
                      disabled={loading || !command.trim()}
                      className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-1.5 text-xs font-semibold text-white transition active:scale-95"
                    >
                      {loading ? '⏳ Running…' : '▶ Run'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    ref={scriptRef}
                    value={script}
                    onChange={e => setScript(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(undefined, script) } }}
                    rows={10}
                    placeholder={'tell application "Messages"\n  -- paste or edit AppleScript here\nend tell'}
                    spellCheck={false}
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 font-mono text-xs text-emerald-300 placeholder-gray-700 resize-none focus:outline-none focus:border-violet-600 transition"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-gray-600">⌘ Enter to run directly (skips AI generation)</span>
                    <button
                      type="button"
                      onClick={() => void run(undefined, script)}
                      disabled={loading || !script.trim()}
                      className="rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 px-4 py-1.5 text-xs font-semibold text-white transition active:scale-95"
                    >
                      {loading ? '⏳ Running…' : '▶ Run Script'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Output panel */}
          {(output || error || loading) && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
                {loading ? (
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                ) : error ? (
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                )}
                <span className="text-xs font-semibold text-gray-400">
                  {loading ? 'Running…' : error ? 'Error' : 'Result'}
                </span>
              </div>
              <div className="p-3 space-y-2">
                {output && (
                  <pre className="rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-xs text-emerald-300 font-mono whitespace-pre-wrap overflow-auto max-h-40">
                    {output}
                  </pre>
                )}
                {error && (
                  <pre className="rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2 text-xs text-red-300 font-mono whitespace-pre-wrap overflow-auto max-h-40">
                    {error}
                  </pre>
                )}
                {!output && !error && !loading && (
                  <p className="text-xs text-emerald-400">✓ Script ran successfully (no output)</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — history */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-3">Tips</p>
            <div className="space-y-2 text-[11px] text-gray-400 leading-relaxed">
              <p>🍎 Uses <span className="text-white">AppleScript</span> — native macOS automation, no extra installs needed</p>
              <p>💬 <span className="text-white">iMessage</span> works reliably. Teams uses UI scripting — Teams must be open</p>
              <p>🔐 Scripts run <span className="text-white">locally</span> via GhostForge bridge — nothing leaves your Mac</p>
              <p>📜 Switch to <span className="text-white">Script Editor</span> tab to view, edit, or run raw AppleScript</p>
              <p>⚡ Grant <span className="text-white">Accessibility access</span> to Terminal in System Settings → Privacy if UI scripting fails</p>
            </div>
          </div>

          {history.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">History</p>
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="text-[10px] text-gray-600 hover:text-red-400 transition"
                >Clear</button>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-gray-800/60">
                {history.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => { setCommand(entry.command); setScript(entry.script); setOutput(entry.output); setError(entry.error); setTab('script') }}
                    className="w-full px-3 py-2 text-left hover:bg-gray-800/50 transition group"
                  >
                    <p className="text-[11px] text-gray-300 truncate group-hover:text-white">{entry.command}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${entry.error ? 'bg-red-500' : 'bg-emerald-500'}`} />
                      <span className="text-[10px] text-gray-600">
                        {new Date(entry.ts).toLocaleTimeString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
