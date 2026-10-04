#!/usr/bin/env node
/**
 * GhostForge bridge server — shared by scripts/bridge.sh (macOS/Linux)
 * and scripts/bridge.cmd (Windows).
 *
 * Environment:
 *   BRIDGE_TOKEN_FILE  path to the auth token file (required)
 *   BRIDGE_ROOT        GhostForge repo root (required)
 *   BRIDGE_READY_FILE  written once the server is listening
 *   BRIDGE_PORT        port to listen on (default 4747)
 *   BRIDGE_HOST        interface to bind (default 127.0.0.1; set 0.0.0.0 to
 *                      expose on the LAN — tunnels work fine with the default)
 *
 * Commands never go through a shell: they are tokenized here and run with
 * execFile, so quoting tricks and shell metacharacters have no effect.
 */
'use strict'

const http = require('http')
const crypto = require('crypto')
const path = require('path')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')

/**
 * Read BRIDGE_TOKEN_FILE without leaking the stack trace of a missing or
 * unreadable file: `readFileSync` would otherwise throw at module load and
 * dump a stack (including the token path) into the bridge log on every start.
 */
function readTokenFile(file) {
  if (!file) {
    console.error('[bridge] BRIDGE_TOKEN_FILE is not set — start the bridge with scripts/bridge.sh or bridge.cmd')
    process.exit(1)
  }
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch (error) {
    console.error(`[bridge] cannot read the token file (${error.code || 'unknown error'})`)
    process.exit(1)
  }
}

const token = readTokenFile(process.env.BRIDGE_TOKEN_FILE)
const ROOT = process.env.BRIDGE_ROOT
if (!ROOT) {
  console.error('[bridge] BRIDGE_ROOT is not set — start the bridge with scripts/bridge.sh or bridge.cmd')
  process.exit(1)
}
const READY_FILE = process.env.BRIDGE_READY_FILE
const PORT = Number(process.env.BRIDGE_PORT || 4747)
const HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const MAX_BODY_BYTES = 1024 * 1024
// After refusing an over-cap body we still read and discard the rest, so the
// 413 reaches the client instead of turning into an RST (see readJsonBody).
// Bound that discard, or a peer that never stops sending keeps this process
// reading forever.
const MAX_DRAIN_BYTES = MAX_BODY_BYTES * 2
const MAX_PROMPT_CHARS = 8000
const MAX_OUTPUT_CHARS = 20000

const EXTRA_PATHS = process.platform === 'win32' ? [] : ['/usr/local/bin', '/opt/homebrew/bin']
const CHILD_PATH = [process.env.PATH || '', ...EXTRA_PATHS].filter(Boolean).join(path.delimiter)

function respond(res, status, payload) {
  res.writeHead(status)
  res.end(JSON.stringify(payload))
}

function isAuthorized(req) {
  const expected = Buffer.from(`Bearer ${token}`)
  const given = Buffer.from(String(req.headers.authorization || ''))
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/** Split a command line into args, honoring "double" and 'single' quotes. */
function tokenize(command) {
  const args = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(command)) !== null) args.push(m[1] ?? m[2] ?? m[3])
  return args
}

/**
 * Buffer the request body, then hand the parsed object to `onBody`.
 *
 * The cap is on BYTES. `body.length` counts UTF-16 code units, not bytes, so a
 * character cap lets a body carry up to 3x MAX_BODY_BYTES of real bytes past
 * the limit: any BMP character from U+0800 up — Arabic, Devanagari, CJK — is
 * 3 bytes but one unit. (Astral characters are surrogate pairs, so an emoji is
 * 4 bytes per 2 units.) `+=` grew that string before checking it, so the
 * overshoot was retained too, and per-chunk decoding turned a character
 * straddling a chunk boundary into U+FFFD on both sides. Chunks are kept as
 * buffers instead, sized on `buf.length` before any of them is retained, and
 * decoded once at the end.
 */
function readJsonBody(req, res, onBody) {
  const chunks = []
  let bytes = 0
  let discarded = 0
  let tooLarge = false
  req.on('data', chunk => {
    // Chunks are buffers unless an encoding was set on the stream, in which
    // case `chunk.length` would count characters again and reopen the hole.
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (tooLarge) {
      // Already refused. Keep reading so the response can flush, but only for
      // a bounded while: past that the peer is not going to stop, and an
      // unbounded drain is just as slow a denial as an unbounded buffer.
      discarded += buf.length
      if (discarded > MAX_DRAIN_BYTES) {
        chunks.length = 0
        req.destroy()
      }
      return
    }
    bytes += buf.length
    if (bytes > MAX_BODY_BYTES) {
      tooLarge = true
      chunks.length = 0 // release what we already held, we are refusing it
      respond(res, 413, { error: 'Request body too large' })
      // Keep draining instead of destroying the socket here. The client is
      // still streaming the body we just refused, so `destroy()` closes it with
      // that data unread and the kernel answers with RST — which discards the
      // 413 we just wrote and surfaces to the caller as ECONNRESET, i.e.
      // "connection died". Draining lets the response flush and leaves the
      // connection reusable.
      return
    }
    chunks.push(buf)
  })
  req.on('end', () => {
    if (tooLarge) return
    const body = Buffer.concat(chunks).toString('utf8')
    let payload
    try {
      payload = JSON.parse(body || '{}')
    } catch {
      respond(res, 400, { error: 'Invalid JSON' })
      return
    }
    // `null`, an array or a bare scalar all parse fine but are not the object
    // the handlers below read properties off. Reading `payload.prompt` on a
    // null body throws a TypeError inside this 'end' handler, which is
    // uncaught: it takes the whole bridge process down and every later
    // request gets connection-refused until the launcher restarts it.
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      respond(res, 400, { error: 'JSON body must be an object' })
      return
    }
    onBody(payload)
  })
}

function runCopilot(prompt) {
  return execFileSync('gh', ['copilot', '-p', prompt, '--allow-all', '--allow-all-paths', '--add-dir', ROOT, '-s'], {
    cwd: ROOT,
    timeout: 60000,
    input: 'exit\n',
    env: Object.assign({}, process.env, {
      PATH: CHILD_PATH,
      HOME: process.env.HOME || os.homedir(),
      GH_NO_UPDATE_NOTIFIER: '1',
      NO_COLOR: '1',
    }),
  }).toString().trim()
}

function runGhostforge(args) {
  return execFileSync('bash', [path.join(ROOT, 'ghostforge'), ...args], {
    cwd: ROOT,
    timeout: 30000,
    env: { ...process.env, PATH: CHILD_PATH },
  }).toString().trim()
}

/**
 * Describe a failed child process for the server log only.
 *
 * execFileSync errors carry the full command line, the cwd, the PATH and a
 * stack trace — useful here, but never sent to a caller. Callers get
 * `clientErrorOutput()` instead: the child's own stdout/stderr (which the
 * script itself chose to print) and, failing that, a generic message.
 */
function logError(context, error) {
  if (!error) return
  const detail = error.stack || error.message || String(error)
  console.error(`[bridge] ${context}: ${detail}`)
}

/** Client-safe output for a failed command: child output, or a generic line. */
function clientErrorOutput(error) {
  const out = error && error.stdout && error.stdout.length ? error.stdout.toString().trim() : ''
  const err = error && error.stderr && error.stderr.length ? error.stderr.toString().trim() : ''
  const text = out || err
  if (!text) return 'Command failed. Check the bridge log on the host machine.'
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated` : text
}

const server = http.createServer((req, res) => {
  // No CORS headers: only server-side callers (web-ui API routes, tunnels)
  // talk to the bridge, so browsers on other origins are refused.
  res.setHeader('Content-Type', 'application/json')

  if (req.url === '/health' && req.method === 'GET') {
    respond(res, 200, { status: 'online', name: 'GhostForge Bridge' })
    return
  }

  if (req.url === '/copilot' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      respond(res, 401, { error: 'Unauthorized' })
      return
    }
    readJsonBody(req, res, payload => {
      const prompt = String(payload.prompt || '').trim()
      const mode = String(payload.mode || 'suggest').trim()
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
        respond(res, 400, { error: 'Invalid prompt' })
        return
      }
      try {
        respond(res, 200, { output: runCopilot(prompt), mode, prompt })
      } catch (error) {
        logError('copilot failed', error)
        respond(res, 200, { output: clientErrorOutput(error), error: true })
      }
    })
    return
  }

  if (req.url === '/execute' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      respond(res, 401, { error: 'Unauthorized' })
      return
    }
    readJsonBody(req, res, payload => {
      const command = typeof payload.command === 'string' ? payload.command.trim() : ''
      const args = tokenize(command)
      try {
        if (args[0] === 'ghostforge' && args.length > 1) {
          respond(res, 200, { output: runGhostforge(args.slice(1)), command })
        } else if (args[0] === 'gh' && args[1] === 'copilot' && args[2] === '-p' && args.length === 4) {
          respond(res, 200, { output: runCopilot(args[3]), command })
        } else {
          respond(res, 403, { error: 'Only ghostforge commands are allowed' })
        }
      } catch (error) {
        logError('execute failed', error)
        respond(res, 200, { output: clientErrorOutput(error), error: true })
      }
    })
    return
  }

  respond(res, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  if (READY_FILE) fs.writeFileSync(READY_FILE, '1')
  console.log(`GhostForge bridge listening on ${HOST}:${PORT}`)
})
