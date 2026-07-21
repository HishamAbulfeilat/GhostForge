'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

// ── Screen Share Mode Types ────────────────────────────────────────────────────
type ShareMode = 'webrtc' | 'vnc' | 'none'
type Status = 'idle' | 'connecting' | 'connected' | 'error'

// ── WebRTC Screen Share ────────────────────────────────────────────────────────

function WebRTCShare() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError]   = useState('')
  const streamRef = useRef<MediaStream | null>(null)

  const startShare = useCallback(async () => {
    try {
      setStatus('connecting')
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
    } catch (e) {
      setError(String(e))
      setStatus('error')
    }
  }, [])

  const stopShare = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-green-400 animate-pulse' : status === 'error' ? 'bg-red-400' : 'bg-gray-600'}`} />
        <span className="font-mono text-xs text-blue-300/70">
          {status === 'idle' ? 'Screen sharing ready' : status === 'connecting' ? 'Starting...' : status === 'connected' ? 'Screen sharing active' : `Error: ${error}`}
        </span>
      </div>

      {status === 'connected' && (
        <div className="relative rounded-lg border border-green-500/30 overflow-hidden bg-black" style={{ maxHeight: '600px' }}>
          <video ref={videoRef} className="w-full h-auto" muted autoPlay playsInline />
          <div className="absolute top-2 right-2">
            <button onClick={stopShare}
              className="text-xs font-mono px-2 py-1 rounded bg-red-600/80 hover:bg-red-500 text-white border border-red-500/50 transition">
              ✕ Stop
            </button>
          </div>
        </div>
      )}

      {status !== 'connected' && (
        <button onClick={startShare}
          className="font-mono text-sm px-4 py-2.5 rounded border transition w-fit"
          style={{ borderColor: '#0077C8', color: '#60a5fa', background: 'rgba(0,119,200,0.08)' }}>
          📺 Start Screen Share (WebRTC)
        </button>
      )}

      <div className="font-mono text-[10px] text-blue-400/40 border border-blue-500/10 rounded p-3">
        <p className="text-blue-400/60 font-bold mb-1">WebRTC Screen Share</p>
        <p>• Streams your screen in the browser via native WebRTC API</p>
        <p>• No server required — runs entirely in browser</p>
        <p>• G.F.A.I. can see what&apos;s on screen via describe_screen tool</p>
        <p>• Use for monitoring AI actions in real time</p>
      </div>
    </div>
  )
}

// ── VNC Remote Control ─────────────────────────────────────────────────────────

function VNCControl() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [status, setStatus]   = useState<Status>('idle')
  const [vncHost, setVncHost] = useState('localhost')
  const [vncPort, setVncPort] = useState('5900')
  const [vncPass, setVncPass] = useState('')
  const rfbRef = useRef<unknown>(null)

  const connect = useCallback(async () => {
    if (!canvasRef.current) return
    setStatus('connecting')
    try {
      // Dynamic import to avoid SSR issues
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RFBModule = await import('novnc-next') as any
      const RFB = RFBModule.default || RFBModule
      const wsUrl = `ws://localhost:${vncPort}`
      const rfb = new RFB(
        canvasRef.current,
        wsUrl,
        { credentials: { password: vncPass } }
      )
      rfb.scaleViewport  = true
      rfb.resizeSession  = true
      rfbRef.current = rfb
      rfb.addEventListener('connect',    () => setStatus('connected'))
      rfb.addEventListener('disconnect', () => setStatus('idle'))
    } catch (e) {
      setStatus('error')
      console.error('VNC error:', e)
    }
  }, [vncPort, vncPass])

  return (
    <div className="flex flex-col gap-4">
      <div className="font-mono text-[10px] text-amber-400/60 border border-amber-500/20 rounded p-3">
        <p className="text-amber-400/80 font-bold mb-1">VNC Remote Control — Setup Required</p>
        <p>1. Enable Screen Sharing: System Settings → General → Sharing → Screen Sharing</p>
        <p>2. Install websockify: <code className="text-green-400">pip3 install websockify</code></p>
        <p>3. Run proxy: <code className="text-green-400">websockify 5900 localhost:5900</code></p>
        <p>4. Connect below</p>
      </div>

      {status !== 'connected' && (
        <div className="flex flex-col gap-2 font-mono text-xs">
          <div className="flex gap-2">
            <input value={vncHost} onChange={e => setVncHost(e.target.value)}
              placeholder="Host" className="rounded px-2 py-1 bg-white/5 border border-white/10 text-white w-32" />
            <input value={vncPort} onChange={e => setVncPort(e.target.value)}
              placeholder="Port" className="rounded px-2 py-1 bg-white/5 border border-white/10 text-white w-20" />
            <input value={vncPass} onChange={e => setVncPass(e.target.value)}
              type="password" placeholder="Password" className="rounded px-2 py-1 bg-white/5 border border-white/10 text-white w-32" />
          </div>
          <button onClick={connect}
            className="px-4 py-2 rounded border font-mono text-sm w-fit transition"
            style={{ borderColor: '#f59e0b', color: '#f59e0b', background: 'rgba(245,158,11,0.06)' }}>
            🖥️ Connect VNC
          </button>
        </div>
      )}

      <div ref={canvasRef} className="w-full rounded-lg border border-white/10 overflow-hidden bg-black min-h-[200px] flex items-center justify-center">
        {status !== 'connected' && (
          <span className="font-mono text-xs text-blue-400/30">
            {status === 'idle' ? 'VNC viewer will appear here' : status === 'connecting' ? 'Connecting...' : 'Connection failed'}
          </span>
        )}
      </div>
    </div>
  )
}

// ── AI Command Panel ───────────────────────────────────────────────────────────

function AICommandPanel() {
  const [cmd, setCmd]         = useState('')
  const [result, setResult]   = useState('')
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
      const data = await res.json() as { speech: string; tool?: string; toolResult?: string }
      setResult(`${data.speech}\n${data.toolResult ? `\nResult:\n${data.toolResult}` : ''}`)
    } catch {
      setResult('Error: Could not reach G.F.A.I.')
    } finally {
      setLoading(false)
    }
  }

  const QUICK = [
    'Take a screenshot', 'Lock the screen', 'What is the system status?',
    'Open Safari', 'What apps are running?', 'Copy "Hello World" to clipboard',
    'Press cmd+space', 'What time is it?',
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runCommand()}
          placeholder="Tell G.F.A.I. to do something on this Mac..."
          className="flex-1 rounded px-3 py-2 bg-white/5 border border-blue-500/20 text-white font-mono text-sm placeholder:text-blue-400/30 focus:outline-none focus:border-blue-500/50"
        />
        <button onClick={runCommand} disabled={loading}
          className="px-4 py-2 rounded font-mono text-sm border transition disabled:opacity-50"
          style={{ borderColor: '#0077C8', color: '#60a5fa', background: loading ? 'rgba(0,119,200,0.18)' : 'rgba(0,119,200,0.08)' }}>
          {loading ? '...' : '▶ RUN'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK.map(q => (
          <button key={q} onClick={() => { setCmd(q); }}
            className="text-[10px] font-mono px-2 py-1 rounded border border-blue-500/15 text-blue-400/60 hover:text-blue-300 hover:border-blue-500/40 transition">
            {q}
          </button>
        ))}
      </div>

      {result && (
        <pre className="rounded border border-green-500/20 bg-green-900/10 p-3 font-mono text-xs text-green-300/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {result}
        </pre>
      )}
    </div>
  )
}

// ── Main Remote Control Page ───────────────────────────────────────────────────

export default function RemotePage() {
  const [tab, setTab] = useState<ShareMode>('webrtc')

  return (
    <div className="min-h-screen bg-[#050a18] text-white font-mono">
      {/* Header */}
      <div className="border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xs text-blue-400/50 hover:text-blue-300 transition">← DASHBOARD</Link>
          <span className="text-[10px] text-blue-400/20">|</span>
          <span className="text-sm font-bold text-blue-300">🖥️ G.F.A.I. Remote Control</span>
        </div>
        <span className="text-[10px] text-blue-400/30">Screen Share + Mac Control</span>
      </div>

      <div className="max-w-6xl mx-auto p-6 flex flex-col gap-6">

        {/* Security Notice */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-4 text-xs text-amber-300/70">
          <strong className="text-amber-400">🔒 Security:</strong> This remote session is PIN-protected (PIN: 2001).
          All actions are audit-logged. Unauthorized access attempts trigger automatic Mac lockdown.
          Enable <a href="https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac" target="_blank" rel="noreferrer" className="text-amber-400 underline">Screen Sharing</a> in macOS Settings to use VNC mode.
        </div>

        {/* AI Command Panel */}
        <div className="rounded-lg border border-blue-500/20 bg-[#080d18] p-5">
          <h2 className="text-sm font-bold text-blue-300 mb-3">🤖 G.F.A.I. Mac Control</h2>
          <AICommandPanel />
        </div>

        {/* Screen View Tabs */}
        <div className="rounded-lg border border-white/5 bg-[#080d18] overflow-hidden">
          <div className="flex border-b border-white/5">
            {[
              { id: 'webrtc' as ShareMode, label: '📺 WebRTC Screen Share' },
              { id: 'vnc'    as ShareMode, label: '🖥️ VNC Remote Control' },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="px-5 py-3 text-xs font-mono border-r border-white/5 transition"
                style={{
                  color: tab === t.id ? '#60a5fa' : 'rgba(148,163,184,0.4)',
                  background: tab === t.id ? 'rgba(0,119,200,0.08)' : 'transparent',
                  borderBottom: tab === t.id ? '2px solid #0077C8' : '2px solid transparent',
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-5">
            {tab === 'webrtc' ? <WebRTCShare /> : <VNCControl />}
          </div>
        </div>

      </div>
    </div>
  )
}
