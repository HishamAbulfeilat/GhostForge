'use client'

import type { Dispatch, SetStateAction } from 'react'
import dynamic from 'next/dynamic'
import { MARK_LIV_ACTIONS } from '@/lib/mark-liv-actions'
import type { Mode } from './types'

const MarkLPanel = dynamic(() => import('@/components/MarkLPanel'), { ssr: false })
const OpenJarvisPanel = dynamic(() => import('@/components/OpenJarvisPanel'), { ssr: false })
const MarkLivToolsPanel = dynamic(() => import('@/components/MarkLivToolsPanel'), { ssr: false })

interface MarkLOverlayProps {
  mc: { ring: string; glow: string }
  mode: Mode
  sendToJarvis: (text: string, quickAction?: string) => Promise<void>
  setShowMarkL: Dispatch<SetStateAction<boolean>>
}

/** Mark-L / Mark-LIV / OpenJarvis side panel. */
export default function MarkLOverlay({ mc, mode, sendToJarvis, setShowMarkL }: MarkLOverlayProps) {
  return (
    <div className="absolute inset-y-0 start-0 z-30 w-72 overflow-y-auto border-e p-3 gfai-fade gfai-scroll"
      style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.96)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: mc.ring }}>⚡ MARK-L</span>
        <button type="button" aria-label="Close Mark-L panel" onClick={() => setShowMarkL(false)}
          className="text-blue-400/50 hover:text-blue-300 transition text-[10px]">✕</button>
      </div>
      <MarkLPanel
        onRunAction={(prompt, id) => void sendToJarvis(prompt, id)}
        disabled={mode === 'thinking' || mode === 'listening'}
        ringColor={mc.ring}
      />
      {/* Mark-LIV engine registry — mirrors vendor/mark-liv actions */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] tracking-widest" style={{ color: mc.ring }}>🧠 MARK-LIV ENGINE</span>
          <span className="rounded px-1.5 py-0.5 text-[8px]" style={{ background: `${mc.ring}18`, color: mc.ring }}>20 TOOLS</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {MARK_LIV_ACTIONS.map(action => (
            <button
              key={action.id}
              type="button"
              title={action.description}
              onClick={() => void sendToJarvis(action.prompt, action.id)}
              disabled={mode === 'thinking' || mode === 'listening'}
              className="rounded border px-2 py-1 text-start text-[9px] transition disabled:opacity-30"
              style={{ borderColor: `${mc.ring}22`, color: `${mc.ring}99`, background: `${mc.ring}08` }}
            >
              {action.icon} {action.label}
              {action.scope === 'device' && <span className="ms-1 text-[7px] opacity-50">⚙</span>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[8px] leading-snug" style={{ color: `${mc.ring}55` }}>
          ⚙ = needs bridge / desktop engine (scripts/mark-liv.sh start)
        </p>
      </div>

      {/* OpenJarvis — local-first agent framework (opt-in, Apache-2.0) */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
        <OpenJarvisPanel ringColor={mc.ring} />
      </div>

      {/* Weather, flights, reminders and the Mark-LV tool runner (via /api/mark-liv-tools) */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
        <MarkLivToolsPanel ringColor={mc.ring} />
      </div>
    </div>
  )
}
