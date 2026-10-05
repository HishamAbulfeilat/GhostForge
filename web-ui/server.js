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
 *
 * Hosted ("friends") mode — GHOSTFORGE_MODE=hosted (see docs/HOSTING.md):
 *   - refuses to start without AUTH_SECRET (32+ chars) and ADMIN_PASSWORD (12+)
 *   - plain HTTP on HOST:PORT (TLS is the tunnel's / platform's job), no mkcert
 *   - no terminal WebSocket proxy, no OmniRoute / voice-pipeline autostart
 *   - blocked API routes answer 403 before Next sees them (lib/hosted-policy.json)
 *   - all state lives in GHOSTFORGE_DATA_DIR (default web-ui/.hosted-data), never
 *     in the real ~/.ghostforge of the machine it runs on
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

// Load .env* the same way Next does, so GHOSTFORGE_MODE set there is seen here too
const dev       = process.env.NODE_ENV !== 'production'
try { require('@next/env').loadEnvConfig(__dirname, dev) } catch { /* Next loads it later anyway */ }

const HOSTED    = (process.env.GHOSTFORGE_MODE || '').trim().toLowerCase() === 'hosted'
const hostedPolicy = HOSTED ? require('./lib/hosted-policy.json') : null
if (HOSTED) {
  const problems = []
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) problems.push('AUTH_SECRET must be at least 32 random characters (openssl rand -hex 32)')
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) problems.push('ADMIN_PASSWORD must be set (at least 12 characters)')
  if (problems.length) {
    console.error(`\n  ❌ Hosted mode will not start:\n     - ${problems.join('\n     - ')}\n`)
    process.exit(1)
  }
  // Keep every ~/.ghostforge file (users, keys, memory, jobs) away from the
  // real home directory of the machine this runs on.
  const dataDir = path.resolve(process.env.GHOSTFORGE_DATA_DIR || path.join(__dirname, '.hosted-data'))
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  process.env.HOME = dataDir
  process.env.USERPROFILE = dataDir
}

/** Hosted mode: is this request for an API route that is off? (mirrors lib/hosted.ts isBlockedApi) */
function isHostedBlocked(req) {
  if (!hostedPolicy) return false
  let pathname
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname } catch { return true }
  try { pathname = decodeURIComponent(pathname) } catch { return true }
  pathname = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
  const method = String(req.method || 'GET').toUpperCase()
  return hostedPolicy.blockedApi.some(r =>
    (pathname === r.prefix || pathname.startsWith(r.prefix + '/')) && (!r.methods || r.methods.includes(method)))
}

function handleRequest(req, res) {
  if (isHostedBlocked(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not available on the hosted version', hosted: true }))
    return
  }
  handle(req, res)
}

const PORT      = parseInt(process.env.PORT || '3001', 10)
const HTTP_PORT = Math.max(1, parseInt(process.env.HTTP_PORT || '0', 10) || (PORT - 1))
const PTY_PORT  = parseInt(process.env.PTY_PORT || '4748', 10)
const CERT_DIR  = path.join(__dirname, 'certs')
const CERT_FILE = path.join(CERT_DIR, 'cert.pem')
const KEY_FILE  = path.join(CERT_DIR, 'key.pem')

/**
 * Auto-start the OmniRoute local free-AI gateway (default port 20128).
 * JARVIS treats OmniRoute as a fallback provider; the AI SDK cannot talk to it
 * unless it is already listening, so spawn it on server boot if it is missing.
 */
const OMNI_PORT = 20128
const OMNI_URL  = process.env.OMNIROUTE_URL || `http://localhost:${OMNI_PORT}/v1`
function ensureOmniRouteRunning() {
  if (HOSTED) return // a local gateway with the owner's keys — never for hosted users
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
  if (HOSTED) return // local STT/TTS on the host — off when hosted
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
  // Tear down the paired socket when either side closes, so the upstream PTY
  // process is not orphaned when the browser tab/network drops.
  clientSocket.on('close', () => up.destroy())
  up.on('close', () => clientSocket.destroy())
}

// Constant-time token check that also requires a configured token (never
// fail open when the bridge token file is missing).
function tokenMatches(token, expected) {
  if (!expected || !token) return false
  const a = Buffer.from(String(token))
  const b = Buffer.from(String(expected))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
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
    const hasValidToken = tokenMatches(token, expected)
    if (HOSTED && !(dev && pathname.startsWith('/_next/'))) {
      // No terminal / PTY bridge on the hosted version
      socket.destroy()
    } else if (pathname === '/ws' && originMatchesRequest(req.headers.origin, host) && hasValidToken) {
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

  if (HOSTED) {
    // Plain HTTP: the platform or tunnel (Cloudflare, Tailscale, Codespaces…) terminates TLS
    const HOST = process.env.HOST || '0.0.0.0'
    const hostedServer = http.createServer(handleRequest)
    hostedServer.on('error', (err) => {
      console.error(err.code === 'EADDRINUSE' ? `\n  ❌ Port ${PORT} is already in use.` : `\n  ❌ HTTP server error: ${err.message}`)
      process.exit(1)
    })
    attachUpgradeHandler(hostedServer)
    hostedServer.listen(PORT, HOST, () => {
      console.log('\n  👻 GhostForge — hosted (friends) mode\n')
      console.log(`  ➜ Listening: http://${HOST}:${PORT}`)
      console.log(`  ➜ Data dir:  ${process.env.HOME}`)
      console.log('  ➜ Host features (terminal, files, desktop, bridge) are off; see docs/HOSTING.md\n')
    })
    return
  }

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

    const httpsServer = https.createServer(creds, handleRequest)

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
      console.log(`  ➜ Sign in with your GhostForge account (ADMIN_PASSWORD / ACCESS_PIN)\n`)
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
    const httpServer = http.createServer(handleRequest)

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
