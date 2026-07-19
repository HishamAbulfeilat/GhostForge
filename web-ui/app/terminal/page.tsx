'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'

const XTermWrapper = dynamic(() => import('@/components/XTermWrapper'), { ssr: false })

const FEATURE_GROUPS = [
  {
    label: '🌿 Carbon',
    color: 'emerald',
    cmds: [
      { label: 'Status', cmd: 'ghostforge carbon status' },
      { label: 'Live', cmd: 'ghostforge carbon live' },
      { label: 'Weekly', cmd: 'ghostforge carbon weekly' },
      { label: 'Badge', cmd: 'ghostforge carbon badge' },
    ],
  },
  {
    label: '🏥 Health',
    color: 'sky',
    cmds: [
      { label: 'Score', cmd: 'ghostforge health-score score' },
      { label: 'Dep Health', cmd: 'ghostforge dep-health check' },
      { label: 'Bundle', cmd: 'ghostforge bundle track' },
      { label: 'Coverage', cmd: 'ghostforge coverage check' },
    ],
  },
  {
    label: '🤖 AI Tools',
    color: 'violet',
    cmds: [
      { label: 'AI Review', cmd: 'ghostforge ai-review staged' },
      { label: 'Standup', cmd: 'ghostforge standup today' },
      { label: 'Explain Error', cmd: 'ghostforge explain' },
      { label: 'Tech Debt', cmd: 'ghostforge tech-debt scan' },
    ],
  },
  {
    label: '⚙️ Git',
    color: 'amber',
    cmds: [
      { label: 'Commit', cmd: 'ghostforge commit' },
      { label: 'Release', cmd: 'ghostforge release patch' },
      { label: 'PR Desc', cmd: 'ghostforge pr-description' },
      { label: 'Git Hooks', cmd: 'ghostforge git-hooks-setup install' },
    ],
  },
  {
    label: '🔧 Generate',
    color: 'rose',
    cmds: [
      { label: 'Component', cmd: 'ghostforge component-gen' },
      { label: 'API Docs', cmd: 'ghostforge api-docs generate' },
      { label: 'Docker', cmd: 'ghostforge docker-gen generate' },
      { label: 'DB Schema', cmd: 'ghostforge schema-viz show' },
    ],
  },
  {
    label: '🛠️ System',
    color: 'gray',
    cmds: [
      { label: 'Marketplace', cmd: 'ghostforge marketplace' },
      { label: 'Lighthouse', cmd: 'ghostforge lighthouse run' },
      { label: 'A11y Audit', cmd: 'ghostforge a11y audit' },
      { label: 'TUI Menu', cmd: '' },
    ],
  },
]

const COLOR_MAP: Record<string, string> = {
  emerald: 'border-emerald-800 bg-emerald-950/40 text-emerald-300 active:bg-emerald-900 hover:bg-emerald-900/60',
  sky: 'border-sky-800 bg-sky-950/40 text-sky-300 active:bg-sky-900 hover:bg-sky-900/60',
  violet: 'border-violet-800 bg-violet-950/40 text-violet-300 active:bg-violet-900 hover:bg-violet-900/60',
  amber: 'border-amber-800 bg-amber-950/40 text-amber-300 active:bg-amber-900 hover:bg-amber-900/60',
  rose: 'border-rose-800 bg-rose-950/40 text-rose-300 active:bg-rose-900 hover:bg-rose-900/60',
  gray: 'border-gray-700 bg-gray-900/40 text-gray-300 active:bg-gray-800 hover:bg-gray-800/60',
}

const HEADER_COLOR: Record<string, string> = {
  emerald: 'text-emerald-400',
  sky: 'text-sky-400',
  violet: 'text-violet-400',
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  gray: 'text-gray-400',
}

export default function TerminalPage() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false) // closed by default on mobile
  const sendCmdRef = useRef<((cmd: string) => void) | null>(null)
  const router = useRouter()

  // Open sidebar by default on desktop
  useEffect(() => {
    if (window.innerWidth >= 768) setSidebarOpen(true)
  }, [])

  useEffect(() => {
    fetch('/api/auth').then(r => {
      if (!r.ok) router.push('/login')
      else setAuthed(true)
    }).catch(() => router.push('/login'))
  }, [router])

  const runCommand = (cmd: string) => {
    if (!cmd) {
      sendCmdRef.current?.('\x03')
      return
    }
    sendCmdRef.current?.(cmd)
    // Auto-close sidebar on mobile after running command
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  if (authed === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <span className="animate-pulse text-sm text-gray-400">Loading terminal...</span>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#0a0a0f] overflow-hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 bg-gray-950/95 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(o => !o)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition active:scale-95"
            title="Toggle commands"
            aria-label="Toggle commands panel"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-base">👻</span>
          <span className="text-sm font-bold uppercase tracking-widest text-white">GhostForge</span>
          <span className="hidden rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-400 sm:inline">
            Terminal
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/features"
            className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/50 transition"
          >
            Features
          </Link>
          <Link
            href="/dashboard"
            className="rounded border border-sky-800/50 bg-sky-950/30 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/50 transition"
          >
            Dashboard
          </Link>
          <Link href="/chat" className="hidden text-xs text-gray-400 hover:text-white transition sm:block">
            Chat →
          </Link>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="relative flex flex-1 overflow-hidden">

        {/* Overlay backdrop on mobile when sidebar open */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/60 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Feature Sidebar ── */}
        <aside
          className={`
            absolute md:relative z-20 md:z-auto
            flex flex-col h-full
            w-64 md:w-52 shrink-0
            overflow-y-auto border-r border-gray-800 bg-[#0a0a0f] p-2 gap-3
            transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:hidden'}
          `}
        >
          {/* Mobile close button */}
          <div className="flex items-center justify-between mb-1 md:hidden">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quick Commands</p>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded p-1 text-gray-500 hover:text-white transition"
            >
              ✕
            </button>
          </div>
          <p className="hidden md:block px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quick Commands</p>

          {FEATURE_GROUPS.map(group => (
            <div key={group.label}>
              <p className={`mb-1 px-1 text-xs font-semibold ${HEADER_COLOR[group.color]}`}>{group.label}</p>
              <div className="grid grid-cols-2 gap-1">
                {group.cmds.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => runCommand(item.cmd)}
                    className={`rounded border px-1.5 py-1.5 text-xs font-medium transition touch-manipulation ${COLOR_MAP[group.color]}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-2 border-t border-gray-800 pt-2">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Keyboard</p>
            <div className="flex flex-col gap-1">
              {[
                { key: '↑↓', label: 'Navigate' },
                { key: 'Enter', label: 'Select' },
                { key: 'Esc/Q', label: 'Back' },
                { key: 'R', label: 'Reconnect' },
              ].map(tip => (
                <div key={tip.key} className="flex items-center gap-2 px-1">
                  <kbd className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-300">{tip.key}</kbd>
                  <span className="text-[10px] text-gray-500">{tip.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Terminal ── */}
        <div className="flex-1 overflow-hidden min-w-0">
          <XTermWrapper sendCommandRef={sendCmdRef} />
        </div>
      </div>
    </div>
  )
}

