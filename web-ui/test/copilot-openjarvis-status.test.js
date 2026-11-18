'use strict'
// /api/copilot and /api/openjarvis must report failures as non-2xx with an
// `error`, not as HTTP 200 with failure text in the normal answer field.
// Copilot is round-tripped through a real scripts/bridge-server.js with a fake
// `gh` first on PATH; OpenJarvis talks to a small fake mark-l bridge.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const Module = require('node:module')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const WEB_UI = path.resolve(__dirname, '..')
const REPO = path.resolve(WEB_UI, '..')
const TOKEN = 'copilot-status-token'

const work = fs.mkdtempSync(path.join(tmpdir(), 'gf-copilot-'))
process.env.HOME = work
process.env.USERPROFILE = work
const fakeBin = path.join(work, 'bin')
fs.mkdirSync(fakeBin)
// Fake `gh copilot -p <prompt> ...`: echoes the prompt, fails when it says FAIL.
fs.writeFileSync(path.join(fakeBin, 'gh'), [
  '#!/usr/bin/env bash',
  'prompt="$3"',
  'case "$prompt" in *FAIL*) echo "copilot exploded" >&2; exit 2;; esac',
  'printf "%s" "$prompt"',
  '',
].join('\n'), { mode: 0o755 })
fs.writeFileSync(path.join(work, 'token'), `${TOKEN}\n`)

class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
}
const state = { token: TOKEN, url: '', bridgeUp: true, mark: null }
const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': { isAuthorizedRequest: () => true },
  '@/lib/bridge-token': { getLiveBridgeToken: () => state.token, getBridgeUrl: () => state.url },
  './mark-liv-bridge': { ensureMarkLivBridge: async () => state.bridgeUp },
}
const originalLoad = Module._load
const compiledCache = new Map()
function compile(file) {
  if (compiledCache.has(file)) return compiledCache.get(file).exports
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  compiledCache.set(file, mod)
  mod._compile(out, file)
  return mod.exports
}
function stubbedLoad(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request]
  if (request.startsWith('@/')) return compile(path.join(WEB_UI, request.slice(2)) + '.ts')
  return originalLoad.call(this, request, parent, isMain)
}
function load(rel) {
  Module._load = stubbedLoad
  try { return compile(path.join(WEB_UI, rel)) } finally { Module._load = originalLoad }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
  })
}

let bridge = null
let markServer = null
let copilot = null
let openjarvis = null

test.before(async () => {
  const port = await freePort()
  bridge = spawn(process.execPath, [path.join(REPO, 'scripts', 'bridge-server.js')], {
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      BRIDGE_TOKEN_FILE: path.join(work, 'token'),
      BRIDGE_ROOT: work,
      BRIDGE_PORT: String(port),
      BRIDGE_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  bridge.stderr.resume()
  state.url = `http://127.0.0.1:${port}`
  let up = false
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${state.url}/health`)).ok } catch { await new Promise(r => setTimeout(r, 50)) }
  }
  assert.ok(up, 'bridge did not start')

  // Fake mark-l bridge for OpenJarvis: behaviour picked per test via state.mark.
  markServer = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const mode = state.mark
      if (mode === 'missing') { res.writeHead(503); res.end('{}'); return }
      if (mode === 'boom') { res.writeHead(500); res.end('{}'); return }
      const { prompt } = JSON.parse(body || '{}')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { response: `jarvis says: ${prompt}` } }))
    })
  })
  await new Promise(r => markServer.listen(0, '127.0.0.1', r))
  process.env.MARKL_BRIDGE_URL = `http://127.0.0.1:${markServer.address().port}`
  process.env.MARKL_BRIDGE_TOKEN = 'mark-token'

  copilot = load('app/api/copilot/route.ts')
  openjarvis = load('app/api/openjarvis/route.ts')
})

test.after(async () => {
  if (bridge) bridge.kill()
  if (markServer) markServer.close()
  await new Promise(r => setTimeout(r, 100))
  fs.rmSync(work, { recursive: true, force: true })
})

const req = body => ({ headers: new Map(), async json() { return body } })

// ── /api/copilot ─────────────────────────────────────────────────────────────

test('copilot success returns the output and applies the mode', async () => {
  const res = await copilot.POST(req({ prompt: 'list files', mode: 'explain' }))
  assert.equal(res.status, 200, JSON.stringify(res._body))
  assert.match(res._body.output, /^Explain the following/)
  assert.match(res._body.output, /list files$/)
  const suggest = await copilot.POST(req({ prompt: 'list files' }))
  assert.match(suggest._body.output, /^Suggest the shell command/)
})

test('a failed copilot run is a 502, not normal output', async () => {
  const res = await copilot.POST(req({ prompt: 'please FAIL', mode: 'suggest' }))
  assert.equal(res.status, 502)
  assert.equal(res._body.error, 'Copilot run failed')
  assert.match(res._body.output, /copilot exploded/)
})

test('a stale bridge token is a 502 with an error, not 200 { output: undefined }', async () => {
  state.token = 'stale'
  try {
    const res = await copilot.POST(req({ prompt: 'hi' }))
    assert.equal(res.status, 502)
    assert.match(res._body.error, /token/)
  } finally {
    state.token = TOKEN
  }
})

test('no bridge token or an unreachable bridge is a 503', async () => {
  state.token = ''
  try {
    const res = await copilot.POST(req({ prompt: 'hi' }))
    assert.equal(res.status, 503)
    assert.equal(res._body.connected, false)
  } finally {
    state.token = TOKEN
  }
  const saved = state.url
  state.url = `http://127.0.0.1:${await freePort()}`
  try {
    const res = await copilot.POST(req({ prompt: 'hi' }))
    assert.equal(res.status, 503)
  } finally {
    state.url = saved
  }
})

test('copilot rejects unknown modes', async () => {
  assert.equal((await copilot.POST(req({ prompt: 'hi', mode: 'yolo' }))).status, 400)
})

// ── /api/openjarvis ──────────────────────────────────────────────────────────

test('openjarvis success returns the reply', async () => {
  state.mark = null
  const res = await openjarvis.POST(req({ prompt: 'hello' }))
  assert.equal(res.status, 200)
  assert.equal(res._body.response, 'jarvis says: hello')
})

test('openjarvis not installed / failed / bridge down are non-2xx errors', async () => {
  state.mark = 'missing'
  let res = await openjarvis.POST(req({ prompt: 'hello' }))
  assert.equal(res.status, 503)
  assert.match(res._body.error, /not installed/)
  assert.equal(res._body.response, undefined)

  state.mark = 'boom'
  res = await openjarvis.POST(req({ prompt: 'hello' }))
  assert.equal(res.status, 502)

  state.mark = null
  state.bridgeUp = false
  try {
    res = await openjarvis.POST(req({ prompt: 'hello' }))
    assert.equal(res.status, 503)
  } finally {
    state.bridgeUp = true
  }
})

test('a non-numeric timeoutS is a 400, not an unhandled 500', async () => {
  const res = await openjarvis.POST(req({ prompt: 'hello', timeoutS: 'soon' }))
  assert.equal(res.status, 400)
  const ok = await openjarvis.POST(req({ prompt: 'hello', timeoutS: 5 }))
  assert.equal(ok.status, 200)
})
