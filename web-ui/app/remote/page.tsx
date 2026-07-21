'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

type ShareMode = 'webrtc' | 'vnc'
type Status = 'idle' | 'connecting' | 'connected' | 'error'

interface RemoteSetupStatus {
  screenSharing: boolean
  websockify: boolean
  ip: string
  noVncUrl: string | null
}

interface RemoteSetupResponse extends RemoteSetupStatus {
  message?: string
  error?: string
}

interface RfbLike {
  scaleViewport: boolean
  resizeSession: boolean
  disconnect?: () => void
}

const QUICK_COMMANDS = [
  'Take a screenshot',
  'Lock the screen',
  'What is the system status?',
  'Open Safari',
  'What apps are running?',
  'Copy "Hello World" to clipboard',
  'Press cmd+space',
  'What time is it?',
]

function StatusPill({ active, onLabel, offLabel }: { active: boolean; onLabel: string; offLabel: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] ${active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900/50 text-slate-400'}`}>
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      {active ? onLabel : offLabel}
    </span>
  )
}

function WebRTCShare() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)

  const startShare = useCallback(async () => {
    try {
      setStatus('connecting')
      setError('')
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStatus('connected')
      stream.getVideoTracks()[0].onended = () => {
        setStatus('idle')
        streamRef.current = null
      }
    } catch (err) {
      setError(String(err))
      setStatus('error')
    }
  }, [])

  const stopShare = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-green-400 animate-pulse' : status === 'error' ? 'bg-red-400' : 'bg-gray-600'}`} />
        <span className="font-mono text-xs text-blue-300/70">
          {status === 'idle'
            ? 'Screen sharing ready'
            : status === 'connecting'
              ? 'Starting...'
              : status === 'connected'
                ? 'Screen sharing active'
                : `Error: ${error}`}
        </span>
      </div>

      {status === 'connected' && (
        <div className="relative overflow-hidden rounded-lg border border-green-500/30 bg-black" style={{ maxHeight: '600px' }}>
          <video ref={videoRef} className="h-auto w-full" muted autoPlay playsInline />
          <div className="absolute end-2 top-2">
            <button
              type="button"
              onClick={stopShare}
              className="rounded border border-red-500/50 bg-red-600/80 px-2 py-1 font-mono text-xs text-white transition hover:bg-red-500"
            >
              ✕ Stop
            </button>
          </div>
        </div>
      )}

      {status !== 'connected' && (
        <button
          type="button"
          onClick={startShare}
          className="w-fit rounded border px-4 py-2.5 font-mono text-sm transition"
          style={{ borderColor: '#0077C8', color: '#60a5fa', background: 'rgba(0,119,200,0.08)' }}
        >
          📺 Start Screen Share (WebRTC)
        </button>
      )}

      <div className="rounded border border-blue-500/10 p-3 font-mono text-[10px] text-blue-400/40">
        <p className="mb-1 font-bold text-blue-400/60">WebRTC Screen Share</p>
        <p>• Streams your screen directly in-browser.</p>
        <p>• No extra server required for live view.</p>
        <p>• Best option for safe observer-mode sharing.</p>
      </div>
    </div>
  )
}

function VNCControl({ setup, refreshSetup }: { setup: RemoteSetupStatus | null; refreshSetup: () => Promise<void> }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RfbLike | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [vncHost, setVncHost] = useState('localhost')
  const [vncPort, setVncPort] = useState('6080')
  const [vncPass, setVncPass] = useState('')
  const [error, setError] = useState('')
  const [connectionRequest, setConnectionRequest] = useState<{ host: string; port: string; password: string } | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setVncHost(window.location.hostname || 'localhost')
  }, [])

  useEffect(() => {
    return () => {
      rfbRef.current?.disconnect?.()
      rfbRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!connectionRequest || !canvasRef.current) return

    let cancelled = false
    const openConnection = async () => {
      setStatus('connecting')
      setError('')

      try {
        rfbRef.current?.disconnect?.()

        const RFBModule = await import('novnc-next')
        const RFB = RFBModule.default
        const wsUrl = `ws://${connectionRequest.host}:${connectionRequest.port}`
        const rfb = new RFB(canvasRef.current, wsUrl, {
          credentials: { password: connectionRequest.password },
        }) as RfbLike
        rfb.scaleViewport = true
        rfb.resizeSession = true

        if (cancelled) {
          rfb.disconnect?.()
          return
        }

        rfbRef.current = rfb
        setStatus('connected')
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
          setStatus('error')
        }
      }
    }

    void openConnection()

    return () => {
      cancelled = true
      rfbRef.current?.disconnect?.()
      rfbRef.current = null
    }
  }, [connectionRequest])

  const connect = useCallback(() => {
    setConnectionRequest({ host: vncHost, port: vncPort, password: vncPass })
  }, [vncHost, vncPass, vncPort])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-3 font-mono text-[10px] text-amber-400/60">
        <p className="mb-1 font-bold text-amber-400/80">VNC Remote Control</p>
        <p>1. Enable Screen Sharing on macOS.</p>
        <p>2. Start the WebSocket bridge below.</p>
        <p>3. Use the embedded noVNC viewer or connect manually.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusPill active={!!setup?.websockify} onLabel="Bridge live" offLabel="Bridge offline" />
            <StatusPill active={!!setup?.screenSharing} onLabel="Screen Sharing ON" offLabel="Screen Sharing OFF" />
            <button
              type="button"
              onClick={() => void refreshSetup()}
              className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 font-mono text-[10px] text-blue-300 transition hover:bg-blue-500/20"
            >
              Refresh status
            </button>
          </div>

          {setup?.websockify && setup.noVncUrl ? (
            <iframe
              title="noVNC viewer"
              src={setup.noVncUrl}
              sandbox="allow-scripts allow-forms"
              className="min-h-[420px] w-full rounded border border-blue-500/20 bg-black"
            />
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded border border-dashed border-blue-500/15 bg-slate-950/60 px-6 text-center font-mono text-xs text-blue-400/35">
              Start the WebSocket bridge to load the embedded noVNC viewer at localhost:6080.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 rounded-lg border border-blue-500/15 bg-blue-950/10 p-3 font-mono text-xs">
            <div>
              <label htmlFor="bridge-host" className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-blue-300/55">Bridge host</label>
              <input
                id="bridge-host"
                value={vncHost}
                onChange={event => setVncHost(event.target.value)}
                placeholder="localhost"
                className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label htmlFor="bridge-port" className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-blue-300/55">Bridge port</label>
              <input
                id="bridge-port"
                value={vncPort}
                onChange={event => setVncPort(event.target.value)}
                placeholder="6080"
                className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label htmlFor="bridge-password" className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-blue-300/55">VNC password</label>
              <input
                id="bridge-password"
                value={vncPass}
                onChange={event => setVncPass(event.target.value)}
                type="password"
                placeholder="Optional"
                className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-white"
              />
            </div>
            <button
              type="button"
              onClick={() => void connect()}
              className="w-fit rounded border px-4 py-2 font-mono text-sm transition"
              style={{ borderColor: '#f59e0b', color: '#f59e0b', background: 'rgba(245,158,11,0.06)' }}
            >
              🖥️ Connect Manual VNC
            </button>
          </div>

          <div ref={canvasRef} className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
            {status !== 'connected' && (
              <span className="font-mono text-xs text-blue-400/30">
                {status === 'idle' ? 'Manual VNC canvas will appear here' : status === 'connecting' ? 'Connecting...' : `Connection failed${error ? `: ${error}` : ''}`}
              </span>
            )}
          </div>

          <div className="rounded-lg border border-blue-500/15 bg-blue-950/10 p-3 font-mono text-[10px] text-blue-200/65">
            <p className="mb-1 text-blue-300/85">Keyboard shortcuts</p>
            <p>• ⌘⇧3 / ⌘⇧4 — macOS screenshots</p>
            <p>• ⌘Tab — switch apps in active VNC session</p>
            <p>• ⌃⌘Q — lock screen instantly</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function AICommandPanel() {
  const [cmd, setCmd] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const runCommand = async () => {
    if (!cmd.trim()) return
    setLoading(true)
    setResult('')
    try {
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cmd }),
      })
      if (!res.ok) {
        setResult('Error: Could not reach JARVIS.')
        return
      }
      const data = await res.json() as { speech: string; toolResult?: string }
      setResult(`${data.speech}${data.toolResult ? `\n\nResult:\n${data.toolResult}` : ''}`)
    } catch {
      setResult('Error: Could not reach JARVIS.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="jarvis-remote-command" className="mb-1 block text-[10px] uppercase tracking-[0.25em] text-blue-400/50">
          Tell JARVIS to control your Mac
        </label>
        <div className="flex gap-2">
          <input
            id="jarvis-remote-command"
            value={cmd}
            onChange={event => setCmd(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void runCommand() }}
            placeholder="Take a screenshot, open Safari, lock the Mac..."
            className="flex-1 rounded border border-blue-500/20 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder:text-blue-400/30 focus:border-blue-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void runCommand()}
            disabled={loading}
            className="rounded border px-4 py-2 font-mono text-sm transition disabled:opacity-50"
            style={{ borderColor: '#0077C8', color: '#60a5fa', background: loading ? 'rgba(0,119,200,0.18)' : 'rgba(0,119,200,0.08)' }}
          >
            {loading ? '...' : '▶ RUN'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_COMMANDS.map(item => (
          <button
            key={item}
            type="button"
            onClick={() => setCmd(item)}
            className="rounded border border-blue-500/15 px-2 py-1 font-mono text-[10px] text-blue-400/60 transition hover:border-blue-500/40 hover:text-blue-300"
          >
            {item}
          </button>
        ))}
      </div>

      {result && (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-green-500/20 bg-green-900/10 p-3 font-mono text-xs text-green-300/80">
          {result}
        </pre>
      )}
    </div>
  )
}

export default function RemotePage() {
  const [tab, setTab] = useState<ShareMode>('webrtc')
  const [setup, setSetup] = useState<RemoteSetupStatus | null>(null)
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupMessage, setSetupMessage] = useState('')

  const fetchSetup = useCallback(async () => {
    try {
      const res = await fetch('/api/remote/setup')
      if (!res.ok) {
        setSetupMessage('Could not fetch remote setup status.')
        return
      }
      const data = await res.json() as RemoteSetupStatus
      setSetup(data)
    } catch {
      setSetupMessage('Could not fetch remote setup status.')
    }
  }, [])

  useEffect(() => {
    void fetchSetup()
  }, [fetchSetup])

  const runSetupAction = useCallback(async (action: 'enable-screen-sharing' | 'start-websockify') => {
    setSetupLoading(true)
    try {
      const res = await fetch('/api/remote/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({ error: 'Remote setup action failed.' })) as { error?: string }
        setSetupMessage(errorPayload.error || 'Remote setup action failed.')
        return
      }

      const data = await res.json() as RemoteSetupResponse
      setSetup({
        screenSharing: data.screenSharing,
        websockify: data.websockify,
        ip: data.ip,
        noVncUrl: data.noVncUrl,
      })
      setSetupMessage(data.message || 'Remote setup updated.')
    } catch {
      setSetupMessage('Remote setup action failed.')
    } finally {
      setSetupLoading(false)
    }
  }, [])

  const connectionUrl = useMemo(
    () => setup?.ip ? `http://${setup.ip}:3001/remote` : 'http://[ip]:3001/remote',
    [setup?.ip],
  )

  return (
    <div className="min-h-[100dvh] bg-[#050a18] font-mono text-white">
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xs text-blue-400/50 transition hover:text-blue-300">← DASHBOARD</Link>
          <span className="text-[10px] text-blue-400/20">|</span>
          <span className="text-sm font-bold text-blue-300">🖥️ G.F.A.I. Remote Control</span>
        </div>
        <span className="text-[10px] text-blue-400/30">Screen Share + Mac Control + noVNC</span>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-4 text-xs text-amber-300/70">
          <strong className="text-amber-400">🔒 Security:</strong> This remote session is PIN-protected (PIN: 2001). All actions are audit-logged. Unauthorized access attempts trigger automatic Mac lockdown.
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-blue-500/20 bg-[#080d18] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="me-2 text-sm font-bold text-blue-300">Remote Setup</h2>
              <StatusPill active={!!setup?.screenSharing} onLabel="Screen Sharing ON" offLabel="Screen Sharing OFF" />
              <StatusPill active={!!setup?.websockify} onLabel="Bridge Running" offLabel="Bridge Stopped" />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void runSetupAction('enable-screen-sharing')}
                disabled={setupLoading}
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-50"
              >
                Enable Mac Screen Sharing
              </button>
              <button
                type="button"
                onClick={() => void runSetupAction('start-websockify')}
                disabled={setupLoading}
                className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
              >
                Start WebSocket Bridge
              </button>
              <button
                type="button"
                onClick={() => void fetchSetup()}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
            {setupMessage && (
              <p className="mt-3 text-xs text-cyan-200/70">{setupMessage}</p>
            )}
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-[#080d18] p-5">
            <p className="text-[10px] uppercase tracking-[0.35em] text-blue-400/45">Connection Instructions</p>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <p>1. Your Mac IP: <span className="text-cyan-300">{setup?.ip ?? 'Detecting...'}</span></p>
              <p>2. Open: <span className="break-all text-cyan-300">{connectionUrl}</span></p>
              <p>3. Click <span className="text-blue-200">Start WebRTC Share</span> for live view.</p>
              <p>4. For full control, start the bridge and use the embedded noVNC panel.</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-blue-500/20 bg-[#080d18] p-5">
          <h2 className="mb-3 text-sm font-bold text-blue-300">🤖 JARVIS Control</h2>
          <AICommandPanel />
        </div>

        <div className="overflow-hidden rounded-lg border border-white/5 bg-[#080d18]">
          <div className="flex border-b border-white/5">
            {[
              { id: 'webrtc' as ShareMode, label: '📺 WebRTC Screen Share' },
              { id: 'vnc' as ShareMode, label: '🖥️ VNC Remote Control' },
            ].map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className="border-e border-white/5 px-5 py-3 text-xs font-mono transition"
                style={{
                  color: tab === item.id ? '#60a5fa' : 'rgba(148,163,184,0.4)',
                  background: tab === item.id ? 'rgba(0,119,200,0.08)' : 'transparent',
                  borderBottom: tab === item.id ? '2px solid #0077C8' : '2px solid transparent',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="p-5">
            {tab === 'webrtc' ? <WebRTCShare /> : <VNCControl setup={setup} refreshSetup={fetchSetup} />}
          </div>
        </div>
      </div>
    </div>
  )
}
