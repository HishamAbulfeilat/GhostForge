'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { shouldExecuteViaApi } from '@/lib/terminal-routing'

// GhostForge PTY WebSocket protocol (scripts/pty-server.js):
//   Server → client: raw terminal bytes (no prefix)
//   Client → server input: raw text
//   Client → server resize: JSON {"type":"resize","rows":N,"cols":N}
//   Auth: raw bridge token in the query string (?token=...)

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

function getPtyUrl(token: string, cols: number, rows: number) {
  // Connect through the web server (same origin) — server.js proxies /ws to
  // the local bridge. This keeps the terminal working over HTTPS (ws:// to a
  // separate port would be blocked as mixed content).
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.hostname
  const port = window.location.port || (proto === 'wss' ? '443' : '80')
  const params = new URLSearchParams({ token, cols: String(cols || 120), rows: String(rows || 40) })
  return `${proto}://${host}:${port}/ws?${params}`
}

function resizeMessage(cols: number, rows: number) {
  return JSON.stringify({ type: 'resize', cols, rows })
}

interface Props {
  sendCommandRef?: React.MutableRefObject<((cmd: string) => void) | null>
  reconnectRef?: React.MutableRefObject<(() => void) | null>
  activateRef?: React.MutableRefObject<(() => void) | null>
  onStatusChange?: (status: ConnStatus) => void
}

export default function XTermWrapper({ sendCommandRef, reconnectRef, activateRef, onStatusChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const isDisposedRef = useRef(false)

  // ── Store onStatusChange in a ref so connect() never changes when the
  //    parent re-renders with a new inline arrow function.
  //    This breaks the infinite-loop: status-change → re-render → new prop
  //    → connect dep changes → new WebSocket → status-change → ...
  const onStatusChangeRef = useRef(onStatusChange)
  useEffect(() => { onStatusChangeRef.current = onStatusChange }, [onStatusChange])

  const notifyStatus = useCallback((s: ConnStatus) => {
    onStatusChangeRef.current?.(s)
  }, []) // stable — reads from ref, no deps

  const connect = useCallback(async (term: Terminal, fit: FitAddon) => {
    if (isDisposedRef.current) return
    // Close existing connection
    wsRef.current?.close()
    wsRef.current = null

    notifyStatus('connecting')
    term.write('\r\n\x1b[33m[Connecting...]\x1b[0m\r\n')

    let bridgeToken = ''
    try {
      const res = await fetch('/api/pty-token')
      if (!res.ok) {
        notifyStatus('error')
        term.write('\r\n\x1b[31m[Auth failed — are you logged in?]\x1b[0m\r\n')
        return
      }
      const d = await res.json() as { token?: string; error?: string }
      bridgeToken = d.token ?? ''
      if (!bridgeToken) {
        notifyStatus('error')
        term.write('\r\n\x1b[31m[Bridge token missing — start the bridge first]\x1b[0m\r\n')
        term.write('\x1b[33m  bash ~/GhostForge/scripts/bridge.sh start\x1b[0m\r\n')
        return
      }
    } catch {
      notifyStatus('error')
      term.write('\r\n\x1b[31m[Cannot reach server]\x1b[0m\r\n')
      return
    }

    const ws = new WebSocket(getPtyUrl(bridgeToken, term.cols, term.rows))
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      if (isDisposedRef.current) { ws.close(); return }
      notifyStatus('connected')
      term.write('\x1b[32m[✓ Connected — GhostForge TUI ready]\x1b[0m\r\n')
      ws.send(resizeMessage(term.cols, term.rows))
      // Send initial size after brief delay to let the PTY settle
      const sizeTimer = setTimeout(() => {
        if (isDisposedRef.current) return
        fit.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(resizeMessage(term.cols, term.rows))
        }
      }, 200)
      // Store so cleanup can cancel if ws closes before timer fires
      ws.addEventListener('close', () => clearTimeout(sizeTimer), { once: true })
    }

    ws.onmessage = (e) => {
      if (isDisposedRef.current) return
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data))
      } else if (typeof e.data === 'string') {
        term.write(e.data)
      } else if (e.data instanceof Blob) {
        e.data.arrayBuffer().then(buf => {
          if (!isDisposedRef.current) term.write(new Uint8Array(buf))
        })
      }
    }

    ws.onerror = () => {
      if (wsRef.current === ws) wsRef.current = null
      notifyStatus('error')
      if (isDisposedRef.current) return
      term.write('\r\n\x1b[31m[✗ Connection failed — bridge may be offline]\x1b[0m\r\n')
      term.write('\x1b[33m  Start bridge: bash ~/GhostForge/scripts/bridge.sh start\x1b[0m\r\n')
      term.write('\x1b[90m  Then click Reconnect or press R\x1b[0m\r\n')
    }

    ws.onclose = (e) => {
      if (wsRef.current === ws) wsRef.current = null
      notifyStatus('disconnected')
      if (isDisposedRef.current) return
      if (e.code === 1008) {
        term.write('\r\n\x1b[31m[Auth rejected — bridge token mismatch]\x1b[0m\r\n')
      } else if (e.code === 1006) {
        term.write('\r\n\x1b[31m[Connection lost — click Reconnect or press R]\x1b[0m\r\n')
      } else {
        term.write('\r\n\x1b[33m[Session ended — click Reconnect or press R]\x1b[0m\r\n')
      }
    }
  }, [notifyStatus]) // notifyStatus is stable — dep array won't change

  const executeViaApi = useCallback((cmd: string, reason?: string) => {
    const term = termRef.current
    if (!term || isDisposedRef.current) return

    if (reason) term.write(`\r\n\x1b[33m[${reason}]\x1b[0m\r\n`)
    term.write('\r\n\x1b[36m$ ' + cmd + '\x1b[0m\r\n')
    void fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    })
      .then(r => r.json())
      .then((data: { output?: string; error?: string }) => {
        if (isDisposedRef.current) return
        const out = data.output || data.error || 'Done'
        term.write(out.replace(/\n/g, '\r\n') + '\r\n')
        term.write(data.error ? '\x1b[31m[Failed]\x1b[0m\r\n\n' : '\x1b[32m[Done]\x1b[0m\r\n\n')
      })
      .catch(() => {
        if (isDisposedRef.current) return
        term.write('\x1b[31m[Execution failed — server unreachable]\x1b[0m\r\n')
      })
  }, [])

  const sendToTerminal = useCallback((cmd: string) => {
    const ws = wsRef.current
    if (shouldExecuteViaApi(cmd)) {
      executeViaApi(cmd)
    } else if (ws?.readyState === WebSocket.OPEN) {
      ws.send(cmd + '\n')
    } else {
      executeViaApi(cmd, 'WebSocket offline — executing via API...')
    }
  }, [executeViaApi])

  const reconnect = useCallback(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (term && fit && !isDisposedRef.current) {
      term.write('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n')
      void connect(term, fit)
    }
  }, [connect])

  // Re-fit and focus — called when this tab becomes visible
  const activate = useCallback(() => {
    const fit = fitRef.current
    const term = termRef.current
    if (fit && term && !isDisposedRef.current) {
      fit.fit()
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(resizeMessage(term.cols, term.rows))
      }
      term.focus()
    }
  }, [])

  useEffect(() => {
    if (sendCommandRef) sendCommandRef.current = sendToTerminal
  }, [sendCommandRef, sendToTerminal])

  useEffect(() => {
    if (reconnectRef) reconnectRef.current = reconnect
  }, [reconnectRef, reconnect])

  useEffect(() => {
    if (activateRef) activateRef.current = activate
  }, [activateRef, activate])

  useEffect(() => {
    if (!containerRef.current) return

    isDisposedRef.current = false

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background: '#0a0a0f', foreground: '#cdd6f4', cursor: '#00ff88',
        cursorAccent: '#0a0a0f', selectionBackground: '#313244',
        black: '#181825', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
        blue: '#89b4fa', magenta: '#cba6f7', cyan: '#89dceb', white: '#cdd6f4',
        brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
        brightCyan: '#89dceb', brightWhite: '#ffffff',
      },
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    // Focus the terminal so keyboard input works immediately
    term.focus()

    void connect(term, fit)

    term.onData(data => {
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data)
      } else if (data.toLowerCase() === 'r') {
        void connect(term, fit)
      }
    })

    const onResize = () => {
      fit.fit()
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(resizeMessage(term.cols, term.rows))
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      isDisposedRef.current = true
      window.removeEventListener('resize', onResize)
      wsRef.current?.close()
      wsRef.current = null
      try { term.dispose() } catch { /* already disposed */ }
      termRef.current = null
      fitRef.current = null
    }
  }, [connect]) // connect is now stable — won't retrigger on parent re-render

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: '6px 4px' }}
      onClick={() => termRef.current?.focus()}
    />
  )
}
