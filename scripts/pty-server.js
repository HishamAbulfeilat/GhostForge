#!/usr/bin/env node
/**
 * GhostForge PTY WebSocket Server
 * Spawns the GhostForge TUI in a real terminal via WebSocket
 * Port: 4748 | Auth: Bearer token from ~/.ghostforge/bridge/token
 */
const WebSocket = require('ws')
const pty = require('node-pty')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')

const PORT = Number(process.env.PTY_PORT || 4748)
const TOKEN_FILE = process.env.BRIDGE_TOKEN_FILE || path.join(os.homedir(), '.ghostforge/bridge/token')
const ROOT = process.env.BRIDGE_ROOT || path.join(os.homedir(), 'GhostForge')
const TUI_ENTRY = path.join(ROOT, 'tui/index.js')

function getToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() } catch { return null }
}

// HTTP server for health check
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'online', name: 'GhostForge PTY Server' }))
  } else {
    res.writeHead(404)
    res.end()
  }
})

const wss = new WebSocket.Server({ server: httpServer })

wss.on('connection', (ws, req) => {
  // Auth via query param or header
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const qToken = url.searchParams.get('token')
  const hToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const token = getToken()

  if (!token || (qToken !== token && hToken !== token)) {
    ws.send('\r\n\x1b[31m❌ Unauthorized — invalid token\x1b[0m\r\n')
    ws.close(1008, 'Unauthorized')
    return
  }

  // Parse terminal size from query
  const cols = parseInt(url.searchParams.get('cols') || '120', 10)
  const rows = parseInt(url.searchParams.get('rows') || '40', 10)

  console.log(`[PTY] New session cols=${cols} rows=${rows}`)

  // Spawn TUI using absolute node path to avoid PATH issues
  const nodeBin = process.execPath  // absolute path to current node binary
  let shell
  try {
    shell = pty.spawn(nodeBin, [TUI_ENTRY], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: ROOT,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        HOME: os.homedir(),
        PATH: (process.env.PATH || '') + ':/usr/local/bin:/opt/homebrew/bin',
        FORCE_COLOR: '3',
      },
    })
  } catch (spawnErr) {
    const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
    ws.send(`\r\n\x1b[31m[✗ Failed to start TUI: ${msg}]\x1b[0m\r\n`)
    ws.close()
    return
  }

  // PTY → WebSocket
  shell.onData(data => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  })

  shell.onExit(({ exitCode }) => {
    console.log(`[PTY] Session exited (code ${exitCode})`)
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[33m[Session ended — close tab or refresh to restart]\x1b[0m\r\n`)
      ws.close()
    }
  })

  // WebSocket → PTY
  ws.on('message', msg => {
    try {
      const data = msg.toString()
      try {
        // Check for resize message: JSON { type:'resize', cols, rows }
        const parsed = JSON.parse(data)
        if (parsed.type === 'resize') {
          // Validate dimensions before resizing the PTY
          if (
            Number.isInteger(parsed.cols) && parsed.cols > 0 &&
            Number.isInteger(parsed.rows) && parsed.rows > 0
          ) {
            shell.resize(parsed.cols, parsed.rows)
          } else {
            console.warn('[PTY] Ignored invalid resize:', data)
          }
          return
        }
      } catch { /* not JSON — normal input */ }
      shell.write(data)
    } catch (err) {
      console.error('[PTY] Message handler error:', err instanceof Error ? err.message : err)
    }
  })

  ws.on('close', () => {
    console.log('[PTY] WebSocket closed — killing PTY')
    try { shell.kill() } catch {}
  })

  ws.on('error', err => {
    console.error('[PTY] WS error:', err.message)
    try { shell.kill() } catch {}
  })
})

// Bind to loopback only — the web UI WS proxy (web-ui/server.js on 3001)
// connects from the same machine, so no external interface is needed.
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[PTY] GhostForge PTY server listening on 127.0.0.1:${PORT}`)
})
