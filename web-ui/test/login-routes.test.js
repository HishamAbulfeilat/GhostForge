'use strict'
// The two sign-in routes: /api/auth checks a username and password only, and
// /api/auth/pin checks the admin PIN only. Nothing in a request body picks
// which secret is checked.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

process.env.NODE_ENV = 'test'
const WEB_UI = path.resolve(__dirname, '..')
const PIN = 'correct-pin-123'

const state = { failures: new Map(), pinFailures: 0, sessions: [] }
const accounts = {
  owner: { username: 'owner', active: true, passwordHash: 'pw:owner-password' },
  hisham: { username: 'hisham', active: true, passwordHash: 'pw:admin' },
  gone: { username: 'gone', active: false, passwordHash: 'pw:gone-password' },
}

class NextResponse {
  constructor(body, init = {}) {
    this.status = init.status ?? 200
    this._body = body
    this.cookieJar = {}
    this.cookies = { set: (name, value) => { this.cookieJar[name] = value } }
  }
  static json(body, init = {}) { return new NextResponse(body, init) }
}

const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': {
    AUTH_COOKIE: 'gf_session',
    AUTH_COOKIE_NAME: 'gf_session',
    getAccessPin: () => PIN,
    createSessionToken: user => { state.sessions.push(user.username); return `token-for-${user.username}` },
    isValidAuthToken: () => false,
  },
  '@/lib/users': {
    ensureUserStore: async () => {},
    getUserByUsername: async name => accounts[name] ?? null,
    verifyPassword: (password, hash) => hash === `pw:${password}`,
  },
  '@/lib/ratelimit': { getClientIP: req => req.headers.get('x-test-ip') || 'local' },
  '@/lib/audit': { auditLog: async () => {} },
  '@/lib/intrusion': {
    MAX_FAILED_LOGINS: 5,
    isLoginBlocked: ip => (state.failures.get(ip) || 0) >= 5,
    recordFailedLogin: ip => { const n = (state.failures.get(ip) || 0) + 1; state.failures.set(ip, n); return n },
    clearFailedLogins: ip => { state.failures.delete(ip) },
    isPinLoginBlocked: () => state.pinFailures >= 10,
    recordFailedPinLogin: () => ++state.pinFailures,
    reportUnauthorizedAccess: async () => ({ locked: false }),
  },
}

const originalLoad = Module._load
function stubbedLoad(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request]
  if (request.startsWith('@/')) return loadTs(path.join(WEB_UI, request.slice(2)) + '.ts')
  return originalLoad.call(this, request, parent, isMain)
}

const cache = new Map()
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  cache.set(file, mod)
  Module._load = stubbedLoad
  try {
    mod._compile(compiled, file)
  } finally {
    Module._load = originalLoad
  }
  return mod.exports
}

const passwordRoute = loadTs(path.join(WEB_UI, 'app/api/auth/route.ts'))
const pinRoute = loadTs(path.join(WEB_UI, 'app/api/auth/pin/route.ts'))

function post(handler, body, ip = 'local') {
  const url = 'http://localhost/api/auth'
  return handler({
    url,
    nextUrl: new URL(url),
    headers: new Map(Object.entries({ 'user-agent': 'node-test', 'x-test-ip': ip })),
    cookies: { get: () => undefined },
    async json() { if (body === undefined) throw new SyntaxError('no body'); return body },
  })
}

test.beforeEach(() => {
  state.failures.clear()
  state.pinFailures = 0
  state.sessions = []
})

test('password route signs in a valid active user', async () => {
  const res = await post(passwordRoute.POST, { username: 'owner', password: 'owner-password' })
  assert.equal(res.status, 200)
  assert.equal(res.cookieJar.gf_session, 'token-for-owner')
})

test('password route rejects a wrong password, an inactive user and an unknown user', async () => {
  for (const body of [
    { username: 'owner', password: 'nope' },
    { username: 'gone', password: 'gone-password' },
    { username: 'nobody', password: 'x' },
  ]) {
    const res = await post(passwordRoute.POST, body, 'ip-a')
    assert.equal(res.status, 401)
  }
  assert.deepEqual(state.sessions, [])
  assert.equal(state.failures.get('ip-a'), 3)
})

test('password route ignores a PIN: it never signs in as the admin', async () => {
  const res = await post(passwordRoute.POST, { pin: PIN }, 'ip-b')
  assert.equal(res.status, 401)
  assert.deepEqual(state.sessions, [])
  assert.equal(state.failures.get('ip-b'), 1, 'a missing username and password counts as a failed attempt')
  assert.equal(state.pinFailures, 0)
})

test('password route treats an empty or unreadable body as a failed attempt', async () => {
  assert.equal((await post(passwordRoute.POST, {}, 'ip-c')).status, 401)
  assert.equal((await post(passwordRoute.POST, undefined, 'ip-c')).status, 401)
  assert.equal(state.failures.get('ip-c'), 2)
})

test('password route is blocked per client after too many failures', async () => {
  for (let i = 0; i < 5; i++) await post(passwordRoute.POST, { username: 'owner', password: 'bad' }, 'ip-d')
  const res = await post(passwordRoute.POST, { username: 'owner', password: 'owner-password' }, 'ip-d')
  assert.equal(res.status, 429)
  assert.deepEqual(state.sessions, [])
})

test('PIN route signs in as the admin with the right PIN', async () => {
  const res = await post(pinRoute.POST, { pin: ` ${PIN} ` })
  assert.equal(res.status, 200)
  assert.equal(res.cookieJar.gf_session, 'token-for-hisham')
})

test('PIN route rejects a wrong, empty or missing PIN and counts each one globally', async () => {
  const bodies = [{ pin: 'wrong' }, { pin: '' }, {}, { username: 'owner', password: 'owner-password' }, undefined]
  for (const [i, body] of bodies.entries()) {
    const res = await post(pinRoute.POST, body, `ip-e${i}`)
    assert.equal(res.status, 401)
  }
  assert.deepEqual(state.sessions, [], 'a username and password sent to the PIN route never sign in')
  assert.equal(state.pinFailures, 5)
})

test('PIN route pauses for everyone after the global cap, even with the right PIN', async () => {
  for (let i = 0; i < 10; i++) await post(pinRoute.POST, { pin: 'wrong' }, `ip-${i}`)
  const res = await post(pinRoute.POST, { pin: PIN }, 'fresh-ip')
  assert.equal(res.status, 429)
  assert.deepEqual(state.sessions, [])
})
