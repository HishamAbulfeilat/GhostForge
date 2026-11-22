'use strict'
// Host-level actions need a real permission, not just any valid session
// (review finding #12): bridge start/stop and the webhook config need
// admin_tools, ollama pulls need ai_models and a catalog model (admins may pull
// a custom one), voice enrollment is admin-only, and an ollama that can't be
// started is reported as a failure instead of "pulling" / "installing".
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const fakeHome = fs.mkdtempSync(path.join(tmpdir(), 'gf-host-actions-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

const WEB_UI = path.resolve(__dirname, '..')
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
  async json() { return this._body }
}

const PEOPLE = {
  guest: { username: 'guest', role: 'user', permissions: ['chat'] },
  modeler: { username: 'modeler', role: 'user', permissions: ['chat', 'ai_models'] },
  ops: { username: 'ops', role: 'user', permissions: ['chat', 'admin_tools'] },
  admin: { username: 'admin', role: 'admin', permissions: ['*'] },
}
const who = req => PEOPLE[req.headers.get('x-test-user')] || null

// child_process: record every launch; `spawnMode` decides whether it starts.
const launches = []
let spawnMode = 'enoent'
const childProcess = {
  spawn(command, args) {
    launches.push([command, ...args])
    const child = new EventEmitter()
    child.unref = () => {}
    process.nextTick(() => {
      if (spawnMode === 'enoent') child.emit('error', Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }))
      else child.emit('spawn')
    })
    return child
  },
  spawnSync(command, args) { launches.push([command, ...args]); return { status: 0 } },
  exec(_cmd, _opts, cb) { (typeof _opts === 'function' ? _opts : cb)(new Error('not installed')) },
}

const stubs = {
  'next/server': { NextResponse, NextRequest: class {} },
  child_process: childProcess,
  '@/lib/auth': {
    // Every caller here holds a valid session cookie.
    isAuthorizedRequest: () => true,
    getCurrentUser: async req => (who(req) ? { ...who(req), active: true } : null),
    isAdmin: user => user?.role === 'admin',
  },
  '@/lib/access': {
    async requirePermission(req, permission) {
      const user = who(req)
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (user.role === 'admin' || user.permissions.includes(permission)) return { ...user, active: true }
      return NextResponse.json({ error: `no ${permission}` }, { status: 403 })
    },
  },
  '@/lib/audit': { auditLog: async () => {} },
  '@/lib/local-runtime': { chooseBestInstalledModel: () => null },
  '@/lib/bridge-launcher': {
    resolveBridgeLauncher: () => ({ repoRoot: fakeHome }),
    bridgeArgv: (_l, action) => ({ file: 'bridge.sh', args: [action] }),
  },
  '@/lib/internal-request': { markServiceRequest: req => req },
  '../jarvis/route': { POST: async () => ({ ok: true, status: 200, text: async () => '' }) },
}
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

const savedFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('offline') }

// Compiled the same way so its child_process import gets the stub above.
stubs['@/lib/ollama-pull'] = loadRoute('lib/ollama-pull.ts')

const bridgeStart = loadRoute('app/api/bridge-start/route.ts')
const llmfit = loadRoute('app/api/llmfit/route.ts')
const install = loadRoute('app/api/models/install/route.ts')
const webhook = loadRoute('app/api/webhook/route.ts')
const webhookConfig = loadRoute('app/api/webhook/config/route.ts')
const biometrics = loadRoute('app/api/jarvis/biometrics/route.ts')

function request(user, url, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({ 'x-test-user': user, 'content-type': 'application/json' }),
    async json() { return JSON.parse(text || '{}') },
    async text() { return text },
  }
}

test.after(() => {
  globalThis.fetch = savedFetch
  hooks.deregister()
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

test('bridge start/stop needs admin_tools', async () => {
  launches.length = 0
  const url = 'http://localhost/api/bridge-start'
  assert.equal((await bridgeStart.POST(request('guest', url, { action: 'stop' }))).status, 403)
  assert.equal((await bridgeStart.POST(request('modeler', url, { action: 'stop' }))).status, 403)
  assert.deepEqual(launches, [], 'nothing was launched for a user without admin_tools')
  const ok = await bridgeStart.POST(request('ops', url, { action: 'stop' }))
  assert.equal(ok.status, 200)
  assert.deepEqual(launches, [['bridge.sh', 'stop']])
})

test('llmfit pull needs ai_models and a catalog model (admins may pull a custom one)', async () => {
  const url = 'http://localhost/api/llmfit'
  spawnMode = 'ok'
  launches.length = 0
  assert.equal((await llmfit.POST(request('guest', url, { modelId: 'qwen3:8b' }))).status, 403)
  const custom = await llmfit.POST(request('modeler', url, { customModel: 'hf.co/someone/huge-model-GGUF' }))
  assert.equal(custom.status, 400, 'non-catalog model refused for a regular user')
  assert.equal((await llmfit.POST(request('modeler', url, { customModel: '--insecure' }))).status, 400, 'no option flags')
  assert.equal((await llmfit.POST(request('admin', url, { customModel: '-x' }))).status, 400, 'no option flags for admins either')
  assert.deepEqual(launches, [])

  const fromCatalog = await llmfit.POST(request('modeler', url, { modelId: 'qwen3:8b' }))
  assert.equal(fromCatalog.status, 200)
  assert.equal((await fromCatalog.json()).status, 'pulling')
  const adminCustom = await llmfit.POST(request('admin', url, { customModel: 'hf.co/someone/model-GGUF' }))
  assert.equal(adminCustom.status, 200)
  assert.deepEqual(launches, [['ollama', 'pull', 'qwen3:8b'], ['ollama', 'pull', 'hf.co/someone/model-GGUF']])
})

test('a missing ollama is reported as a failure, not as pulling / installing', async () => {
  spawnMode = 'enoent'
  const pull = await llmfit.POST(request('modeler', 'http://localhost/api/llmfit', { modelId: 'qwen3:8b' }))
  assert.equal(pull.status, 503)
  assert.match((await pull.json()).error, /not installed/)

  const inst = await install.POST(request('modeler', 'http://localhost/api/models/install', { runner: 'ollama', model: firstOllamaModelId() }))
  assert.equal(inst.status, 503)
  const body = await inst.json()
  assert.equal(body.ok, false)
  assert.equal(body.status, 'failed')
})

function firstOllamaModelId() {
  const { LOCAL_MODELS } = require('../lib/local-models.ts')
  return LOCAL_MODELS.find(m => m.runner === 'ollama').id
}

test('webhook config and log clearing need admin_tools', async () => {
  const file = path.join(fakeHome, '.ghostforge', 'webhooks.json')
  const url = 'http://localhost/api/webhook/config'
  assert.equal((await webhookConfig.POST(request('guest', url, [{ id: 'evil' }]))).status, 403)
  assert.equal(fs.existsSync(file), false, 'config not written')
  // The delivery route no longer writes config at all, whoever asks.
  assert.equal((await webhook.POST(request('ops', 'http://localhost/api/webhook?config=1', [{ id: 'x', source: 'github', eventType: 'push', action: 'notify' }]))).status, 410)
  assert.equal(fs.existsSync(file), false, 'config not written by the delivery route')
  assert.equal((await webhookConfig.POST(request('ops', url, [{ id: 'bad' }]))).status, 400)
  assert.equal((await webhook.DELETE(request('guest', 'http://localhost/api/webhook'))).status, 403)

  assert.equal((await webhookConfig.POST(request('ops', url, [{ id: 't1', source: 'github', eventType: 'push', action: 'notify' }]))).status, 200)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map(t => t.id), ['t1'])
  assert.equal((await webhook.DELETE(request('ops', 'http://localhost/api/webhook'))).status, 200)
})

test('only an admin can enroll the voice profile or replace the typing profile', async () => {
  const url = 'http://localhost/api/jarvis/biometrics'
  const audio = Buffer.alloc(2000, 1).toString('base64')
  const denied = await biometrics.POST(request('guest', url, { action: 'enroll-voice', audio }))
  assert.equal(denied.status, 403)
  assert.equal((await biometrics.POST(request('guest', url, { action: 'update-typing-profile', typingData: { a: 1 } }))).status, 403)
  assert.equal(fs.existsSync(path.join(fakeHome, '.ghostforge', 'biometrics', 'meta.json')), false, 'nothing enrolled')

  const ok = await biometrics.POST(request('admin', url, { action: 'enroll-voice', audio }))
  assert.equal(ok.status, 200)
  assert.ok(fs.existsSync(path.join(fakeHome, '.ghostforge', 'biometrics', 'meta.json')))
  // Verifying stays open to any signed-in user.
  assert.notEqual((await biometrics.POST(request('guest', url, { action: 'verify-voice', audio }))).status, 403)
})
