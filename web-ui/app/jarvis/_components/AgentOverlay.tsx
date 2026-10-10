'use client'

import type { Dispatch, SetStateAction } from 'react'
import dynamic from 'next/dynamic'
import type { ToastFn } from './types'

const AgentDashboard = dynamic(() => import('@/components/AgentDashboard'), { ssr: false })

interface AgentOverlayProps {
  mc: { ring: string; glow: string }
  toast: ToastFn
  setShowAgent: Dispatch<SetStateAction<boolean>>
  setAgentStatus: Dispatch<SetStateAction<string>>
}

/** Autonomous agent dashboard side panel (Electron only for start/stop/pause). */
export default function AgentOverlay({ mc, toast, setShowAgent, setAgentStatus }: AgentOverlayProps) {
  return (
    <div className="absolute inset-y-0 start-0 z-30 w-[min(640px,85vw)] overflow-y-auto border-e gfai-fade"
      style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.98)' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-10"
        style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.98)' }}>
        <span className="font-mono text-[10px] tracking-widest" style={{ color: mc.ring }}>🤖 AUTONOMOUS AGENT</span>
        <button type="button" onClick={() => setShowAgent(false)}
          className="text-blue-400/50 hover:text-blue-300 transition text-[10px]">✕ CLOSE</button>
      </div>
      <div className="p-3" style={{ height: 'calc(100% - 40px)' }}>
        <AgentDashboard
          onStart={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).electron?.autonomousAgent
            if (api) {
              api.start({}).then(() => {
                toast('success', '🤖 Agent started')
                setAgentStatus('MONITORING')
              }).catch(() => toast('error', 'Failed to start agent'))
            } else {
              toast('error', 'Agent requires Electron app')
            }
          }}
          onStop={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).electron?.autonomousAgent
            if (api) {
              api.stop().then(() => {
                toast('info', '🤖 Agent stopped')
                setAgentStatus('IDLE')
              }).catch(() => toast('error', 'Failed to stop agent'))
            }
          }}
          onPause={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).electron?.autonomousAgent
            if (api) {
              api.pause().then(() => {
                toast('info', '🤖 Agent paused')
                setAgentStatus('PAUSED')
              }).catch(() => toast('error', 'Failed to pause agent'))
            }
          }}
        />
      </div>
    </div>
  )
}
