/**
 * GhostForge HTTPS Custom Server
 * Wraps Next.js with Node's https module using mkcert certs.
 * Falls back to HTTP if certs are missing.
 *
 * Usage: node server.js  (PORT env var controls port, default 3001)
 */
const https = require('https')
const http  = require('http')
const fs    = require('fs')
const path  = require('path')
const os    = require('os')
const next  = require('next')

const PORT     = parseInt(process.env.PORT || '3001', 10)
const CERT_DIR = path.join(__dirname, 'certs')
const dev      = process.env.NODE_ENV !== 'production'

function getLocalIP() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '0.0.0.0'
}

const app    = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const certFile = path.join(CERT_DIR, 'cert.pem')
  const keyFile  = path.join(CERT_DIR, 'key.pem')
  const hasSSL   = fs.existsSync(certFile) && fs.existsSync(keyFile)

  if (hasSSL) {
    // ── HTTPS ─────────────────────────────────────────────────────────────────
    const creds = {
      cert: fs.readFileSync(certFile),
      key:  fs.readFileSync(keyFile),
    }

    const httpsServer = https.createServer(creds, (req, res) => {
      handle(req, res)
    })

    httpsServer.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIP()
      console.log('\n  👻 GhostForge AI — HTTPS ready\n')
      console.log(`  ➜ Local:    https://localhost:${PORT}`)
      console.log(`  ➜ Network:  https://${ip}:${PORT}`)
      console.log(`  ➜ WSS:      wss://${ip}:4748  (terminal)`)
      console.log(`  ➜ PIN:      ****\n`)
    })

    // Redirect HTTP → HTTPS (port 3000 → 3001)
    const HTTP_REDIRECT_PORT = PORT - 1
    http.createServer((req, res) => {
      const host = (req.headers.host || '').replace(`:${HTTP_REDIRECT_PORT}`, `:${PORT}`)
      res.writeHead(301, { Location: `https://${host}${req.url}` })
      res.end()
    }).listen(HTTP_REDIRECT_PORT, '0.0.0.0', () => {
      console.log(`  ➜ HTTP ${HTTP_REDIRECT_PORT} → HTTPS ${PORT} redirect active\n`)
    })

  } else {
    // ── HTTP fallback ─────────────────────────────────────────────────────────
    const httpServer = http.createServer((req, res) => {
      handle(req, res)
    })
    httpServer.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIP()
      console.log('\n  👻 GhostForge AI — HTTP mode (no SSL certs found)\n')
      console.log(`  ➜ Local:    http://localhost:${PORT}`)
      console.log(`  ➜ Network:  http://${ip}:${PORT}`)
      console.log('  ⚠  Mic may not work on non-localhost URLs (browser HTTPS requirement)\n')
    })
  }
}).catch(err => {
  console.error('GhostForge server startup error:', err)
  process.exit(1)
})
