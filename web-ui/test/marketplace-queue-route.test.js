// /api/marketplace/queue — the web side of the consented installer queue.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')

const repoRoot = path.resolve(__dirname, '../..')
const routePath = path.resolve(__dirname, '../app/api/marketplace/queue/route.ts')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-queue-route-'))
process.env.HOME = home
process.env.USERPROFILE = home
const mdir = path.join(home, 'marketplace')
fs.mkdirSync(mdir)
fs.writeFileSync(path.join(mdir, 'catalog.json'), JSON.stringify({ items: [
  { id: 'gitleaks', name: 'Gitleaks', type: 'tool', category: 'Security', description: 'd', install_command: 'echo gitleaks', install_command_windows: 'echo gitleaks' },
  { id: 'allhackingtools', name: 'AllHackingTools', type: 'tool', category: 'Security', description: 'd', install_command: 'echo nope' },
] }))
fs.writeFileSync(path.join(mdir, 'registry.json'), JSON.stringify({ installed: [], removed: [] }))

const spawned = []
let exitCode = 0
function fakeSpawn(command, options) {
  spawned.push({ command, options })
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setImmediate(() => { child.stdout.emit('data', Buffer.from('ok\n')); child.emit('close', exitCode) })
  return child
}

let hosted = null
let user = { username: 'owner' }
class FakeResponse { constructor(body, status) { this.body = body; this.status = status } }
const dependencies = {
  'next/server': { NextResponse: Object.assign(FakeResponse, { json: (body, init = {}) => new FakeResponse(body, init.status ?? 200) }) },
  '@/lib/hosted': { hostedGuard: () => hosted },
  '@/lib/access': { requirePermission: async (_req, perm) => (perm === 'terminal' && user ? user : new FakeResponse({ error: 'no' }, 403)) },
  '@/lib/marketplace-paths': {
    MARKETPLACE_DIR: mdir,
    CATALOG_PATH: path.join(mdir, 'catalog.json'),
    REGISTRY_PATH: path.join(mdir, 'registry.json'),
    INSTALL_QUEUE_MODULE: path.join(repoRoot, 'marketplace/install-queue.mjs'),
  },
  '@/lib/marketplace-runtime.mjs': { loadInstallQueue: file => import(pathToFileURL(file).href) },
  child_process: { spawn: fakeSpawn },
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(dependencies, request)) return dependencies[request]
  return originalLoad.call(this, request, parent, isMain)
}
let route
try {
  const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(routePath, module)
  mod.filename = routePath
  mod.paths = Module._nodeModulePaths(path.dirname(routePath))
  mod._compile(compiled, routePath)
  route = mod.exports
} finally {
  Module._load = originalLoad
}

test.after(() => fs.rmSync(home, { recursive: true, force: true }))

const post = body => route.POST({ json: async () => body })

test('hosted mode and users without the terminal permission are refused', async () => {
  hosted = new FakeResponse({ error: 'hosted' }, 403)
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await post({ action: 'enqueue', id: 'gitleaks' })).status, 403)
  hosted = null
  user = null
  assert.equal((await post({ action: 'enqueue', id: 'gitleaks' })).status, 403)
  user = { username: 'owner' }
  assert.equal(spawned.length, 0)
})

test('offensive suites cannot be queued from the web', async () => {
  const res = await post({ action: 'enqueue', id: 'allhackingtools' })
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'review_first')
})

test('install runs only the queued, consented command and updates registry.json', async () => {
  assert.equal((await post({ action: 'install', id: 'gitleaks', consent: { approved: true, command: 'echo gitleaks' } })).body.code, 'not_queued')
  const queued = await post({ action: 'enqueue', id: 'gitleaks' })
  assert.equal(queued.status, 200)
  assert.equal(queued.body.queue[0].command, 'echo gitleaks')
  assert.equal(spawned.length, 0, 'queueing runs nothing')

  const noConsent = await post({ action: 'install', id: 'gitleaks' })
  assert.equal(noConsent.status, 400)
  assert.equal(noConsent.body.code, 'consent_required')
  const wrong = await post({ action: 'install', id: 'gitleaks', consent: { approved: true, command: 'echo gitleaks && curl x' } })
  assert.equal(wrong.body.code, 'command_mismatch')
  assert.equal(spawned.length, 0)

  const ok = await post({ action: 'install', id: 'gitleaks', consent: { approved: true, command: 'echo gitleaks' } })
  assert.equal(ok.status, 200)
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].command, 'echo gitleaks')
  assert.deepEqual(ok.body.installed, ['gitleaks'])
  assert.deepEqual(ok.body.queue, [])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(mdir, 'registry.json'), 'utf8')).installed, ['gitleaks'])
  const auditLines = fs.readFileSync(path.join(home, '.ghostforge', 'audit.log'), 'utf8')
  assert.match(auditLines, /marketplace_install_consent/)
  assert.match(auditLines, /"actor":"owner"/)
})

test('a failed install stays queued with its output', async () => {
  fs.writeFileSync(path.join(mdir, 'registry.json'), JSON.stringify({ installed: [], removed: [] }))
  await post({ action: 'enqueue', id: 'gitleaks' })
  exitCode = 1
  const res = await post({ action: 'install', id: 'gitleaks', consent: { approved: true, command: 'echo gitleaks' } })
  exitCode = 0
  assert.equal(res.status, 500)
  assert.equal(res.body.ok, false)
  assert.equal(res.body.queue[0].id, 'gitleaks')
  assert.match(res.body.queue[0].lastError, /ok/)
})

test('invalid bodies are rejected', async () => {
  assert.equal((await post({ action: 'install-all' })).status, 400)
  assert.equal((await route.POST({ json: async () => { throw new Error('bad') } })).status, 400)
})
