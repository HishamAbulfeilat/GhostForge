'use strict'
// JARVIS history and knowledge vault are per user (review finding #7): each
// user only reads and changes their own, the routes need conversation_history /
// semantic_memory, the owner inherits the old global files, and the vault_save
// tool writes to the calling user's vault.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const fakeHome = fs.mkdtempSync(path.join(tmpdir(), 'gf-jarvis-store-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.ADMIN_USERNAME = 'owner'
process.env.NODE_ENV = 'test'

const WEB_UI = path.resolve(__dirname, '..')
const GF = path.join(fakeHome, '.ghostforge')
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

// Old global files from before per-user stores.
fs.mkdirSync(path.join(GF, 'jarvis'), { recursive: true })
fs.writeFileSync(path.join(GF, 'jarvis', 'history.json'), JSON.stringify([
  { id: 'legacy-1', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:05:00.000Z', messages: [{ role: 'user', content: 'old global chat', ts: 1 }] },
]))
fs.writeFileSync(path.join(GF, 'jarvis', 'vault.json'), JSON.stringify({ version: 1, entries: [{ id: 'x', category: 'identity', key: 'name', value: 'Owner Name', ts: 1 }] }))

class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
  async json() { return this._body }
}

const PEOPLE = {
  alice: { username: 'alice', role: 'user', permissions: ['chat', 'conversation_history', 'semantic_memory'] },
  bob: { username: 'bob', role: 'user', permissions: ['chat', 'conversation_history', 'semantic_memory'] },
  guest: { username: 'guest', role: 'user', permissions: ['chat'] },
  owner: { username: 'owner', role: 'admin', permissions: ['*'] },
}
const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': { isAuthorizedRequest: () => true },
  '@/lib/access': {
    async requirePermission(req, permission) {
      const user = PEOPLE[req.headers.get('x-test-user')]
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (user.role === 'admin' || user.permissions.includes(permission)) return { ...user, id: `id-${user.username}`, active: true }
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    },
  },
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  Module._load = stubbedLoad
  try { mod._compile(compiled, file) } finally { Module._load = originalLoad }
  return mod.exports
}
const history = loadRoute('app/api/jarvis/history/route.ts')
const vault = loadRoute('app/api/jarvis/vault/route.ts')

function request(user, { url = 'http://localhost/api/x', body } = {}) {
  const u = new URL(url)
  return {
    url,
    nextUrl: u,
    headers: new Headers({ 'x-test-user': user }),
    async json() { return body },
  }
}
const histUrl = q => `http://localhost/api/jarvis/history${q || ''}`
const session = (id, content) => ({ id, startedAt: '2026-11-20T10:00:00.000Z', endedAt: '2026-11-20T10:01:00.000Z', messages: [{ role: 'user', content, ts: Date.parse('2026-11-20T10:00:00.000Z') }] })
const ids = async res => (await res.json()).sessions.map(s => s.id)

test.after(() => {
  hooks.deregister()
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

test('history: each user sees and changes only their own sessions', async () => {
  assert.equal((await history.POST(request('alice', { url: histUrl(), body: session('s1', 'alice secret') }))).status, 200)
  assert.deepEqual(await ids(await history.GET(request('bob', { url: histUrl() }))), [], 'bob does not see alice')

  // bob posting under alice's id creates his own session, not an overwrite
  await history.POST(request('bob', { url: histUrl(), body: session('s1', 'bob text') }))
  const del = await history.DELETE(request('bob', { url: histUrl('?id=s1') }))
  assert.equal(del.status, 200)

  const alice = await (await history.GET(request('alice', { url: histUrl() }))).json()
  assert.deepEqual(alice.sessions.map(s => s.messages[0].content), ['alice secret'], "alice's session is intact")
  assert.ok(!JSON.stringify(alice).includes('old global chat'), 'a regular user does not inherit the old global history')

  const file = path.join(GF, 'users', 'alice', 'jarvis', 'history.json')
  assert.ok(fs.existsSync(file))
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('history needs conversation_history; the vault needs semantic_memory', async () => {
  assert.equal((await history.GET(request('guest', { url: histUrl() }))).status, 403)
  assert.equal((await history.POST(request('guest', { url: histUrl(), body: session('g', 'x') }))).status, 403)
  assert.equal((await history.DELETE(request('guest', { url: histUrl('?id=s1') }))).status, 403)
  assert.equal((await vault.GET(request('guest', { url: 'http://localhost/api/jarvis/vault' }))).status, 403)
  assert.equal((await vault.POST(request('guest', { url: 'http://localhost/api/jarvis/vault', body: { action: 'clear' } }))).status, 403)
  assert.equal((await history.GET(request('nobody', { url: histUrl() }))).status, 401)
})

test('vault: one user clearing or deleting never touches another user', async () => {
  const vurl = 'http://localhost/api/jarvis/vault'
  const saved = await vault.POST(request('alice', { url: vurl, body: { action: 'save', category: 'identity', key: 'city', value: 'Amman' } }))
  assert.equal(saved.status, 200)
  assert.equal((await vault.POST(request('bob', { url: vurl, body: { action: 'clear' } }))).status, 200)
  await vault.POST(request('bob', { url: vurl, body: { action: 'delete', category: 'identity', key: 'city' } }))

  const bobView = await (await vault.GET(request('bob', { url: vurl }))).json()
  assert.equal(bobView.total, 0, 'bob cannot read alice')
  const aliceView = await (await vault.GET(request('alice', { url: vurl }))).json()
  assert.deepEqual(aliceView.entries.map(e => `${e.key}=${e.value}`), ['city=Amman'])
  assert.ok(!JSON.stringify(aliceView).includes('Owner Name'), 'a regular user does not inherit the old global vault')
})

test('the owner inherits the old global history and vault, which are then gone', async () => {
  assert.deepEqual(await ids(await history.GET(request('owner', { url: histUrl() }))), ['legacy-1'])
  const ownerVault = await (await vault.GET(request('owner', { url: 'http://localhost/api/jarvis/vault' }))).json()
  assert.deepEqual(ownerVault.entries.map(e => e.value), ['Owner Name'])
  assert.equal(fs.existsSync(path.join(GF, 'jarvis', 'history.json')), false, 'global history moved')
  assert.equal(fs.existsSync(path.join(GF, 'jarvis', 'vault.json')), false, 'global vault moved')
  assert.ok(fs.existsSync(path.join(GF, 'users', 'owner', 'jarvis', 'history.json')))
})

test('a corrupt store is reported, never overwritten', async () => {
  const file = path.join(GF, 'users', 'alice', 'jarvis', 'history.json')
  fs.writeFileSync(file, '[{"id":')
  const res = await history.POST(request('alice', { url: histUrl(), body: session('s2', 'more') }))
  assert.equal(res.status, 500)
  assert.equal(fs.readFileSync(file, 'utf8'), '[{"id":')
})

test('vault_save writes to the calling user\'s vault', async () => {
  const store = require('../lib/jarvis-store.ts')
  assert.throws(() => store.jarvisUserDir('../etc'), /No per-user/)
  assert.throws(() => store.jarvisUserDir('service:webhook'), /No per-user/)

  // The tool's own code: it must go through the per-user store with the caller.
  const src = fs.readFileSync(path.join(WEB_UI, 'app/api/jarvis/route.ts'), 'utf8')
  const start = src.indexOf("case 'vault_save': {")
  const body = src.slice(start, src.indexOf("case 'agent_team': {", start))
  assert.ok(start > 0)
  assert.match(body, /updateVault\(currentUser,/)
  assert.doesNotMatch(body, /writeFileSync|homedir\(\)/, 'no global vault file in the tool')

  // And the store call it makes lands in that user's file only.
  await store.updateVault({ username: 'bob', role: 'user' }, v => store.upsertEntry(v, { id: 'facts-pet', category: 'facts', key: 'pet', value: 'cat', ts: 2 }))
  assert.deepEqual((await store.readVault({ username: 'bob', role: 'user' })).entries.map(e => e.key), ['pet'])
  assert.ok(!(await store.readVault({ username: 'alice', role: 'user' })).entries.some(e => e.key === 'pet'))
})
