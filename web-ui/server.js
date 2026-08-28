/**
 * GhostForge HTTPS Custom Server
 * Wraps Next.js with Node's https module using mkcert certs.
 * Certificates are auto-generated (and auto-regenerated when missing or
 * expired) via mkcert — the server only falls back to plain HTTP when
 * mkcert is not installed.
 *
 * Usage: node server.js
 *   PORT        — HTTPS port (default 3001)
 *   HTTP_PORT   — HTTP → HTTPS redirect port (default: PORT - 1)
 *   NODE_ENV    — "production" runs Next in production mode
 */
const https     = require('https')
const http      = require('http')
const fs        = require('fs')
const path      = require('path')
const os        = require('os')
const net       = require('net')
const crypto    = require('crypto')
const { spawnSync } = require('child_process')
const next      = require('next')

const PORT      = parseInt(process.env.PORT || '3001', 10)
const HTTP_PORT = Math.max(1, parseInt(process.env.HTTP_PORT || '0', 10) || (PORT - 1))
const PTY_PORT  = parseInt(process.env.PTY_PORT || '4748', 10)
const CERT_DIR  = path.join(__dirname, 'certs')
const CERT_FILE = path.join(CERT_DIR, 'cert.pem')
const KEY_FILE  = path.join(CERT_DIR, 'key.pem')
const dev       = process.env.NODE_ENV !== 'production'

/**
 * Auto-start the OmniRoute local free-AI gateway (default port 20128).
 * JARVIS treats OmniRoute as a fallback provider; the AI SDK cannot talk to it
 * unless it is already listening, so spawn it on server boot if it is missing.
 */
const OMNI_PORT = 20128
const OMNI_URL  = process.env.OMNIROUTE_URL || `http://localhost:${OMNI_PORT}/v1`
function ensureOmniRouteRunning() {
  if (process.env.GHOSTFORGE_AUTOSTART_OMNI !== '1' && process.env.NODE_ENV === 'production') {
    // In production require explicit opt-in to avoid arbitrary binary exec
    return
  }
  if (!process.env.GHOSTFORGE_AUTOSTART_OMNI && dev) {
    // Dev auto-start only if binary exists
    try { require('child_process').execSync('which omniroute', { stdio: 'ignore' }) } catch { return }
  }
  fetch(`${OMNI_URL.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(1500) })
    .then((res) => { if (!res.ok) startOmniRoute() })
    .catch(() => startOmniRoute())
}

function startOmniRoute() {
  const { spawn } = require('child_process')
  console.log('  ⚙  OmniRoute not running — starting local gateway…')
  const child = spawn('omniroute', ['serve', '--daemon'], { detached: true, stdio: 'ignore' })
  child.unref()
  // Wait for it to accept connections, then log readiness (does not block boot)
  setTimeout(async () => {
    try {
      const res = await fetch(`${OMNI_URL.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) console.log('  ✅ OmniRoute gateway up')
      else console.warn('  ⚠  OmniRoute gateway did not become ready')
    } catch {
      console.warn('  ⚠  OmniRoute gateway did not become ready — run manually: omniroute serve --daemon')
    }
  }, 4000)
}

ensureOmniRouteRunning()

/**
 * Auto-start the GhostForge Voice Pipeline (local STT / TTS / wake-word,
 * default port 8766). JARVIS uses it for offline voice; it is fully optional —
 * cloud / Web-Speech fallbacks cover the gap, but starting it here means local
 * TTS is available the moment the host server boots (mirrors OmniRoute above).
 */
const VOICE_PORT  = parseInt(process.env.VOICE_PORT || '8766', 10)
const VOICE_URL   = process.env.GHOSTFORGE_VOICE_URL || `http://localhost:${VOICE_PORT}`
function getBridgeToken() {
  const tokenFile = path.join(os.homedir(), '.ghostforge', 'bridge', 'token')
  try { return fs.readFileSync(tokenFile, 'utf8').trim() } catch { return '' }
}
function ensureVoiceServerRunning() {
  if (process.env.GHOSTFORGE_AUTOSTART_VOICE === '0') return
  const token = getBridgeToken()
  fetch(`${VOICE_URL}/api/voice/health`, {
    headers: token ? { 'X-Bridge-Token': token } : {},
    signal: AbortSignal.timeout(1500),
  })
    .then((res) => { if (!res.ok) startVoiceServer() })
    .catch(() => startVoiceServer())
}

function startVoiceServer() {
  const { spawn } = require('child_process')
  const script = path.join(__dirname, '..', 'voice-pipeline', 'start.sh')
  if (!fs.existsSync(script)) {
    console.warn('  ⚠  Voice pipeline start.sh missing — local STT/TTS disabled')
    return
  }
  console.log('  ⚙  Voice pipeline not running — starting local STT/TTS service…')
  const isWin = process.platform === 'win32'
  let child
  if (isWin) {
    const venvPython = path.join(__dirname, '..', 'voice-pipeline', '.venv', 'Scripts', 'python.exe')
    const python = fs.existsSync(venvPython) ? venvPython : 'python'
    child = spawn(python, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(VOICE_PORT)], {
      cwd: path.join(__dirname, '..', 'voice-pipeline'), detached: true, stdio: 'ignore', env: { ...process.env, NO_RELOAD: '1' },
    })
  } else {
    child = spawn('bash', [script], {
      cwd: path.join(__dirname, '..', 'voice-pipeline'), detached: true, stdio: 'ignore', env: { ...process.env, NO_RELOAD: '1' },
    })
  }
  child.unref()
  setTimeout(async () => {
    const token = getBridgeToken()
    try {
      const res = await fetch(`${VOICE_URL}/api/voice/health`, {
        headers: token ? { 'X-Bridge-Token': token } : {},
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) console.log('  ✅ Voice pipeline up (local STT/TTS ready)')
      else console.warn('  ⚠  Voice pipeline did not become ready')
    } catch {
      console.warn('  ⚠  Voice pipeline did not become ready — start manually: voice-pipeline/start.sh')
    }
  }, 6000)
}

ensureVoiceServerRunning()

/**
 * Pipe with backpressure: pause the source when the destination can't keep
 * up (write() returns false) and resume on the destination's 'drain' event.
 */
function pipeWithBackpressure(source, dest) {
  source.on('data', (chunk) => {
    const ok = dest.write(chunk)
    if (!ok) source.pause()
  })
  dest.on('drain', () => source.resume())
}

/**
 * Validate the WebSocket upgrade Origin header — it must be http(s) and
 * match the host:port the request was made to. Anything else is rejected.
 */
function originMatchesRequest(originHeader, hostHeader) {
  if (!originHeader) return false
  if (!hostHeader) return false
  let parsed
  try {
    parsed = new URL(originHeader)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const hostname = hostHeader.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
  if (parsed.hostname.toLowerCase() !== hostname) return false

  const hostPortMatch = hostHeader.match(/:(\d+)$/)
  const originPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  const hostPort = hostPortMatch ? hostPortMatch[1] : (parsed.protocol === 'https:' ? '443' : '80')
  return originPort === hostPort
}

/**
 * Proxy WebSocket upgrades (terminal /ws) to the local PTY bridge on PTY_PORT.
 * The bridge speaks plain ws:// — proxying through this server makes the
 * terminal work from HTTPS pages without mixed-content blocking.
 */
function proxyWsUpgrade(req, clientSocket, head) {
  const up = net.connect(PTY_PORT, '127.0.0.1', () => {
    let hdrs = `GET ${req.url} HTTP/1.1\r\n`
    hdrs += `Host: 127.0.0.1:${PTY_PORT}\r\n`
    const pass = [
      'upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version',
      'sec-websocket-extensions', 'sec-websocket-protocol',
    ]
    for (const [k, v] of Object.entries(req.headers)) {
      if (pass.includes(k.toLowerCase())) hdrs += `${k}: ${v}\r\n`
    }
    hdrs += '\r\n'
    up.write(hdrs)
    if (head && head.length) up.write(head)
    // Bidirectional proxy with backpressure instead of naive pipe().
    pipeWithBackpressure(up, clientSocket)
    pipeWithBackpressure(clientSocket, up)
  })
  up.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => up.destroy())
}

function attachUpgradeHandler(server) {
  server.on('upgrade', (req, socket, head) => {
    // Match the exact path `/ws` (ignore the query string — the bridge token
    // stays in ?token=...) and require a matching same-origin request.
    // Also validate bridge token present to avoid unauthenticated proxy.
    const pathname = (req.url || '').split('?')[0]
    const host = req.headers.host || ''
    const url = new URL(req.url || '/', `http://${host || 'localhost'}`)
    const token = url.searchParams.get('token') || req.headers['x-bridge-token'] || ''
    const expected = getBridgeToken()
    const hasValidToken = !expected || (token && token === expected)
    if (pathname === '/ws' && originMatchesRequest(req.headers.origin, host) && hasValidToken) {
      proxyWsUpgrade(req, socket, head)
    } else if (dev && pathname.startsWith('/_next/')) {
      // Next dev HMR / React refresh websockets — handled by the dev server.
      nextUpgradeHandler(req, socket, head)
    } else {
      socket.destroy()
    }
  })
}

function getLocalIP() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return null
}

function getCertHosts() {
  const hosts = ['localhost', '127.0.0.1', '::1']
  const ip = getLocalIP()
  if (ip) hosts.push(ip)
  return hosts
}

function hasCertFiles() {
  return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)
}

/** Returns true when the cert is missing, unreadable, or expires within 7 days. */
function certIsMissingOrExpired() {
  if (!hasCertFiles()) return true
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(CERT_FILE))
    const expires = new Date(cert.validTo)
    return Number.isNaN(expires.getTime()) || expires.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000
  } catch {
    return true
  }
}

/** Generates (or refreshes) mkcert certificates for localhost + LAN IP. */
function generateCerts() {
  const mkcert = spawnSync('mkcert', ['-version'])
  if (mkcert.error || mkcert.status !== 0) {
    return { ok: false, reason: 'mkcert is not installed (run: brew install mkcert nss)' }
  }

  const install = spawnSync('mkcert', ['-install'])
  if (install.error || install.status !== 0) {
    return { ok: false, reason: 'mkcert -install failed — run it manually: sudo mkcert -install' }
  }

  try {
    fs.mkdirSync(CERT_DIR, { recursive: true })
  } catch {
    return { ok: false, reason: `cannot create cert directory: ${CERT_DIR}` }
  }

  const gen = spawnSync('mkcert', [
    '-key-file', KEY_FILE,
    '-cert-file', CERT_FILE,
    ...getCertHosts(),
  ], { stdio: 'pipe' })

  if (gen.error || gen.status !== 0) {
    const detail = (gen.stderr || gen.stdout || '').toString().trim()
    return { ok: false, reason: `mkcert failed: ${detail || 'unknown error'}` }
  }

  return { ok: true }
}

const app    = next({ dev })
const handle = app.getRequestHandler()
let nextUpgradeHandler = null

app.prepare().then(() => {
  nextUpgradeHandler = dev && typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null
  const needsCerts = certIsMissingOrExpired()
  let certResult = { ok: false, reason: 'certs are missing' }

  if (needsCerts) {
    console.log(needsCerts && hasCertFiles()
      ? '  ⚠  SSL certificates missing or expired — regenerating…'
      : '  🔐 No SSL certificates found — generating with mkcert…')
    certResult = generateCerts()
  } else {
    certResult = { ok: true }
  }

  if (certResult.ok) {
    // ── HTTPS ─────────────────────────────────────────────────────────────────
    const creds = {
      cert: fs.readFileSync(CERT_FILE),
      key:  fs.readFileSync(KEY_FILE),
    }

    const httpsServer = https.createServer(creds, (req, res) => {
      handle(req, res)
    })

    httpsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  ❌ Port ${PORT} is already in use (HTTPS).`)
      } else {
        console.error('\n  ❌ HTTPS server error:', err)
      }
      process.exit(1)
    })

    attachUpgradeHandler(httpsServer)

    httpsServer.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIP()
      console.log('\n  👻 GhostForge AI — HTTPS ready\n')
      console.log(`  ➜ Local:    https://localhost:${PORT}`)
      console.log(`  ➜ Network:  https://${ip || '0.0.0.0'}:${PORT}`)
      console.log(`  ➜ Terminal: wss://${ip || '0.0.0.0'}:${PORT}/ws  (proxied → bridge:${PTY_PORT})`)
      console.log(`  ➜ PIN:      ****\n`)
    })

    // Redirect HTTP → HTTPS (default: port 3000 → 3001).
    // Uses 308 so POST bodies (e.g. login) survive the redirect.
    if (HTTP_PORT !== PORT) {
      http.createServer((req, res) => {
        const host = (req.headers.host || '').replace(`:${HTTP_PORT}`, `:${PORT}`)
        res.writeHead(308, {
          Location: `https://${host}${req.url}`,
          'Connection': 'close',
        })
        res.end()
      }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`  ⚠  Port ${HTTP_PORT} busy — HTTP → HTTPS redirect disabled (HTTPS still active on ${PORT})`)
        } else {
          console.warn('  ⚠  Redirect server error:', err.message)
        }
      }).listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`  ➜ HTTP ${HTTP_PORT} → HTTPS ${PORT} redirect active\n`)
      })
    }
  } else {
    // ── HTTP fallback (only when HTTPS is impossible) ─────────────────────────
    const httpServer = http.createServer((req, res) => {
      handle(req, res)
    })

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  ❌ Port ${PORT} is already in use.`)
      } else {
        console.error('\n  ❌ HTTP server error:', err)
      }
      process.exit(1)
    })

    attachUpgradeHandler(httpServer)

    httpServer.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIP()
      console.log('\n  👻 GhostForge AI — HTTP mode (no HTTPS available)\n')
      console.log(`  ➜ Local:    http://localhost:${PORT}`)
      console.log(`  ➜ Network:  http://${ip || '0.0.0.0'}:${PORT}`)
      console.log(`  ⚠  ${certResult.reason}`)
      console.log('  ⚠  Mic may not work on non-localhost URLs (browser HTTPS requirement).')
      console.log('  💡  Fix:  bash scripts/setup-https.sh  or  brew install mkcert nss\n')
    })
  }
}).catch(err => {
  console.error('GhostForge server startup error:', err)
  process.exit(1)
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
