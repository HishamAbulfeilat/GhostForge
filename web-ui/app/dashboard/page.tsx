'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Issue {
  number: string
  title: string
  labels: string
  state: string
  updated: string
}

interface Run {
  icon: string
  name: string
  branch: string
  conclusion: string
  updated: string
}

interface PR {
  number: string
  title: string
  author: string
  review: string
}

interface Release {
  tag: string
  date: string
  msg: string
}

interface DashboardData {
  bridgeConnected: boolean
  issues: Issue[]
  runs: Run[]
  prs: PR[]
  releases: Release[]
  activity: string[]
  version: string
  timestamp: string
  error?: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PanelShell({
  label,
  accent,
  children,
  className = '',
}: {
  label: string
  accent: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-white/5 bg-[#080d18] ${className}`}
      style={{ borderLeftColor: accent, borderLeftWidth: 2 }}
    >
      <div
        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: accent, background: `${accent}12` }}
      >
        {label}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="px-3 py-3 font-mono text-xs text-gray-600 italic">{message}</p>
  )
}

function IssuesPanel({ issues }: { issues: Issue[] }) {
  return (
    <PanelShell label="📋 My Tickets" accent="#00A3E0">
      {issues.length === 0 ? (
        <EmptyRow message="No open issues assigned to you" />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {issues.map((issue, i) => (
              <tr
                key={i}
                className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-3 py-2 font-mono text-[#00A3E0] w-10 shrink-0">{issue.number}</td>
                <td className="px-1 py-2 text-gray-200 max-w-0 truncate">{issue.title}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-right">{issue.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelShell>
  )
}

function PipelinePanel({ runs }: { runs: Run[] }) {
  const conclusionColor: Record<string, string> = {
    success: 'text-emerald-400',
    failure: 'text-red-400',
    cancelled: 'text-gray-500',
    skipped: 'text-gray-600',
    in_progress: 'text-amber-400',
  }
  return (
    <PanelShell label="🏗 Pipelines" accent="#22C55E">
      {runs.length === 0 ? (
        <EmptyRow message="No recent workflow runs" />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {runs.map((run, i) => (
              <tr
                key={i}
                className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-3 py-2 w-6">{run.icon}</td>
                <td className="px-1 py-2 text-gray-200 max-w-0 truncate">{run.name}</td>
                <td className="px-1 py-2 font-mono text-gray-500 whitespace-nowrap hidden sm:table-cell">
                  {run.branch}
                </td>
                <td
                  className={`px-3 py-2 whitespace-nowrap font-mono text-right ${conclusionColor[run.conclusion] ?? 'text-gray-400'}`}
                >
                  {run.conclusion}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelShell>
  )
}

function PRPanel({ prs }: { prs: PR[] }) {
  const reviewBadge: Record<string, { text: string; cls: string }> = {
    approved: { text: 'approved', cls: 'bg-emerald-900/60 text-emerald-300' },
    changes: { text: 'changes', cls: 'bg-amber-900/60 text-amber-300' },
    pending: { text: 'pending', cls: 'bg-gray-800 text-gray-400' },
  }
  return (
    <PanelShell label="🔀 Pull Requests" accent="#10B981">
      {prs.length === 0 ? (
        <EmptyRow message="No open pull requests" />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {prs.map((pr, i) => {
              const badge = reviewBadge[pr.review] ?? reviewBadge.pending
              return (
                <tr
                  key={i}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-[#10B981] w-10 shrink-0">{pr.number}</td>
                  <td className="px-1 py-2 text-gray-200 max-w-0 truncate">{pr.title}</td>
                  <td className="px-1 py-2 font-mono text-gray-500 whitespace-nowrap hidden md:table-cell">
                    {pr.author}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                      {badge.text}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </PanelShell>
  )
}

function ActivityPanel({ activity }: { activity: string[] }) {
  return (
    <PanelShell label="🔥 Activity" accent="#EF4444">
      {activity.length === 0 ? (
        <EmptyRow message="No recent commits" />
      ) : (
        <ul className="space-y-0">
          {activity.map((line, i) => {
            const [hash, ...rest] = line.split(' ')
            return (
              <li
                key={i}
                className="flex gap-2 border-b border-white/[0.04] px-3 py-1.5 hover:bg-white/[0.03] transition-colors"
              >
                <span className="font-mono text-[10px] text-[#EF4444] shrink-0 w-14 truncate">{hash}</span>
                <span className="font-mono text-[10px] text-gray-400 truncate">{rest.join(' ')}</span>
              </li>
            )
          })}
        </ul>
      )}
    </PanelShell>
  )
}

function ReleasesPanel({ releases }: { releases: Release[] }) {
  return (
    <PanelShell label="🚀 Releases" accent="#8B5CF6">
      {releases.length === 0 ? (
        <EmptyRow message="No tags found" />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {releases.map((rel, i) => (
              <tr
                key={i}
                className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-3 py-2 font-mono text-[#8B5CF6] w-20 shrink-0">{rel.tag}</td>
                <td className="px-1 py-2 font-mono text-gray-500 whitespace-nowrap w-24">{rel.date}</td>
                <td className="px-3 py-2 text-gray-400 truncate">{rel.msg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelShell>
  )
}

function BridgeSetupPanel() {
  const envVars = [
    { key: 'ACCESS_PIN', desc: 'Your login PIN', required: true },
    { key: 'AUTH_SECRET', desc: 'Random 32-char secret', required: true },
    { key: 'OPENROUTER_API_KEY', desc: 'openrouter.ai/keys (free models)', required: false },
    { key: 'GOOGLE_GENERATIVE_AI_API_KEY', desc: 'aistudio.google.com (free)', required: false },
    { key: 'WS_BRIDGE_URL', desc: 'Cloudflare tunnel URL from bridge.sh', required: false },
    { key: 'WS_BRIDGE_TOKEN', desc: 'Bridge auth token from bridge.sh output', required: false },
  ]
  return (
    <div className="rounded-lg border border-white/5 bg-[#080d18] p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">⚙️ Setup &amp; Environment</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs text-gray-500">Start the Mac bridge:</p>
          <code className="block rounded bg-gray-900 px-3 py-2 font-mono text-xs text-emerald-400">
            bash ~/ghostforge/scripts/bridge.sh start
          </code>
        </div>
        <div className="space-y-1">
          {envVars.map(v => (
            <div key={v.key} className="flex items-center gap-2 text-xs">
              <span
                className={`shrink-0 rounded px-1 text-[9px] font-medium ${
                  v.required ? 'bg-red-950 text-red-400' : 'bg-gray-800/80 text-gray-600'
                }`}
              >
                {v.required ? 'req' : 'opt'}
              </span>
              <code className="text-sky-400 shrink-0">{v.key}</code>
              <span className="text-gray-600 truncate">{v.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Clock ─────────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="font-mono text-xs tabular-nums text-gray-400">{time}</span>
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<string>('')
  const isFetching = useRef(false)

  const fetchData = useCallback(async () => {
    if (isFetching.current) return
    isFetching.current = true
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard')
      if (res.status === 401) {
        router.push('/login')
        return
      }
      const json = (await res.json()) as DashboardData
      setData(json)
      setLastRefreshed(new Date().toLocaleTimeString())
    } catch {
      // keep previous data on network error
    } finally {
      setLoading(false)
      isFetching.current = false
    }
  }, [router])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => void fetchData(), 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  const bridgeOk = data?.bridgeConnected ?? false

  return (
    <div
      className="min-h-screen bg-[#030712]"
      style={{ backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% -10%, #00274a33, transparent)' }}
    >
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#030712]/90 px-4 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={() => router.push('/chat')}
          className="rounded p-1 text-gray-500 transition hover:text-white"
          aria-label="Back to chat"
        >
          ‹
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight text-white">👻 GhostForge</span>
          <span className="text-[10px] font-mono text-gray-600 hidden sm:block">DASHBOARD</span>
          {data?.version && data.version !== '—' && (
            <span className="rounded bg-[#00274a] px-1.5 py-0.5 font-mono text-[10px] text-[#00A3E0]">
              v{data.version}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {/* Nav links */}
          <a href="/features" className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-[10px] text-violet-300 hover:bg-violet-900/40 transition">
            🔧 Features
          </a>
          <a href="/terminal" className="rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-900/40 transition">
            💻 Terminal
          </a>
          <a href="/chat" className="rounded border border-sky-800/50 bg-sky-950/30 px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-900/40 transition">
            💬 Chat
          </a>

          {/* Bridge indicator */}
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-[#080d18] px-3 py-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${bridgeOk ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-gray-600'} ${loading ? 'animate-pulse' : ''}`}
            />
            <span className="hidden text-[10px] text-gray-400 sm:block">{bridgeOk ? 'bridge online' : 'bridge offline'}</span>
          </div>

          <LiveClock />

          <button
            type="button"
            onClick={() => void fetchData()}
            disabled={loading}
            className="rounded border border-white/[0.06] bg-[#080d18] px-3 py-1 text-[10px] text-gray-400 transition hover:border-[#00A3E0]/40 hover:text-[#00A3E0] disabled:opacity-40"
          >
            {loading ? '⟳' : '⟳'}
          </button>
        </div>
      </header>

      <main className="p-4 space-y-3 max-w-7xl mx-auto">
        {/* ── Quick nav cards ── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { href: '/chat', icon: '💬', label: 'AI Chat', desc: 'Gemini 2.5 Pro', color: 'border-violet-800/40 hover:border-violet-600/60' },
            { href: '/terminal', icon: '💻', label: 'Terminal', desc: 'Live TUI shell', color: 'border-emerald-800/40 hover:border-emerald-600/60' },
            { href: '/features', icon: '🔧', label: 'Features', desc: 'Run any command', color: 'border-sky-800/40 hover:border-sky-600/60' },
            { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Plugins & agents', color: 'border-rose-800/40 hover:border-rose-600/60' },
            { href: '/settings', icon: '⚙️', label: 'Models', desc: 'Switch AI model', color: 'border-amber-800/40 hover:border-amber-600/60' },
            { href: '/chat', icon: '🐙', label: 'Copilot', desc: 'GitHub Suggest', color: 'border-gray-700/40 hover:border-gray-500/60' },
          ].map(item => (
            <a
              key={item.label}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg border bg-[#080d18] p-3 transition hover:bg-white/[0.03] ${item.color}`}
            >
              <span className="text-xl shrink-0">{item.icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-200">{item.label}</p>
                <p className="truncate text-[11px] text-gray-600">{item.desc}</p>
              </div>
            </a>
          ))}
        </div>

        {/* ── Bridge offline notice ── */}
        {data && !bridgeOk && (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">
            <span className="font-semibold">Bridge not connected.</span>
            {data.error ? ` ${data.error}. ` : ' '}
            Run{' '}
            <code className="rounded bg-amber-900/40 px-1.5 py-0.5">
              bash ~/GhostForge/scripts/bridge.sh start
            </code>{' '}
            on your Mac to enable live data.
          </div>
        )}

        {/* ── Last refresh ── */}
        {lastRefreshed && (
          <p className="text-right font-mono text-[10px] text-gray-700">
            last refresh: {lastRefreshed}
          </p>
        )}

        {/* ── Top row: Tickets · Pipelines · PRs ── */}
        <div className="grid gap-3 lg:grid-cols-3">
          <IssuesPanel issues={data?.issues ?? []} />
          <PipelinePanel runs={data?.runs ?? []} />
          <PRPanel prs={data?.prs ?? []} />
        </div>

        {/* ── Bottom row: Activity · Releases ── */}
        <div className="grid gap-3 lg:grid-cols-2">
          <ActivityPanel activity={data?.activity ?? []} />
          <ReleasesPanel releases={data?.releases ?? []} />
        </div>

        {/* ── Setup / env ── */}
        <BridgeSetupPanel />
      </main>
    </div>
  )
}
