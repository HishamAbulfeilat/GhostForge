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

const token = fs.readFileSync(process.env.BRIDGE_TOKEN_FILE, 'utf8').trim()
const ROOT = process.env.BRIDGE_ROOT
const READY_FILE = process.env.BRIDGE_READY_FILE
const PORT = Number(process.env.BRIDGE_PORT || 4747)
const HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_PROMPT_CHARS = 8000

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

function readJsonBody(req, res, onBody) {
  let body = ''
  let tooLarge = false
  req.on('data', chunk => {
    if (tooLarge) return
    body += chunk
    if (body.length > MAX_BODY_BYTES) {
      tooLarge = true
      respond(res, 413, { error: 'Request body too large' })
      req.destroy()
    }
  })
  req.on('end', () => {
    if (tooLarge) return
    let payload
    try {
      payload = JSON.parse(body || '{}')
    } catch {
      respond(res, 400, { error: 'Invalid JSON' })
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

function errorOutput(error) {
  if (error && error.stdout && error.stdout.length) return error.stdout.toString().trim()
  return error instanceof Error ? error.message : String(error)
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
        respond(res, 200, { output: errorOutput(error), error: true })
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
        respond(res, 200, { output: errorOutput(error), error: true })
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
