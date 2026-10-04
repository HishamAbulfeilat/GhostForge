'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Template = { id: string; label: string; description: string }
type Project = { path: string; name: string; exists: boolean; toolkit: boolean }

/** A finished run, with the fields a caller can report on. */
type RunResult = {
  status: 'pass' | 'fail' | 'error' | 'timeout'
  template: string
  projectPath: string
  exitCode: number | null
  durationMs: number
  output: string
  truncated: boolean
}
type ScaffoldResult = RunResult | { status: 'unavailable' } | { status: 'cancelled' }

const STATUS_TEXT: Record<ScaffoldResult['status'], string> = {
  pass: 'Created',
  fail: 'Failed',
  error: 'Run error',
  timeout: 'Timed out',
  unavailable: 'Not available',
  cancelled: 'Cancelled',
}

const STATUS_STYLE: Record<ScaffoldResult['status'], string> = {
  pass: 'bg-emerald-500/15 text-emerald-200',
  fail: 'bg-red-500/15 text-red-200',
  error: 'bg-red-500/15 text-red-200',
  timeout: 'bg-amber-500/15 text-amber-100',
  unavailable: 'bg-white/10 text-white/50',
  cancelled: 'bg-white/10 text-white/50',
}

/** A result carrying the run fields, or null for unavailable/cancelled. */
function asRun(result: ScaffoldResult): RunResult | null {
  return result.status === 'pass' || result.status === 'fail' || result.status === 'error' || result.status === 'timeout'
    ? result
    : null
}

export default function ProjectsPage() {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading')
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [template, setTemplate] = useState('')
  const [name, setName] = useState('')
  const [scaffolding, setScaffolding] = useState(false)
  const [result, setResult] = useState<ScaffoldResult | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/projects')
      if (response.status === 401) {
        router.replace('/login?from=/projects')
        return
      }
      if (response.status === 403) {
        setState('forbidden')
        return
      }
      if (!response.ok) throw new Error(`Unable to load projects (${response.status}).`)
      const data = await response.json() as { projects?: Project[]; templates?: Template[] }
      setProjects(data.projects ?? [])
      setTemplates(data.templates ?? [])
      setTemplate(current => current || (data.templates?.[0]?.id ?? ''))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load projects.')
      setState('failed')
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  const scaffold = async (event: React.FormEvent) => {
    event.preventDefault()
    if (scaffolding || !template) return
    setScaffolding(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, name }),
      })
      const data = await response.json() as ScaffoldResult & { error?: string }
      if (!response.ok) {
        setError(data.error || `Scaffold request failed (${response.status}).`)
      } else {
        setResult(data)
        if (data.status === 'pass') void load()
      }
    } catch {
      setError('Could not reach the scaffolder.')
    } finally {
      setScaffolding(false)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">Admin · allow-listed templates only</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            The projects registered with GhostForge, and a scaffolder for new ones. Scaffolding runs
            <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-xs">scripts/create-project.sh</code>
            on this server with a fixed template and a plain folder name — no paths, flags or shell.
          </p>
        </header>

        {state === 'loading' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Loading projects…</p>}
        {state === 'forbidden' && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Project management is available to administrators only.</p>}
        {state === 'failed' && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

        {state === 'ready' && (
          <>
            <section aria-labelledby="registered-heading" className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
              <h2 id="registered-heading" className="text-lg font-semibold">Registered projects</h2>
              {projects.length === 0 ? (
                <p className="mt-3 text-sm text-white/60">
                  No projects registered yet. Add one from the terminal with{' '}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">ghostforge projects add</code>.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-white/5">
                  {projects.map(project => (
                    <li key={project.path} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{project.name}</p>
                        <p className="truncate text-xs text-white/50">{project.path}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!project.exists && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-200">Missing</span>}
                        {project.exists && !project.toolkit && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-100">No toolkit</span>}
                        {project.toolkit && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">Toolkit installed</span>}
                        {project.exists && (
                          <Link
                            href={`/files?path=${encodeURIComponent(project.path)}`}
                            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-medium transition hover:bg-white/5"
                          >
                            Open
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="scaffold-heading" className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
              <h2 id="scaffold-heading" className="text-lg font-semibold">New project</h2>
              <form onSubmit={scaffold} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="template" className="block text-sm font-medium text-white/80">Template</label>
                    <select
                      id="template"
                      value={template}
                      onChange={event => setTemplate(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-[#030712] px-3 py-2 text-sm"
                    >
                      {templates.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-white/50">
                      {templates.find(option => option.id === template)?.description ?? 'No templates available.'}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-white/80">Folder name</label>
                    <input
                      id="name"
                      value={name}
                      onChange={event => setName(event.target.value)}
                      placeholder="ghostforge-hr-app"
                      pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
                      maxLength={64}
                      required
                      className="mt-1 w-full rounded-lg border border-white/15 bg-[#030712] px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-white/50">Letters, digits, dot, dash and underscore. No paths.</p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={scaffolding || !template}
                  aria-label="Create project"
                  className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {scaffolding ? 'Creating…' : 'Create project'}
                </button>
                <p className="text-xs text-white/40">
                  Creates the project in the GhostForge checkout on this server. Nothing is pushed to a remote and no credentials are used.
                </p>
              </form>
            </section>

            {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

            {result && (
              (() => {
                const run = asRun(result)
                return (
                  <section role="status" aria-live="polite" aria-label="Scaffold result" className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-lg font-semibold">
                        {templates.find(option => option.id === run?.template)?.label ?? 'Scaffold'}
                      </h2>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[result.status]}`}>
                        {STATUS_TEXT[result.status]}
                      </span>
                    </div>
                    {run && (
                      <p className="mt-1 text-sm text-white/60">
                        Exit {run.exitCode ?? 'n/a'} · {(run.durationMs / 1000).toFixed(1)}s · <span className="break-all">{run.projectPath}</span>
                      </p>
                    )}
                    {result.status === 'unavailable' && (
                      <p className="mt-2 text-sm text-white/60">The scaffolder script was not found on this server.</p>
                    )}
                    {run && (
                      <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-black/40 p-3 text-xs whitespace-pre-wrap text-white/80">
                        {run.output}
                      </pre>
                    )}
                  </section>
                )
              })()
            )}
          </>
        )}
      </div>
    </main>
  )
}