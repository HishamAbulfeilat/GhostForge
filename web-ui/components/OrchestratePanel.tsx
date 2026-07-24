'use client'

import { useMemo, useState } from 'react'

interface EditableSubtask {
  id: string
  label: string
  prompt: string
}

interface OrchestrationResult {
  id: string
  label: string
  response: string
  duration: number
  error?: string
}

interface OrchestrationResponse {
  task: string
  subtasks: OrchestrationResult[]
  merged: string
  totalDuration: number
}

interface Props {
  onSendToJarvis?: (message: string) => void
}

const createSubtask = (): EditableSubtask => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  label: '',
  prompt: '',
})

export default function OrchestratePanel({ onSendToJarvis }: Props) {
  const [open, setOpen] = useState(false)
  const [task, setTask] = useState('')
  const [subtasks, setSubtasks] = useState<EditableSubtask[]>([])
  const [result, setResult] = useState<OrchestrationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const activeIds = useMemo(() => new Set((result?.subtasks || []).map(item => item.id)), [result])

  const updateSubtask = (id: string, patch: Partial<EditableSubtask>) => {
    setSubtasks(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)))
  }

  const addSubtask = () => setSubtasks(current => [...current, createSubtask()])
  const removeSubtask = (id: string) => setSubtasks(current => current.filter(item => item.id !== id))

  const orchestrate = async () => {
    if (!task.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const payloadSubtasks = subtasks
        .filter(item => item.label.trim() && item.prompt.trim())
        .map(item => ({ id: item.id, label: item.label.trim(), prompt: item.prompt.trim() }))

      const response = await fetch('/api/jarvis/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task.trim(), subtasks: payloadSubtasks.length ? payloadSubtasks : undefined }),
      })
      const data = (await response.json()) as OrchestrationResponse
      setResult(data)
      setExpanded(Object.fromEntries((data.subtasks || []).map(item => [item.id, true])))
    } finally {
      setLoading(false)
    }
  }

  const sendToJarvis = async () => {
    if (!result?.merged) return
    if (onSendToJarvis) {
      onSendToJarvis(result.merged)
      return
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('jarvis:send', { detail: { message: result.merged } }))
      await navigator.clipboard.writeText(result.merged).catch(() => undefined)
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 text-zinc-100 shadow-2xl shadow-black/20">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-3xl px-5 py-4 text-left transition hover:bg-zinc-900/70"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-400/70">Parallel reasoning</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-50">⚡ Multi-Agent</h2>
        </div>
        <span className="text-sm text-zinc-500">{open ? 'Collapse' : 'Open'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-zinc-800 px-5 py-5">
          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Main task</span>
            <textarea
              value={task}
              onChange={event => setTask(event.target.value)}
              rows={4}
              className="w-full rounded-[1.5rem] border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
              placeholder="Audit the auth flow, identify weak spots, and propose the fastest stabilisation plan."
            />
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Optional subtasks</p>
                <p className="mt-1 text-sm text-zinc-500">Leave blank to auto-decompose into analysis, implementation, and risks.</p>
              </div>
              <button
                type="button"
                onClick={addSubtask}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-cyan-500/40 hover:text-cyan-300"
              >
                Add subtask
              </button>
            </div>

            {subtasks.map((subtask, index) => (
              <div key={subtask.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Subtask {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeSubtask(subtask.id)}
                    className="text-xs text-zinc-500 transition hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[0.8fr,1.2fr]">
                  <input
                    value={subtask.label}
                    onChange={event => updateSubtask(subtask.id, { label: event.target.value })}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
                    placeholder="Security review"
                  />
                  <input
                    value={subtask.prompt}
                    onChange={event => updateSubtask(subtask.id, { prompt: event.target.value })}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
                    placeholder="Inspect auth token storage, middleware checks, and route guards."
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void orchestrate()}
              disabled={loading}
              className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-300 transition hover:border-cyan-400/50 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Orchestrating…' : 'Orchestrate'}
            </button>
            {loading && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {(subtasks.length ? subtasks : [{ id: 'analysis' }, { id: 'implementation' }, { id: 'risks' }]).map(item => (
                  <span key={item.id} className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-400">
                    ⏳ {item.id}
                  </span>
                ))}
              </div>
            )}
          </div>

          {(loading || result) && (
            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Subtask results</p>
                  {result && <p className="mt-1 text-sm text-zinc-500">Completed in {(result.totalDuration / 1000).toFixed(1)}s</p>}
                </div>
              </div>

              {loading && (subtasks.length ? subtasks : [{ id: 'analysis', label: 'Analysis' }, { id: 'implementation', label: 'Implementation Plan' }, { id: 'risks', label: 'Risks & Considerations' }]).map(item => (
                <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{item.label || item.id}</p>
                      <p className="mt-1 text-xs text-zinc-500">⏳ running…</p>
                    </div>
                    <span className="text-lg text-cyan-300">⏳</span>
                  </div>
                </div>
              ))}

              {(result?.subtasks || []).map(item => {
                const isExpanded = expanded[item.id] ?? false
                return (
                  <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/80">
                    <button
                      type="button"
                      onClick={() => setExpanded(current => ({ ...current, [item.id]: !isExpanded }))}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{item.label}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.error ? '⚠ failed' : activeIds.has(item.id) ? '✓ done' : '⏳ pending'} · {(item.duration / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <span className="text-xs text-zinc-500">{isExpanded ? 'Hide' : 'Show'}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-zinc-800 px-4 py-3 text-sm leading-6 text-zinc-300">
                        <pre className="whitespace-pre-wrap font-sans">{item.error ? `Error: ${item.error}` : item.response}</pre>
                      </div>
                    )}
                  </div>
                )
              })}

              {result?.merged && (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Merged summary</p>
                      <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-zinc-200">{result.merged}</pre>
                    </div>
                    <button
                      type="button"
                      onClick={() => void sendToJarvis()}
                      className="shrink-0 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 transition hover:border-cyan-400/50 hover:bg-cyan-500/20"
                    >
                      Send to JARVIS
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
