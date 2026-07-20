'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

// ttyd binary WebSocket protocol:
//   Server → client: raw terminal bytes (no prefix)
//   Client → server input: 0x00 byte + data
//   Client → server resize: 0x01 byte + JSON {"rows":N,"cols":N}

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

function getTtydUrl(token: string) {
  const host = window.location.hostname
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const b64 = btoa(`ghostforge:${token}`)
  return `${proto}://${host}:4748/ws?token=${encodeURIComponent(b64)}`
}

interface Props {
  sendCommandRef?: React.MutableRefObject<((cmd: string) => void) | null>
  reconnectRef?: React.MutableRefObject<(() => void) | null>
  onStatusChange?: (status: ConnStatus) => void
}

export default function XTermWrapper({ sendCommandRef, reconnectRef, onStatusChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

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

    const ws = new WebSocket(getTtydUrl(bridgeToken))
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      notifyStatus('connected')
      term.write('\x1b[32m[✓ Connected — GhostForge TUI ready]\x1b[0m\r\n')
      ws.send('\x01' + JSON.stringify({ rows: term.rows, cols: term.cols }))
      // Send initial size after brief delay to let ttyd settle
      setTimeout(() => {
        fit.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('\x01' + JSON.stringify({ rows: term.rows, cols: term.cols }))
        }
      }, 200)
    }

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data))
      } else if (typeof e.data === 'string') {
        term.write(e.data)
      } else if (e.data instanceof Blob) {
        e.data.arrayBuffer().then(buf => term.write(new Uint8Array(buf)))
      }
    }

    ws.onerror = () => {
      notifyStatus('error')
      term.write('\r\n\x1b[31m[✗ Connection failed — bridge may be offline]\x1b[0m\r\n')
      term.write('\x1b[33m  Start bridge: bash ~/GhostForge/scripts/bridge.sh start\x1b[0m\r\n')
      term.write('\x1b[90m  Then click Reconnect or press R\x1b[0m\r\n')
    }

    ws.onclose = (e) => {
      notifyStatus('disconnected')
      if (e.code === 1008) {
        term.write('\r\n\x1b[31m[Auth rejected — bridge token mismatch]\x1b[0m\r\n')
      } else if (e.code === 1006) {
        term.write('\r\n\x1b[31m[Connection lost — click Reconnect or press R]\x1b[0m\r\n')
      } else {
        term.write('\r\n\x1b[33m[Session ended — click Reconnect or press R]\x1b[0m\r\n')
      }
    }
  }, [notifyStatus]) // notifyStatus is stable — dep array won't change

  const sendToTerminal = useCallback((cmd: string) => {
    const ws = wsRef.current
    const term = termRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send('\x00' + cmd + '\n')
    } else if (term) {
      term.write('\r\n\x1b[33m[Not connected — start bridge then click Reconnect]\x1b[0m\r\n')
    }
  }, [])

  const reconnect = useCallback(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (term && fit) {
      term.write('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n')
      void connect(term, fit)
    }
  }, [connect])

  useEffect(() => {
    if (sendCommandRef) sendCommandRef.current = sendToTerminal
  }, [sendCommandRef, sendToTerminal])

  useEffect(() => {
    if (reconnectRef) reconnectRef.current = reconnect
  }, [reconnectRef, reconnect])

  useEffect(() => {
    if (!containerRef.current) return

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

    void connect(term, fit)

    term.onData(data => {
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send('\x00' + data)
      } else if (data.toLowerCase() === 'r') {
        void connect(term, fit)
      }
    })

    const onResize = () => {
      fit.fit()
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send('\x01' + JSON.stringify({ rows: term.rows, cols: term.cols }))
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      wsRef.current?.close()
      term.dispose()
    }
  }, [connect]) // connect is now stable — won't retrigger on parent re-render

  return <div ref={containerRef} className="h-full w-full" style={{ padding: '6px 4px' }} />
}
