'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type MaintenanceAction = {
  id: string
  label: string
  description: string
  command: string
  confirm?: string
}

type MaintenanceSection = {
  title: string
  description: string
  actions: MaintenanceAction[]
}

const SECTIONS: MaintenanceSection[] = [
  {
    title: 'Git hooks',
    description: 'Check, install, or remove this repository’s commit hooks. Installing replaces existing hooks with the same names.',
    actions: [
      { id: 'hooks-status', label: 'Check hook status', description: 'Show the current pre-commit and commit-msg hooks.', command: 'ghostforge git-hooks-setup status' },
      { id: 'hooks-install', label: 'Install hooks', description: 'Install GhostForge checks for future commits.', command: 'ghostforge git-hooks-setup install', confirm: 'Install GhostForge Git hooks in the active repository?' },
      { id: 'hooks-uninstall', label: 'Remove hooks', description: 'Remove the current pre-commit and commit-msg hooks, including hooks installed by other tools.', command: 'ghostforge git-hooks-setup uninstall', confirm: 'Remove the pre-commit and commit-msg hooks from the active repository, including any installed by other tools?' },
    ],
  },
  {
    title: 'Dependency upgrades',
    description: 'Apply conservative upgrades, security fixes, or all latest versions.',
    actions: [
      { id: 'upgrade-safe', label: 'Safe upgrades', description: 'Upgrade dependencies within minor-version bounds.', command: 'ghostforge upgrade --safe', confirm: 'Apply safe dependency upgrades to the active repository?' },
      { id: 'upgrade-security', label: 'Security fixes', description: 'Run npm audit fix for dependency vulnerabilities.', command: 'ghostforge upgrade --security', confirm: 'Apply dependency security fixes to the active repository?' },
      { id: 'upgrade-all', label: 'Upgrade all', description: 'Upgrade all dependencies to their latest versions; breaking changes may occur.', command: 'ghostforge upgrade --all', confirm: 'Upgrade all dependencies to their latest versions? This may introduce breaking changes.' },
    ],
  },
  {
    title: 'Release management',
    description: 'Review release status, prepare versions, create tags, and publish.',
    actions: [
      { id: 'release-status', label: 'Release status', description: 'Show the current version, last tag, and unreleased changes.', command: 'ghostforge release status' },
      { id: 'release-patch', label: 'Prepare patch', description: 'Prepare a patch release and update the project version.', command: 'ghostforge release prepare patch', confirm: 'Prepare a patch release and update the project version?' },
      { id: 'release-minor', label: 'Prepare minor', description: 'Prepare a minor release and update the project version.', command: 'ghostforge release prepare minor', confirm: 'Prepare a minor release and update the project version?' },
      { id: 'release-major', label: 'Prepare major', description: 'Prepare a major release and update the project version.', command: 'ghostforge release prepare major', confirm: 'Prepare a major release and update the project version?' },
      { id: 'release-tag', label: 'Create release tag', description: 'Create an annotated tag for the current version.', command: 'ghostforge release tag', confirm: 'Create an annotated Git tag for the current version?' },
      { id: 'release-notes', label: 'Generate release notes', description: 'Save notes from the latest changelog entry.', command: 'ghostforge release notes' },
      { id: 'release-publish', label: 'Publish tags', description: 'Push Git tags to the configured origin and open the release draft.', command: 'ghostforge release publish', confirm: 'Push release tags to the configured origin? This sends changes to the remote repository.' },
    ],
  },
]

type CommandResponse = { output?: string; error?: string; message?: string }

export default function MaintenancePage() {
  const router = useRouter()
  const [authStatus, setAuthStatus] = useState<'checking' | 'ready' | 'failed'>('checking')
  const [authError, setAuthError] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ command: string; output: string; error: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(async response => {
        if (response.status === 401) {
          router.replace('/login?next=/maintenance')
          return
        }
        if (!response.ok) throw new Error(`Unable to verify access (${response.status}).`)
        const data = await response.json() as { user?: unknown }
        if (!data.user) throw new Error('Unable to verify your account.')
        if (!cancelled) setAuthStatus('ready')
      })
      .catch(error => {
        if (cancelled) return
        setAuthError(error instanceof Error ? error.message : 'Unable to verify your account.')
        setAuthStatus('failed')
      })
    return () => { cancelled = true }
  }, [router])

  const runCommand = async (action: MaintenanceAction) => {
    if (running) return
    if (action.confirm && !window.confirm(action.confirm)) return

    setRunning(action.id)
    setResult(null)
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: action.command }),
      })
      const data = await response.json() as CommandResponse
      const error = !response.ok || Boolean(data.error)
      setResult({
        command: action.command,
        output: data.output || data.error || data.message || (error ? `Command failed (${response.status}).` : 'Command completed.'),
        error,
      })
    } catch {
      setResult({
        command: action.command,
        output: 'Could not reach the execution service. Check that the GhostForge bridge is running, then try again.',
        error: true,
      })
    } finally {
      setRunning(null)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">Developer operations</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Maintenance &amp; releases</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            Run repository maintenance, dependency upgrades, and release tasks through the authenticated GhostForge command runner.
          </p>
        </header>

        {authStatus === 'checking' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Verifying access…</p>}
        {authStatus === 'failed' && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{authError}</p>}

        {authStatus === 'ready' && (
          <>
            {result && (
              <section role={result.error ? 'alert' : 'status'} aria-live="polite" className={`rounded-xl border p-4 ${result.error ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'}`}>
                <p className="font-mono text-xs text-white/60">{result.command}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-6">{result.output}</pre>
              </section>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              {SECTIONS.map(section => (
                <section key={section.title} aria-labelledby={`${section.title.replaceAll(' ', '-')}-heading`} className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
                  <h2 id={`${section.title.replaceAll(' ', '-')}-heading`} className="text-lg font-semibold">{section.title}</h2>
                  <p className="mt-1 text-sm text-white/55">{section.description}</p>
                  <div className="mt-4 flex flex-col gap-2">
                    {section.actions.map(action => (
                      <article key={action.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-medium">{action.label}</h3>
                          <p className="mt-1 text-xs text-white/50">{action.description}</p>
                          <code className="mt-2 block break-all text-[10px] text-white/35">{action.command}</code>
                        </div>
                        <button
                          type="button"
                          aria-label={`Run ${action.label}`}
                          disabled={running !== null}
                          onClick={() => void runCommand(action)}
                          className="min-h-10 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {running === action.id ? 'Running…' : 'Run'}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
