'use strict'
// Shared JARVIS sessions: the TUI creates sessions in mark-l-bridge's collab
// store and prints /jarvis?session=<id>. The web route used to keep its own
// unrelated in-memory Map (so every such link was a 404), and the /jarvis page
// never read ?session=. The route now proxies to the bridge store; the page
// joins the session named in the URL.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const WEB_UI = path.resolve(__dirname, '..')
const TOKEN = 'collab-bridge-token'

// ── A stand-in for mark-l-bridge's /api/jarvis/collab (same contract) ───────
const bridgeSessions = new Map()
const bridgeHits = []
let nextId = 0
const bridge = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  bridgeHits.push(`${req.method} ${url.pathname}${url.search}`)
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { detail: 'Unauthorized: invalid bridge token' })
  if (url.pathname !== '/api/jarvis/collab') return send(404, { detail: 'Not Found' })
  if (req.method === 'GET') {
    const id = url.searchParams.get('id')
    if (!id) {
      const newId = `b${String(++nextId).padStart(11, '0')}`
      bridgeSessions.set(newId, { messages: [], participants: 1 })
      return send(200, { id: newId, shareUrl: `/jarvis?session=${newId}` })
    }
    const s = bridgeSessions.get(id)
    if (!s) return send(404, { detail: 'Session not found' })
    s.participants += 1
    return send(200, { id, messages: s.messages, participants: s.participants })
  }
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    const s = bridgeSessions.get(body.id)
    if (!s) return send(404, { detail: 'Session not found' })
    s.messages.push({ role: body.role, content: body.content, ts: Date.now() })
    send(200, { ok: true })
  })
})

class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
}
const state = { authed: true, token: TOKEN, bridgeStarts: 0, canStart: false }
const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': { isAuthorizedRequest: () => state.authed },
  '@/lib/bridge-token': { getLiveBridgeToken: () => state.token },
  '@/lib/mark-liv-bridge': { ensureMarkLivBridge: async () => { state.bridgeStarts++; return state.canStart } },
}
const originalLoad = Module._load
const cache = new Map()
function compile(file) {
  if (cache.has(file)) return cache.get(file).exports
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  cache.set(file, mod)
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

let route
let client
test.before(async () => {
  await new Promise(r => bridge.listen(0, '127.0.0.1', r))
  process.env.MARKL_BRIDGE_URL = `http://127.0.0.1:${bridge.address().port}`
  route = load('app/api/jarvis/collab/route.ts')
  client = load('lib/collab-client.ts')
})
test.after(() => bridge.close())
test.beforeEach(() => {
  state.authed = true
  state.token = TOKEN
  state.bridgeStarts = 0
  bridgeHits.length = 0
})

const get = id => route.GET({ url: `http://localhost/api/jarvis/collab${id ? `?id=${id}` : ''}`, headers: new Map() })
const post = body => route.POST({ url: 'http://localhost/api/jarvis/collab', headers: new Map(), async json() { return body } })

test('a session the TUI created on the bridge opens through the web route', async () => {
  // What the TUI does: create on the bridge directly, then post a turn there.
  const created = await (await fetch(`${process.env.MARKL_BRIDGE_URL}/api/jarvis/collab`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
  bridgeSessions.get(created.id).messages.push({ role: 'user', content: 'hello from the TUI', ts: 1 })

  const res = await get(created.id)
  assert.equal(res.status, 200, JSON.stringify(res._body))
  assert.equal(res._body.id, created.id)
  assert.deepEqual(res._body.messages.map(m => m.content), ['hello from the TUI'])
})

test('a session created on the web lives in the bridge store, and posts land there', async () => {
  const created = await get()
  assert.equal(created.status, 200)
  assert.match(created._body.shareUrl, /^\/jarvis\?session=/)
  assert.ok(bridgeSessions.has(created._body.id), 'stored on the bridge, not in the web process')

  const ok = await post({ id: created._body.id, role: 'assistant', content: 'hi there' })
  assert.equal(ok.status, 200)
  assert.equal(bridgeSessions.get(created._body.id).messages[0].content, 'hi there')
})

test('auth and payload checks happen before anything reaches the bridge', async () => {
  state.authed = false
  assert.equal((await get()).status, 401)
  assert.equal((await post({ id: 'abcdefgh1', role: 'user', content: 'x' })).status, 401)
  state.authed = true
  assert.equal((await get('bad-id!')).status, 400)
  assert.equal((await post({ id: 'abcdefgh1', role: 'system', content: 'x' })).status, 400)
  assert.equal((await post({ id: 'abcdefgh1', role: 'user', content: 'x'.repeat(10_001) })).status, 400)
  assert.equal((await post({ id: 'a'.repeat(65), role: 'user', content: 'x' })).status, 400)
  assert.deepEqual(bridgeHits, [])
})

test('bridge failures map to clear statuses', async () => {
  assert.equal((await get('doesnotexist1')).status, 404)
  assert.equal((await post({ id: 'doesnotexist1', role: 'user', content: 'x' })).status, 404)

  state.token = 'stale'
  const stale = await get()
  assert.equal(stale.status, 502)
  assert.match(stale._body.error, /token/)

  const saved = process.env.MARKL_BRIDGE_URL
  process.env.MARKL_BRIDGE_URL = 'http://127.0.0.1:9'
  state.canStart = false
  try {
    const down = await get()
    assert.equal(down.status, 503)
    assert.equal(state.bridgeStarts, 1, 'tried to start the bridge once')
  } finally {
    process.env.MARKL_BRIDGE_URL = saved
  }

  process.env.MARKL_BRIDGE_URL = 'http://203.0.113.5:8765'
  try {
    assert.equal((await get()).status, 503, 'a non-loopback bridge URL is refused')
  } finally {
    process.env.MARKL_BRIDGE_URL = saved
  }
})

// ── Page side ────────────────────────────────────────────────────────────────

test('the page reads ?session= and validates it', () => {
  assert.equal(client.sessionIdFromSearch('?session=abc123def456'), 'abc123def456')
  assert.equal(client.sessionIdFromSearch('?foo=1&session=abc123def456'), 'abc123def456')
  assert.equal(client.sessionIdFromSearch(''), null)
  assert.equal(client.sessionIdFromSearch('?session=short'), null)
  assert.equal(client.sessionIdFromSearch('?session=../../etc'), null)
})

test('polling shows only turns other participants added', () => {
  const t = [
    { role: 'user', content: 'from tui', ts: 1 },
    { role: 'user', content: 'mine', ts: 2 },
    { role: 'assistant', content: 'reply to mine', ts: 3 },
    { role: 'user', content: 'tui again', ts: 4 },
  ]
  const first = client.takeNewCollabMessages(t.slice(0, 1), 0, [])
  assert.deepEqual(first.fresh.map(m => m.content), ['from tui'])
  const own = [client.ownKey('user', 'mine'), client.ownKey('assistant', 'reply to mine')]
  const next = client.takeNewCollabMessages(t, first.seen, own)
  assert.deepEqual(next.fresh.map(m => m.content), ['tui again'])
  assert.deepEqual(next.ownPending, [])
  assert.equal(next.seen, 4)
  assert.deepEqual(client.sanitizeCollabMessages([{ role: 'system', content: 'x' }, null, { role: 'user', content: 'ok', ts: 5 }]), [{ role: 'user', content: 'ok', ts: 5 }])
})

test('the /jarvis page joins the session named in its URL', () => {
  const src = fs.readFileSync(path.join(WEB_UI, 'app/jarvis/page.tsx'), 'utf8')
  assert.match(src, /sessionIdFromSearch\(window\.location\.search\)/)
  assert.match(src, /fetch\(`\/api\/jarvis\/collab\?id=\$\{encodeURIComponent\(id\)\}`\)/)
  assert.match(src, /postToCollab\('user', text\)/)
})
