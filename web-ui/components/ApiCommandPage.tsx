'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

interface ApiCommandPageProps {
  title: string
  eyebrow: string
  description: string
  defaultCommand: string
  placeholder: string
  examples: string[]
  accent: string
}

export function ApiCommandPage({
  title,
  eyebrow,
  description,
  defaultCommand,
  placeholder,
  examples,
  accent,
}: ApiCommandPageProps) {
  const [command, setCommand] = useState(defaultCommand)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async (nextCommand: string) => {
    const trimmed = nextCommand.trim()
    if (!trimmed) {
      setError('Command is required.')
      return
    }

    setLoading(true)
    setError('')
    setResult('')

    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      })
      const data = await response.json() as { output?: string; error?: string; message?: string }

      if (!response.ok || data.error) {
        setError(data.error || data.message || 'Execution failed.')
        return
      }

      setResult(data.output || 'Command completed successfully.')
    } catch {
      setError('The bridge is unavailable. Start the GhostForge bridge and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await run(command)
  }

  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{title}</h1>
          </div>
          <Link href="/dashboard" className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:border-white/20 hover:text-white">
            ← Dashboard
          </Link>
        </header>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220] shadow-2xl shadow-black/20">
          <div className="border-b border-white/10 px-5 py-4" style={{ background: `linear-gradient(90deg, ${accent}22, transparent)` }}>
            <p className="text-sm text-white/80">{description}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
            <label className="block text-sm font-medium text-white/80">
              Command
              <input
                value={command}
                onChange={event => setCommand(event.target.value)}
                placeholder={placeholder}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none transition focus:border-white/20 focus:ring-2 focus:ring-white/10"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {examples.map(example => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setCommand(example)
                    void run(example)
                  }}
                  className="max-w-full break-words rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-start text-xs text-white/70 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  {example}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {loading ? 'Running…' : 'Run command'}
            </button>
          </form>
        </section>

        {(error || result) && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-[#09131d] p-4">
            {error ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
            ) : (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-300/80">Output</p>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-300">Success</span>
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-200">{result}</pre>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
