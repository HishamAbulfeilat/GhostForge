'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_FEATURE_GROUPS } from '@/lib/quick-actions'

const XTermWrapper = dynamic(() => import('@/components/XTermWrapper'), { ssr: false })

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

const FEATURE_GROUPS = TERMINAL_FEATURE_GROUPS.map(group => ({
  ...group,
  cmds: group.commands.map(entry => ({ label: entry.label, cmd: entry.command })),
}))

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

const STATUS_CONFIG: Record<ConnStatus, { dot: string; label: string; glow: string }> = {
  connecting: { dot: 'bg-amber-400 animate-pulse', label: 'Connecting', glow: '' },
  connected:  { dot: 'bg-emerald-400 shadow-[0_0_6px_#34d399]', label: 'Connected', glow: 'text-emerald-400' },
  disconnected: { dot: 'bg-red-500', label: 'Disconnected', glow: 'text-red-400' },
  error: { dot: 'bg-red-500', label: 'Error', glow: 'text-red-400' },
}

// Stable proxy ref that delegates to a Map — avoids re-creating refs on each render
function makeMapRef<T>(map: React.MutableRefObject<Map<string, T>>, id: string) {
  return {
    get current(): T | null { return map.current.get(id) ?? null },
    set current(v: T | null) { v != null ? map.current.set(id, v) : map.current.delete(id) },
  }
}

function TabTerminal({ tabId, active, sendRefs, reconRefs, activateRefs, onStatusChange }: {
  tabId: string
  active: boolean
  sendRefs: React.MutableRefObject<Map<string, (cmd: string) => void>>
  reconRefs: React.MutableRefObject<Map<string, () => void>>
  activateRefs: React.MutableRefObject<Map<string, () => void>>
  onStatusChange: (s: ConnStatus) => void
}) {
  const sendRef = useRef<ReturnType<typeof makeMapRef<(cmd: string) => void>> | null>(null)
  if (sendRef.current === null) sendRef.current = makeMapRef(sendRefs, tabId)
  const recoRef = useRef<ReturnType<typeof makeMapRef<() => void>> | null>(null)
  if (recoRef.current === null) recoRef.current = makeMapRef(reconRefs, tabId)
  const actRef  = useRef<ReturnType<typeof makeMapRef<() => void>> | null>(null)
  if (actRef.current === null) actRef.current = makeMapRef(activateRefs, tabId)

  // When this tab becomes visible, re-fit + focus the terminal
  useEffect(() => {
    if (active) {
      // Small delay so the CSS visibility change has applied
      const id = setTimeout(() => activateRefs.current.get(tabId)?.(), 60)
      return () => clearTimeout(id)
    }
  }, [active, tabId, activateRefs])

  return (
    // Use visibility:hidden instead of display:none so xterm keeps its dimensions
    <div className={`absolute inset-0 transition-opacity duration-150 ${active ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'}`}>
      <XTermWrapper
        sendCommandRef={sendRef.current as React.MutableRefObject<((cmd: string) => void) | null>}
        reconnectRef={recoRef.current as React.MutableRefObject<(() => void) | null>}
        activateRef={actRef.current as React.MutableRefObject<(() => void) | null>}
        onStatusChange={onStatusChange}
      />
    </div>
  )
}

interface Tab {
  id: string
  name: string
  status: ConnStatus
}

let tabCounter = 1

export default function TerminalPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'tab-1', name: 'Terminal 1', status: 'connecting' }])
  const [activeTab, setActiveTab] = useState('tab-1')
  const sendCmdRefs   = useRef<Map<string, (cmd: string) => void>>(new Map())
  const reconnectRefs = useRef<Map<string, () => void>>(new Map())
  const activateRefs  = useRef<Map<string, () => void>>(new Map())

  const connStatus = tabs.find(t => t.id === activeTab)?.status ?? 'connecting'

  const addTab = () => {
    tabCounter += 1
    const id = `tab-${tabCounter}`
    setTabs(prev => [...prev, { id, name: `Terminal ${tabCounter}`, status: 'connecting' }])
    setActiveTab(id)
  }

  const closeTab = (id: string) => {
    const next = tabs.filter(t => t.id !== id)
    if (next.length === 0) return
    setTabs(next)
    if (activeTab === id) setActiveTab(next[next.length - 1].id)
    sendCmdRefs.current.delete(id)
    reconnectRefs.current.delete(id)
    activateRefs.current.delete(id)
  }

  const updateTabStatus = (id: string, status: ConnStatus) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  useEffect(() => {
    if (window.innerWidth >= 768) setSidebarOpen(true)
  }, [])

  const runCommand = (cmd: string) => {
    const fn = sendCmdRefs.current.get(activeTab)
    // The only empty-command quick action is "📋 Paste": send the clipboard
    // contents into the terminal. (Previously this sent Ctrl-C, interrupting
    // the running process and pasting nothing.)
    if (!cmd) {
      void navigator.clipboard?.readText?.().then(text => { if (text) fn?.(text) }).catch(() => {})
      return
    }
    fn?.(cmd)
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  const statusCfg = STATUS_CONFIG[connStatus]

  return (
    <div className="flex h-[100dvh] flex-col bg-[#0a0a0f] overflow-hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 bg-gray-950/95 px-3 py-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button"
            onClick={() => setSidebarOpen(o => !o)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition active:scale-95 shrink-0"
            title="Toggle commands panel"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-base shrink-0">👻</span>
          <span className="text-sm font-bold uppercase tracking-widest text-white hidden xs:block">GhostForge</span>

          {/* Connection status badge */}
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0d0d18] px-2.5 py-0.5">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusCfg.dot}`} />
            <span className={`text-[10px] font-mono hidden sm:block ${statusCfg.glow || 'text-gray-500'}`}>
              {statusCfg.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Reconnect button — shown when not connected */}
          {connStatus !== 'connected' && (
            <button type="button"
              onClick={() => reconnectRefs.current.get(activeTab)?.()}
              className="rounded border border-amber-800/60 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-900/50 transition active:scale-95"
            >
              ↺ Reconnect
            </button>
          )}
          <Link
            href="/features"
            className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/50 transition hidden sm:block"
          >
            Features
          </Link>
          <Link
            href="/dashboard"
            className="rounded border border-sky-800/50 bg-sky-950/30 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/50 transition"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-gray-800/60 bg-gray-950/90 px-2 py-1 scrollbar-none">
        {tabs.map(tab => {
          const s = STATUS_CONFIG[tab.status]
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition cursor-pointer select-none ${
                tab.id === activeTab
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`} />
              <span className="font-mono whitespace-nowrap">{tab.name}</span>
              {tabs.length > 1 && (
                <button type="button"
                  onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                  className="ms-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                >✕</button>
              )}
            </div>
          )
        })}
        <button type="button"
          onClick={addTab}
          className="ms-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-800 hover:text-white transition"
          title="New terminal"
        >+</button>
      </div>

      {/* ── Body ── */}
      <div className="relative flex flex-1 overflow-hidden">

        {/* Overlay backdrop on mobile */}
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
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'}
          `}
        >
          <div className="flex items-center justify-between mb-1 md:hidden">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quick Commands</p>
            <button type="button" onClick={() => setSidebarOpen(false)} className="rounded p-1 text-gray-500 hover:text-white transition">✕</button>
          </div>
          <p className="hidden md:block px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quick Commands</p>

          {FEATURE_GROUPS.map(group => (
            <div key={group.label}>
              <p className={`mb-1 px-1 text-xs font-semibold ${HEADER_COLOR[group.color]}`}>{group.label}</p>
              <div className="grid grid-cols-2 gap-1">
                {group.cmds.map(item => (
                  <button type="button"
                    key={item.label}
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
                { key: 'Esc / Q', label: 'Back' },
                { key: 'R', label: 'Reconnect' },
              ].map(tip => (
                <div key={tip.key} className="flex items-center gap-2 px-1">
                  <kbd className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-300">{tip.key}</kbd>
                  <span className="text-[10px] text-gray-500">{tip.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bridge hint when disconnected */}
          {connStatus !== 'connected' && (
            <div className="mt-auto border-t border-gray-800 pt-2 pb-1">
              <p className="px-1 mb-1 text-[10px] text-amber-500 font-semibold">Bridge offline</p>
              <p className="px-1 text-[10px] text-gray-600 leading-relaxed">
                Run in terminal:
              </p>
              <code className="mt-1 block rounded bg-gray-900 px-2 py-1.5 text-[10px] text-emerald-400 font-mono leading-relaxed break-all">
                bash ~/GhostForge/scripts/bridge.sh start
              </code>
            </div>
          )}
        </aside>

        {/* ── Terminal(s) — keep all tabs mounted, show active one ── */}
        <div className="flex-1 overflow-hidden min-w-0 relative">
          {tabs.map(tab => (
            <TabTerminal
              key={tab.id}
              tabId={tab.id}
              active={tab.id === activeTab}
              sendRefs={sendCmdRefs}
              reconRefs={reconnectRefs}
              activateRefs={activateRefs}
              onStatusChange={s => updateTabStatus(tab.id, s)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
