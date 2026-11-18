'use strict'
// /api/execute → scripts/bridge-server.js round trip. The route used to send
// `bash '<script>' ...`, which the bridge refuses (it only runs
// `ghostforge <subcommand> ...`), so every Terminal command failed with 502
// whenever a bridge token existed. These tests drive a real bridge-server.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const WEB_UI = path.resolve(__dirname, '..')
const REPO = path.resolve(WEB_UI, '..')
const BRIDGE_SERVER = path.join(REPO, 'scripts', 'bridge-server.js')
const TOKEN = 'execute-roundtrip-token'

const work = fs.mkdtempSync(path.join(tmpdir(), 'gf-exec-'))
const fakeHome = path.join(work, 'home')
const bridgeRoot = path.join(work, 'bridge-root')
fs.mkdirSync(path.join(fakeHome, 'GhostForge', 'scripts'), { recursive: true })
fs.mkdirSync(bridgeRoot, { recursive: true })
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome

// Local copies of the scripts the route resolves (it checks they exist).
for (const name of ['health-score', 'dep-health', 'doctor']) {
  fs.writeFileSync(path.join(fakeHome, 'GhostForge', 'scripts', `${name}.sh`), `echo "local ${name}: $*"\n`)
}
// The bridge runs `bash <BRIDGE_ROOT>/ghostforge <subcommand> ...`.
fs.writeFileSync(path.join(bridgeRoot, 'ghostforge'), [
  'printf "bridge ran:"; for a in "$@"; do printf " [%s]" "$a"; done; echo',
  'if [ "$1" = "dep-health" ]; then echo "dependency audit failed" >&2; exit 3; fi',
  '',
].join('\n'))
fs.writeFileSync(path.join(work, 'token'), `${TOKEN}\n`)

class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
}
const state = { token: TOKEN, url: '' }
const stubs = {
  'next/server': { NextResponse },
  '@/lib/access': { requirePermission: async () => ({ username: 'owner', role: 'admin' }) },
  '@/lib/bridge-token': { getLiveBridgeToken: () => state.token, getBridgeUrl: () => state.url },
}
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})
const originalLoad = Module._load
function stubbedLoad(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request]
  if (request.startsWith('@/')) return originalLoad.call(this, path.join(WEB_UI, request.slice(2)) + '.ts', parent, isMain)
  return originalLoad.call(this, request, parent, isMain)
}
function loadRoute(rel) {
  const file = path.join(WEB_UI, rel)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  Module._load = stubbedLoad
  try { mod._compile(compiled, file) } finally { Module._load = originalLoad }
  return mod.exports
}
const route = loadRoute('app/api/execute/route.ts')

function execute(body, raw = false) {
  return route.POST({
    headers: new Map(),
    async json() { if (raw) throw new SyntaxError('Unexpected token'); return body },
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
  })
}

let bridge = null
test.before(async () => {
  const port = await freePort()
  bridge = spawn(process.execPath, [BRIDGE_SERVER], {
    env: {
      ...process.env,
      BRIDGE_TOKEN_FILE: path.join(work, 'token'),
      BRIDGE_ROOT: bridgeRoot,
      BRIDGE_PORT: String(port),
      BRIDGE_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  bridge.stderr.resume()
  state.url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${state.url}/health`)).ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('bridge did not start')
})

test.after(async () => {
  if (bridge) bridge.kill()
  hooks.deregister()
  await new Promise(r => setTimeout(r, 100))
  fs.rmSync(work, { recursive: true, force: true })
})

test('a ghostforge command runs on the bridge in the shape it accepts', async () => {
  const res = await execute({ command: 'ghostforge health-score --json src' })
  assert.equal(res.status, 200, JSON.stringify(res._body))
  assert.equal(res._body.output, 'bridge ran: [health-score] [--json] [src]')
  assert.equal(res._body.error, undefined)
})

test('arguments with quote characters reach the bridge unchanged', async () => {
  const res = await execute({ command: `ghostforge health-score it's "x"y` })
  assert.equal(res.status, 200, JSON.stringify(res._body))
  assert.equal(res._body.output, `bridge ran: [health-score] [it's] ["x"y]`)
  const both = await execute({ command: `ghostforge health-score a'b"c` })
  assert.equal(both.status, 400)
})

test('doctor goes through the bridge too', async () => {
  const res = await execute({ command: 'ghostforge doctor' })
  assert.equal(res.status, 200, JSON.stringify(res._body))
  assert.equal(res._body.output, 'bridge ran: [doctor]')
})

test('a script that fails on the bridge is a non-2xx with a string error', async () => {
  const res = await execute({ command: 'ghostforge dep-health' })
  assert.equal(res.status, 500)
  assert.equal(typeof res._body.error, 'string')
  assert.match(res._body.output, /bridge ran: \[dep-health\]/)
})

test('a wrong bridge token is reported as a bridge error, not a sign-in error', async () => {
  state.token = 'stale-token'
  try {
    const res = await execute({ command: 'ghostforge health-score' })
    assert.equal(res.status, 502)
    assert.match(res._body.error, /token/)
  } finally {
    state.token = TOKEN
  }
})

test('with a stale token file and no bridge listening, the script runs locally', async () => {
  const saved = state.url
  state.url = `http://127.0.0.1:${await freePort()}`
  try {
    const res = await execute({ command: 'ghostforge health-score --json' })
    assert.equal(res.status, 200, JSON.stringify(res._body))
    assert.equal(res._body.output, 'local health-score: --json')
  } finally {
    state.url = saved
  }
})

test('unknown commands and bad bodies are 400s', async () => {
  assert.equal((await execute({ command: 'rm -rf /' })).status, 400)
  assert.equal((await execute({ command: 'ghostforge nope' })).status, 400)
  assert.equal((await execute(null, true)).status, 400)
  assert.equal((await execute({ command: 42 })).status, 400)
})

test('the bridge itself still refuses anything that is not a ghostforge command', async () => {
  const res = await fetch(`${state.url}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ command: `bash '${path.join(fakeHome, 'GhostForge', 'scripts', 'health-score.sh')}'` }),
  })
  assert.equal(res.status, 403)
})
