// Route-level regressions for the setup wizard and the intrusion response:
//  * POST /api/setup must never widen a user's permissions from self-reported input
//  * anonymous / unauthenticated requests get a plain 401 and never lock the PC
//  * a signed-in non-admin opening /users is refused without an intrusion report
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const fakeHome = fs.mkdtempSync(path.join(tmpdir(), 'gf-routes-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.ADMIN_USERNAME = 'owner'
process.env.ADMIN_PASSWORD = 'owner-password-123'
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

const users = require('../lib/users.ts')

const state = { user: null, reports: [] }
const stubs = {
  'next/server': {
    // A class, because routes test `x instanceof NextResponse`
    NextResponse: class NextResponse {
      constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
      static json(body, init = {}) { return new NextResponse(body, init) }
    },
  },
  '@/lib/auth': {
    getCurrentUser: async () => state.user,
    isAdmin: u => u?.role === 'admin',
  },
  '@/lib/audit': { auditLog: async () => {} },
  '@/lib/intrusion': {
    reportUnauthorizedAccess: async report => { state.reports.push(report); return { locked: false, method: null } },
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
  try {
    mod._compile(compiled, file)
  } finally {
    Module._load = originalLoad
  }
  return mod.exports
}

async function call(handler, { user = null, body = {}, url = 'http://localhost/api/x', headers = {} } = {}) {
  state.user = user
  state.reports = []
  Module._load = stubbedLoad
  try {
    return await handler({
      url,
      nextUrl: new URL(url),
      headers: new Map(Object.entries({ 'user-agent': 'node-test', ...headers })),
      cookies: { get: () => undefined },
      async json() { return body },
    })
  } finally {
    Module._load = originalLoad
  }
}

const setupRoute = loadRoute('app/api/setup/route.ts')
const usersRoute = loadRoute('app/api/users/route.ts')
const devicesRoute = loadRoute('app/api/devices/route.ts')

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 100))
  hooks.deregister()
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// ── POST /api/setup ──────────────────────────────────────────────────────────

test('setup cannot self-grant terminal/admin via the devops profile', async () => {
  await users.ensureUserStore()
  // An owner-created account with only chat (explicit list)
  const created = await users.createUser({ name: 'Guest', username: 'guest', password: 'guest-password-1', permissions: ['chat'] })
  const res = await call(setupRoute.POST, { user: created, body: { name: 'x', jobTitle: 'x', profileId: 'devops' } })
  assert.equal(res.status, 200)
  assert.deepEqual(res._body.permissions, ['chat'])
  const stored = await users.getUserByUsername('guest')
  assert.deepEqual(stored.permissions, ['chat'], 'stored permissions unchanged')
  assert.equal(stored.setupComplete, true)
})

test('setup for a user without owner-assigned flag only narrows (profile ∩ current)', async () => {
  const u = await users.createUser({ name: 'Legacy', username: 'legacy', password: 'legacy-password-1', permissions: ['chat', 'weather'] })
  // Simulate an account from before permissionsAssigned existed
  const legacy = await users.updateUser(u.id, { permissionsAssigned: undefined })
  const res = await call(setupRoute.POST, { user: legacy, body: { name: 'L', jobTitle: 'DevOps engineer', profileId: 'devops' } })
  assert.equal(res.status, 200)
  for (const p of res._body.permissions) assert.ok(['chat', 'weather'].includes(p), `unexpected ${p}`)
  assert.ok(!res._body.permissions.includes('terminal'))
})

// ── intrusion response: never lock for anonymous events ─────────────────────

// Any report not explicitly marked anonymous or non-locking could lock the PC
const lockingReports = () => state.reports.filter(r => r.authenticated !== false && r.lock !== false)

test('/api/users with no session: plain 401, no locking report', async () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const res = await call(usersRoute[method], { user: null })
    assert.equal(res.status, 401, method)
    assert.deepEqual(lockingReports(), [], `${method}: an anonymous request must never lock the PC`)
  }
})

test('a signed-in non-admin opening /users gets 403 and no intrusion report', async () => {
  const guest = await users.getUserByUsername('guest')
  const res = await call(usersRoute.GET, { user: guest })
  assert.equal(res.status, 403)
  assert.deepEqual(state.reports, [])
})

test('a signed-in non-owner mutating users is reported as an authenticated boundary crossing', async () => {
  const guest = await users.getUserByUsername('guest')
  const res = await call(usersRoute.POST, { user: guest, body: { username: 'evil', password: 'evil-password' } })
  assert.equal(res.status, 403)
  assert.equal(state.reports.length, 1)
  assert.equal(state.reports[0].authenticated, true)
})

test('DELETE /api/devices with no session: plain 401, no report', async () => {
  const res = await call(devicesRoute.DELETE, { user: null, url: 'http://localhost/api/devices?id=x' })
  assert.equal(res.status, 401)
  assert.deepEqual(state.reports, [])
})

test('every reportUnauthorizedAccess call site states whether the actor is authenticated', () => {
  // Locking defaults to off unless authenticated: true, so a call without the
  // flag is safe — but each site should make the decision explicitly.
  const files = [
    'app/api/users/route.ts', 'app/api/devices/route.ts', 'app/api/jarvis/route.ts',
    'app/api/auth/route.ts', 'lib/access.ts',
  ]
  for (const rel of files) {
    const src = fs.readFileSync(path.join(WEB_UI, rel), 'utf8')
    const calls = [...src.matchAll(/reportUnauthorizedAccess\(\{([\s\S]*?)\}\)/g)]
    assert.ok(calls.length > 0, `${rel} has a call`)
    for (const [, args] of calls) {
      assert.match(args, /authenticated:\s*(true|false)/, `${rel}: call without an explicit authenticated flag`)
    }
  }
})
