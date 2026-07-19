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
    label: '⚙️ Git & Release',
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
      { label: 'TUI Menu', cmd: '' },
      { label: 'Marketplace', cmd: 'ghostforge marketplace' },
      { label: 'Lighthouse', cmd: 'ghostforge lighthouse run' },
      { label: 'A11y Audit', cmd: 'ghostforge a11y audit' },
    ],
  },
]

const COLOR_MAP: Record<string, string> = {
  emerald: 'border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60',
  sky: 'border-sky-800 bg-sky-950/40 text-sky-300 hover:bg-sky-900/60',
  violet: 'border-violet-800 bg-violet-950/40 text-violet-300 hover:bg-violet-900/60',
  amber: 'border-amber-800 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60',
  rose: 'border-rose-800 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60',
  gray: 'border-gray-700 bg-gray-900/40 text-gray-300 hover:bg-gray-800/60',
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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const sendCmdRef = useRef<((cmd: string) => void) | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth').then(r => {
      if (!r.ok) router.push('/login')
      else setAuthed(true)
    }).catch(() => router.push('/login'))
  }, [router])

  const runCommand = (cmd: string) => {
    if (!cmd) {
      // Empty = open TUI menu (just press Enter to bring up menu)
      sendCmdRef.current?.('\x03') // Ctrl+C first to cancel any input
      return
    }
    sendCmdRef.current?.(cmd)
  }

  if (authed === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <span className="animate-pulse text-sm text-gray-400">Loading terminal...</span>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0f] overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 bg-gray-950/95 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(o => !o)}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white transition"
            title="Toggle feature panel"
          >
            ☰
          </button>
          <span className="text-base">🔫</span>
          <span className="text-sm font-bold uppercase tracking-widest text-white">GhostForge</span>
          <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-400">TUI Terminal</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-gray-500 sm:block">Click any button → runs on your Mac</span>
          <Link href="/chat" className="text-xs text-gray-400 hover:text-white transition">Chat →</Link>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Feature Sidebar */}
        {sidebarOpen && (
          <div className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-gray-800 bg-gray-950/80 p-2 gap-3">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quick Commands</p>
            {FEATURE_GROUPS.map(group => (
              <div key={group.label}>
                <p className={`mb-1 px-1 text-xs font-semibold ${HEADER_COLOR[group.color]}`}>{group.label}</p>
                <div className="grid grid-cols-2 gap-1">
                  {group.cmds.map(item => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => runCommand(item.cmd)}
                      className={`rounded border px-1.5 py-1 text-xs font-medium transition ${COLOR_MAP[group.color]}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-2 border-t border-gray-800 pt-2">
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Navigation</p>
              <div className="flex flex-col gap-1">
                {[
                  { key: '↑↓', label: 'Navigate menu' },
                  { key: 'Enter', label: 'Select item' },
                  { key: 'Esc/Q', label: 'Go back' },
                  { key: 'R', label: 'Reconnect' },
                ].map(tip => (
                  <div key={tip.key} className="flex items-center gap-2 px-1">
                    <kbd className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-300">{tip.key}</kbd>
                    <span className="text-[10px] text-gray-500">{tip.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Terminal */}
        <div className="flex-1 overflow-hidden">
          <XTermWrapper sendCommandRef={sendCmdRef} />
        </div>
      </div>
    </div>
  )
}
