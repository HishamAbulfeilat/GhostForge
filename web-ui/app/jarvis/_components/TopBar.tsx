'use client'

import type { Dispatch, SetStateAction } from 'react'
import Link from 'next/link'
import CollabShare from '@/components/CollabShare'
import { platformLabel, type Platform } from '@/lib/platform'
import Clock from './Clock'
import type { Memory, Mode, ToastFn } from './types'

interface TopBarProps {
  mc: { ring: string; glow: string }
  mode: Mode
  lastToolUsed: string | null
  currentUser: { name: string; username: string; role: string } | null
  memory: Memory
  platform: Platform
  detectedLang: string
  activePersona: { badge: string }
  showSettings: boolean
  setShowSettings: Dispatch<SetStateAction<boolean>>
  showAudit: boolean
  setShowAudit: Dispatch<SetStateAction<boolean>>
  showMarkL: boolean
  setShowMarkL: Dispatch<SetStateAction<boolean>>
  copilotMode: boolean
  setCopilotMode: Dispatch<SetStateAction<boolean>>
  toast: ToastFn
}

/** Top HUD bar: mode, signed-in user, panel toggles and the clock. */
export default function TopBar({
  mc, mode, lastToolUsed, currentUser, memory, platform, detectedLang, activePersona,
  showSettings, setShowSettings, showAudit, setShowAudit, showMarkL, setShowMarkL,
  copilotMode, setCopilotMode, toast,
}: TopBarProps) {
  return (
    <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-y-2 border-b px-4 py-2"
      style={{ borderColor: `${mc.ring}33`, background: 'rgba(0,5,20,0.92)' }}>
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-xs font-mono text-blue-400/60 hover:text-blue-300 transition">← DASHBOARD</Link>
        <span className="text-[10px] text-blue-400/30 font-mono">|</span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full gfai-blink" style={{ background: mc.ring }} />
          <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: mc.ring }}>
            G.F.A.I. — {mode}
          </span>
        </div>
        {lastToolUsed && (
          <span className="font-mono text-[10px] text-blue-400/40 hidden sm:block">
            ⚡ {lastToolUsed.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      {/* On phones the controls scroll sideways instead of running off-screen */}
      <div className="-mx-1 flex min-w-0 max-w-full items-center gap-3 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&>*]:shrink-0">
        {currentUser ? (
          <span className="hidden sm:flex items-center gap-1.5 font-mono text-[10px]" style={{ color: currentUser.role === 'admin' ? '#fbbf24' : '#93c5fd' }}
            title={`Signed in as ${currentUser.name}`}>
            <span>👤</span>
            <span>{currentUser.username.toUpperCase()}</span>
            <span className="rounded px-1 py-px text-[9px] uppercase"
              style={{ background: currentUser.role === 'admin' ? 'rgba(251,191,36,0.15)' : 'rgba(147,197,253,0.15)', border: currentUser.role === 'admin' ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(147,197,253,0.4)' }}>
              {currentUser.role}
            </span>
          </span>
        ) : (
          <span className="hidden font-mono text-[10px] text-blue-400/40 sm:block">👤</span>
        )}
        {memory.userName && (
          <span className="font-mono text-[10px] text-blue-300/50 hidden sm:block">
            {memory.userName.toUpperCase()}
          </span>
        )}
        {/* Platform + language indicator */}
        <span className="font-mono text-[10px] text-blue-400/40 hidden sm:block" title={`Device: ${platform.type} | Lang: ${detectedLang}`}>
          {platformLabel(platform)} {detectedLang !== 'en' ? `| ${detectedLang.toUpperCase()}` : ''}
        </span>
        <span className="hidden rounded border px-2 py-1 font-mono text-[10px] sm:block" style={{ borderColor: `${mc.ring}33`, color: mc.ring, background: `${mc.ring}12` }}>
          {activePersona.badge}
        </span>
        <Link href="/history"
          className="font-mono text-[10px] rounded px-2 py-1 border transition"
          style={{ borderColor: `${mc.ring}44`, color: '#67e8f9cc', background: 'transparent' }}>
          📜 HISTORY
        </Link>
        {currentUser?.role === 'admin' && (
          <Link href="/users"
            className="font-mono text-[10px] rounded px-2 py-1 border transition"
            style={{ borderColor: '#fbbf2444', color: '#fde68acc', background: 'transparent' }}>
            👥 USERS
          </Link>
        )}
        <button type="button" onClick={() => setShowSettings(s => !s)}
          className="font-mono text-[10px] rounded px-2 py-1 border transition"
          style={{ borderColor: `${mc.ring}44`, color: `${mc.ring}99`, background: showSettings ? `${mc.ring}18` : 'transparent' }}>
          ⚙ SETTINGS
        </button>
        <CollabShare />
        <button type="button" onClick={() => setShowAudit(s => !s)}
          className="font-mono text-[10px] rounded px-2 py-1 border transition"
          style={{ borderColor: `${mc.ring}44`, color: '#f59e0b99', background: showAudit ? 'rgba(245,158,11,0.08)' : 'transparent' }}
          title="View audit log of all tool actions">
          📋 AUDIT
        </button>
        <button type="button" onClick={() => { setShowMarkL(s => !s); if (!showMarkL) setShowSettings(false) }}
          className="font-mono text-[10px] rounded px-2 py-1 border transition"
          style={{ borderColor: showMarkL ? '#00ff88' : `${mc.ring}44`, color: showMarkL ? '#00ff88' : `${mc.ring}88`, background: showMarkL ? 'rgba(0,255,136,0.08)' : 'transparent' }}
          title="Mark-L features panel — 29 capabilities">
          ⚡ MARK-L
        </button>
        {/* ── Copilot CLI Mode Toggle ── */}
        <button type="button"
          onClick={() => {
            const next = !copilotMode
            setCopilotMode(next)
            toast(next ? 'success' : 'info',
              next ? '🤖 Copilot CLI mode ON — all messages go to gh copilot' : '🤖 Copilot CLI mode OFF — back to G.F.A.I.')
          }}
          className="font-mono text-[10px] rounded px-2 py-1 border transition"
          style={{
            borderColor: copilotMode ? '#00ff88' : `${mc.ring}44`,
            color:       copilotMode ? '#00ff88' : `${mc.ring}88`,
            background:  copilotMode ? 'rgba(0,255,136,0.08)' : 'transparent',
            boxShadow:   copilotMode ? '0 0 8px rgba(0,255,136,0.2)' : 'none',
          }}
          title="Toggle GitHub Copilot CLI mode — routes messages directly to gh copilot">
          {copilotMode ? '🤖 COPILOT ON' : '🤖 COPILOT'}
        </button>
        <Clock />
      </div>
    </div>
  )
}
