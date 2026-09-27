'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface FeatureCmd {
  label: string
  cmd: string
  desc: string
}

interface FeatureGroup {
  id: string
  label: string
  icon: string
  accent: string
  bg: string
  border: string
  text: string
  cmds: FeatureCmd[]
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'carbon',
    label: 'Carbon Monitor',
    icon: '🌿',
    accent: '#10b981',
    bg: 'bg-emerald-950/30',
    border: 'border-emerald-800/50',
    text: 'text-emerald-300',
    cmds: [
      { label: 'Carbon Status', cmd: 'ghostforge carbon status', desc: 'Current CO₂ footprint of your stack' },
      { label: 'Live Monitor', cmd: 'ghostforge carbon live', desc: 'Real-time carbon tracking' },
      { label: 'Weekly Report', cmd: 'ghostforge carbon weekly', desc: 'Weekly carbon usage summary' },
      { label: 'Carbon Badge', cmd: 'ghostforge carbon badge', desc: 'Generate README badge' },
    ],
  },
  {
    id: 'health',
    label: 'Project Health',
    icon: '🏥',
    accent: '#0ea5e9',
    bg: 'bg-sky-950/30',
    border: 'border-sky-800/50',
    text: 'text-sky-300',
    cmds: [
      { label: 'Health Score', cmd: 'ghostforge health-score score', desc: 'Overall project health rating' },
      { label: 'Dep Health', cmd: 'ghostforge dep-health check', desc: 'Check dependency vulnerabilities' },
      { label: 'Bundle Size', cmd: 'ghostforge bundle track', desc: 'Track JS bundle size over time' },
      { label: 'Coverage', cmd: 'ghostforge coverage check', desc: 'Test coverage report' },
    ],
  },
  {
    id: 'ai',
    label: 'AI Tools',
    icon: '🤖',
    accent: '#8b5cf6',
    bg: 'bg-violet-950/30',
    border: 'border-violet-800/50',
    text: 'text-violet-300',
    cmds: [
      { label: 'AI Code Review', cmd: 'ghostforge ai-review staged', desc: 'AI review of staged changes' },
      { label: 'Daily Standup', cmd: 'ghostforge standup today', desc: 'Generate standup from git log' },
      { label: 'Explain Error', cmd: 'ghostforge explain', desc: 'AI explains last error in clipboard' },
      { label: 'Tech Debt Scan', cmd: 'ghostforge tech-debt scan', desc: 'Scan for tech debt patterns' },
    ],
  },
  {
    id: 'git',
    label: 'Git & Release',
    icon: '⚙️',
    accent: '#f59e0b',
    bg: 'bg-amber-950/30',
    border: 'border-amber-800/50',
    text: 'text-amber-300',
    cmds: [
      { label: 'Smart Commit', cmd: 'ghostforge commit', desc: 'AI-generated commit message' },
      { label: 'Patch Release', cmd: 'ghostforge release patch', desc: 'Bump patch version & tag' },
      { label: 'PR Description', cmd: 'ghostforge pr-description', desc: 'AI-written PR description' },
      { label: 'Install Hooks', cmd: 'ghostforge git-hooks-setup install', desc: 'Install git quality hooks' },
    ],
  },
  {
    id: 'generate',
    label: 'Code Generation',
    icon: '🔧',
    accent: '#f43f5e',
    bg: 'bg-rose-950/30',
    border: 'border-rose-800/50',
    text: 'text-rose-300',
    cmds: [
      { label: 'Component Gen', cmd: 'ghostforge component-gen', desc: 'Generate React component' },
      { label: 'API Docs', cmd: 'ghostforge api-docs generate', desc: 'Auto-generate API documentation' },
      { label: 'Dockerfile', cmd: 'ghostforge docker-gen generate', desc: 'Generate optimized Dockerfile' },
      { label: 'DB Schema', cmd: 'ghostforge schema-viz show', desc: 'Visualize database schema' },
    ],
  },
  {
    id: 'system',
    label: 'System & Audit',
    icon: '🛠️',
    accent: '#6b7280',
    bg: 'bg-gray-900/30',
    border: 'border-gray-700/50',
    text: 'text-gray-300',
    cmds: [
      { label: 'Marketplace', cmd: 'ghostforge marketplace', desc: 'Browse GhostForge marketplace' },
      { label: 'Lighthouse', cmd: 'ghostforge lighthouse run', desc: 'Run Lighthouse performance audit' },
      { label: 'A11y Audit', cmd: 'ghostforge a11y audit', desc: 'Accessibility audit report' },
      { label: 'Marketplace List', cmd: 'ghostforge marketplace list', desc: 'List all available plugins' },
    ],
  },
]

interface OutputEntry {
  cmd: string
  output: string
  ok: boolean
  ts: string
}

function OutputPanel({ entries, onClear }: { entries: OutputEntry[]; onClear: () => void }) {
  if (entries.length === 0) return null
  const last = entries[entries.length - 1]
  return (
    <div className={`rounded-lg border p-3 font-mono text-xs ${last.ok ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-red-800/50 bg-red-950/20'}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={last.ok ? 'text-emerald-400' : 'text-red-400'}>
          {last.ok ? '✓' : '✗'} <span className="text-gray-400">{last.cmd}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-[10px]">{last.ts}</span>
          <button type="button" onClick={onClear} className="text-gray-600 hover:text-gray-400 text-[10px] transition">
            clear
          </button>
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-all text-gray-300 max-h-48 overflow-y-auto leading-relaxed">
        {last.output || '(no output)'}
      </pre>
    </div>
  )
}

export default function FeaturesPage() {
  const [running, setRunning] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<OutputEntry[]>([])
  const [activeGroup, setActiveGroup] = useState<string>('all')

  const runCommand = useCallback(async (cmd: string) => {
    if (!cmd || running) return
    setRunning(cmd)
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      })
      const data = await res.json() as { output?: string; error?: string; message?: string }
      setOutputs(prev => [...prev.slice(-19), {
        cmd,
        output: data.output ?? data.error ?? data.message ?? 'No output',
        ok: res.ok && !data.error,
        ts: new Date().toLocaleTimeString(),
      }])
    } catch {
      setOutputs(prev => [...prev.slice(-19), {
        cmd,
        output: 'Bridge not connected. Start it with: bash ~/GhostForge/scripts/bridge.sh start',
        ok: false,
        ts: new Date().toLocaleTimeString(),
      }])
    } finally {
      setRunning(null)
    }
  }, [running])

  const visibleGroups = activeGroup === 'all'
    ? FEATURE_GROUPS
    : FEATURE_GROUPS.filter(g => g.id === activeGroup)

  return (
    <div className="min-h-[100dvh] bg-[#030712]" style={{ backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -10%, #1a0a2e40, transparent)' }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#030712]/90 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Link href="/dashboard" className="rounded p-1 text-gray-500 transition hover:text-white text-lg leading-none">‹</Link>
          <span className="text-sm font-bold tracking-tight text-white">👻 GhostForge</span>
          <span className="text-[10px] font-mono text-gray-600 hidden sm:block">FEATURES</span>
          <div className="ms-auto flex items-center gap-2">
            <Link href="/terminal" className="rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 transition">
              💻 Terminal
            </Link>
            <Link href="/chat" className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/40 transition">
              💬 Chat
            </Link>
          </div>
        </div>

        {/* Category filter tabs */}
        <div className="flex gap-1 overflow-x-auto px-4 pb-2.5 scrollbar-none">
          <button type="button"
            onClick={() => setActiveGroup('all')}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${activeGroup === 'all' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            All
          </button>
          {FEATURE_GROUPS.map(g => (
            <button type="button"
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${activeGroup === g.id ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {g.icon} {g.label}
            </button>
          ))}
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-5xl mx-auto">
        {/* Output panel */}
        <OutputPanel entries={outputs} onClear={() => setOutputs([])} />

        {/* Feature grids */}
        {visibleGroups.map(group => (
          <div key={group.id}>
            <div className="mb-2 flex items-center gap-2">
              <span style={{ color: group.accent }} className="text-sm font-bold">
                {group.icon} {group.label}
              </span>
              <div className="flex-1 border-t border-white/[0.04]" />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {group.cmds.map(item => {
                const isRunning = running === item.cmd
                return (
                  <button type="button"
                    key={item.cmd}
                    onClick={() => runCommand(item.cmd)}
                    disabled={!!running}
                    className={`
                      relative flex flex-col items-start gap-1.5 rounded-lg border p-3 text-start
                      transition active:scale-[0.98] touch-manipulation
                      disabled:opacity-50 disabled:cursor-not-allowed
                      ${group.bg} ${group.border}
                      hover:border-opacity-80 hover:brightness-110
                    `}
                  >
                    {isRunning && (
                      <div className="absolute right-2 top-2">
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-transparent" style={{ borderTopColor: group.accent }} />
                      </div>
                    )}
                    <span className={`text-xs font-semibold ${group.text}`}>{item.label}</span>
                    <span className="text-[11px] text-gray-500 leading-snug">{item.desc}</span>
                    <code className="mt-0.5 text-[10px] text-gray-600 truncate w-full">{item.cmd}</code>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Quick nav cards */}
        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4 border-t border-white/[0.04] mt-4">
          {[
            { href: '/chat', icon: '💬', label: 'AI Chat', desc: 'Gemini 2.5 Pro' },
            { href: '/terminal', icon: '💻', label: 'Terminal', desc: 'Full TUI shell' },
            { href: '/dashboard', icon: '📊', label: 'Dashboard', desc: 'Project overview' },
            { href: '/chat', icon: '🐙', label: 'Copilot', desc: 'GitHub Suggest' },
          ].map(item => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-[#080d18] p-3 transition hover:border-white/[0.15] hover:bg-white/[0.04]"
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs font-semibold text-gray-200">{item.label}</span>
              <span className="text-[11px] text-gray-600">{item.desc}</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
