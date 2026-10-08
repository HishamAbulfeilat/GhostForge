'use client'

import { useEffect, useState } from 'react'
import type { N8nConnection } from './useN8nConnection'
import type { ToastFn } from './types'

/**
 * n8n section of the settings panel. The reachability probe (every 15 s) lives
 * here, so it only runs while the settings panel is open.
 */
export default function N8nSettings({ mc, toast, n8n }: { mc: { ring: string; glow: string }; toast: ToastFn; n8n: N8nConnection }) {
  const { n8nConnected, setN8nConnected, n8nUrl, setN8nUrl, n8nUrlTouched, setN8nUrlTouched, n8nWorkflows, setN8nWorkflows } = n8n
  const [n8nConnecting, setN8nConnecting] = useState(false)
  const [n8nReachable, setN8nReachable] = useState<boolean | null>(null)
  const [n8nCreating, setN8nCreating] = useState(false)
  const [n8nNewName, setN8nNewName] = useState('')
  const [n8nNewType, setN8nNewType] = useState<'deploy' | 'notify' | 'pr' | 'custom'>('deploy')
  const [n8nNewDesc, setN8nNewDesc] = useState('')
  const [n8nCopiedId, setN8nCopiedId] = useState<string | null>(null)

  useEffect(() => {
    // Only probe n8n when it's actually in use (connected via Electron, or the
    // user entered a custom URL) — avoids ERR_CONNECTION_REFUSED noise in the
    // console every 15s when n8n is never used.
    if (!n8nConnected && !n8nUrlTouched) {
      setN8nReachable(null)
      return
    }
    let active = true
    const check = async () => {
      try {
        await fetch(n8nUrl, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(3000) })
        if (active) setN8nReachable(true)
      } catch {
        if (active) setN8nReachable(false)
      }
    }
    void check()
    const timer = setInterval(check, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [n8nUrl, n8nConnected, n8nUrlTouched])

  return (
    <div className="min-w-[300px]">
      <p className="text-blue-400/40 tracking-widest mb-1.5">N8N WORKFLOWS</p>
      <div className="flex items-center gap-2 mb-2">
        <span className="h-2 w-2 rounded-full" style={{ background: n8nReachable === null ? '#f59e0b' : n8nReachable ? '#00ff88' : '#ff4444' }} />
        <span className="font-mono text-[10px]" style={{ color: n8nConnected ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>
          {n8nConnected ? `Connected — ${n8nWorkflows.length} workflows` : n8nReachable === false ? 'Unreachable' : 'Disconnected'}
        </span>
      </div>
      <div className="flex gap-1.5 mb-2">
        <input
          type="text"
          value={n8nUrl}
          onChange={e => { setN8nUrl(e.target.value); setN8nUrlTouched(true) }}
          placeholder="http://localhost:5678"
          aria-label="n8n URL"
          className="flex-1 rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none"
          style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
        />
        <button
          type="button"
          disabled={n8nConnecting}
          onClick={async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).electron?.n8n
            if (!api) { toast('error', 'n8n requires Electron app'); return }
            setN8nConnecting(true)
            try {
              const res = await api.connect(n8nUrl)
              setN8nConnected(res.connected)
              if (res.connected) {
                const wfs = await api.listWorkflows()
                setN8nWorkflows(wfs)
                toast('success', `Connected to n8n — ${wfs.length} workflows`)
              } else {
                toast('error', 'Cannot connect to n8n — is it running?')
              }
            } catch {
              toast('error', 'n8n connection failed')
            } finally {
              setN8nConnecting(false)
            }
          }}
          className="rounded px-2 py-1 border font-mono text-[10px] transition disabled:opacity-40"
          style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
          {n8nConnecting ? '...' : 'CONNECT'}
        </button>
      </div>

      {/* Open n8n Editor button */}
      <button
        type="button"
        onClick={() => window.open(n8nUrl, '_blank')}
        className="w-full rounded border px-3 py-1.5 font-mono text-[10px] transition flex items-center justify-center gap-2 mb-2"
        style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}18` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: n8nReachable === true ? '#00ff88' : n8nReachable === false ? '#ff4444' : '#f59e0b' }} />
        Open n8n Editor
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>

      {/* Workflow list with webhook URLs */}
      {n8nConnected && n8nWorkflows.length > 0 && (
        <div className="rounded border max-h-40 overflow-y-auto mb-2"
          style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,0,0,0.18)' }}>
          {n8nWorkflows.map(wf => (
            <div key={wf.id} className="px-2 py-1.5 border-b last:border-b-0"
              style={{ borderColor: `${mc.ring}11` }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] truncate" style={{ color: wf.active ? '#00ff88' : `${mc.ring}88` }}>
                  {wf.active ? '🟢' : '⚪'} {wf.name}
                </span>
                <span className="font-mono text-[8px] text-blue-400/30 shrink-0">{wf.id}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <code
                  className="flex-1 font-mono text-[8px] px-1.5 py-0.5 rounded truncate select-all"
                  style={{ background: 'rgba(0,0,0,0.3)', color: `${mc.ring}cc`, border: `1px solid ${mc.ring}22` }}
                >
                  {`${n8nUrl}/webhook/ghostforge-${wf.id}`}
                </code>
                <button
                  type="button"
                  aria-label={`Copy webhook URL for ${wf.name}`}
                  onClick={() => {
                    const url = `${n8nUrl}/webhook/ghostforge-${wf.id}`
                    navigator.clipboard.writeText(url).then(() => {
                      setN8nCopiedId(wf.id)
                      toast('success', 'Webhook URL copied')
                      setTimeout(() => setN8nCopiedId(null), 1500)
                    }).catch(() => toast('error', 'Failed to copy'))
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] transition"
                  style={{
                    borderColor: n8nCopiedId === wf.id ? '#00ff8866' : `${mc.ring}44`,
                    color: n8nCopiedId === wf.id ? '#00ff88' : `${mc.ring}aa`,
                    background: n8nCopiedId === wf.id ? 'rgba(0,255,136,0.1)' : 'transparent',
                    border: `1px solid ${n8nCopiedId === wf.id ? '#00ff8866' : `${mc.ring}44`}`,
                  }}>
                  {n8nCopiedId === wf.id ? '✓' : '⧉'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Workflow Creator */}
      <div className="rounded border p-2 mb-2" style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,0,0,0.18)' }}>
        <p className="font-mono text-[9px] tracking-widest text-blue-400/45 mb-1.5">CREATE WORKFLOW</p>
        <input
          type="text"
          value={n8nNewName}
          onChange={e => setN8nNewName(e.target.value)}
          placeholder="Workflow name (required)"
          aria-label="Workflow name"
          className="w-full rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none mb-1.5"
          style={{ borderColor: `${mc.ring}33`, color: mc.ring }}
        />
        <select
          value={n8nNewType}
          aria-label="Workflow template type"
          onChange={e => setN8nNewType(e.target.value as typeof n8nNewType)}
          className="w-full rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none mb-1.5"
          style={{ borderColor: `${mc.ring}33`, color: mc.ring }}>
          <option value="deploy">🚀 Deploy — webhook + HTTP request</option>
          <option value="notify">📢 Notify — webhook + email/Slack</option>
          <option value="pr">🔀 PR Review — webhook + GitHub</option>
          <option value="custom">⚙ Custom — webhook only</option>
        </select>
        <input
          type="text"
          value={n8nNewDesc}
          onChange={e => setN8nNewDesc(e.target.value)}
          placeholder="Description (optional)"
          aria-label="Workflow description"
          className="w-full rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none mb-1.5"
          style={{ borderColor: `${mc.ring}33`, color: mc.ring }}
        />
        <button
          type="button"
          disabled={!n8nNewName.trim() || n8nCreating || !n8nConnected}
          onClick={async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api = (window as any).electron?.n8n
            if (!api) { toast('error', 'n8n requires Electron app'); return }
            setN8nCreating(true)
            try {
              const res = await api.createWorkflow({
                name: n8nNewName.trim(),
                type: n8nNewType,
                description: n8nNewDesc.trim(),
              })
              if (res?.id) {
                toast('success', `Workflow "${n8nNewName.trim()}" created — ${n8nUrl}/webhook/ghostforge-${res.id}`)
              } else {
                toast('success', `Workflow "${n8nNewName.trim()}" created`)
              }
              setN8nNewName('')
              setN8nNewDesc('')
              if (n8nConnected) {
                const wfs = await api.listWorkflows()
                setN8nWorkflows(wfs)
              }
            } catch (e) {
              toast('error', `Create failed: ${(e as Error).message || 'unknown error'}`)
            } finally {
              setN8nCreating(false)
            }
          }}
          className="w-full rounded px-2 py-1 border font-mono text-[10px] transition disabled:opacity-40"
          style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
          {n8nCreating ? 'CREATING…' : '+ CREATE'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[
          { label: 'DEPLOY', action: 'deploy', icon: '🚀' },
          { label: 'NOTIFY', action: 'notify', icon: '📢' },
          { label: 'PR', action: 'pr', icon: '🔀' },
          { label: 'IMPORT', action: 'import', icon: '📥' },
        ].map(btn => (
          <button
            key={btn.action}
            type="button"
            disabled={!n8nConnected}
            onClick={async () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const api = (window as any).electron?.n8n
              if (!api) { toast('error', 'n8n requires Electron app'); return }
              if (btn.action === 'import') {
                const res = await api.importWorkflows()
                toast('success', `Imported ${res.count} workflows`)
                if (n8nConnected) {
                  const wfs = await api.listWorkflows()
                  setN8nWorkflows(wfs)
                }
                return
              }
              if (btn.action === 'deploy') {
                await api.deploy('deploy', 'ghostforge')
                toast('success', 'Deploy workflow triggered')
                return
              }
              if (btn.action === 'notify') {
                await api.notify('general', 'Test notification from JARVIS', 'medium')
                toast('success', 'Notify workflow triggered')
                return
              }
              if (btn.action === 'pr') {
                await api.pr('review', 1, 'ghostforge/ghostforge-agents')
                toast('success', 'PR workflow triggered')
                return
              }
            }}
            className="rounded px-2 py-1 border font-mono text-[9px] transition disabled:opacity-30"
            style={{ borderColor: `${mc.ring}33`, color: `${mc.ring}cc`, background: `${mc.ring}08` }}>
            {btn.icon} {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}
