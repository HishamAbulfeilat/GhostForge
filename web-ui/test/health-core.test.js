// "Health at a glance" status contract (lib/health-core.mjs, GET /api/health).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const corePath = path.resolve(__dirname, '../lib/health-core.mjs')
const load = () => import(corePath)

/** Fake I/O: urls → status (number) or 'down'; commands on PATH; files. */
function deps({ urls = {}, onPath = [], files = {}, env = {}, run = async () => ({ code: 0, stdout: '', stderr: '' }), now = Date.UTC(2026, 0, 1) } = {}) {
  const seen = []
  return {
    seen,
    env,
    webUiDir: '/gf/web-ui',
    homeDir: '/home/me',
    now: () => now,
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), headers: init?.headers || {} })
      const hit = Object.entries(urls).find(([prefix]) => String(url).startsWith(prefix))
      if (!hit || hit[1] === 'down') throw new Error('ECONNREFUSED')
      return { status: hit[1] }
    },
    findOnPath: async cmd => (onPath.includes(cmd) ? `/usr/bin/${cmd}` : null),
    run,
    readFile: async file => {
      if (Object.hasOwn(files, file)) return Buffer.from(files[file])
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    },
    exists: async file => Object.hasOwn(files, file),
  }
}

const byId = report => Object.fromEntries(report.checks.map(c => [c.id, c]))

test('every check uses one of the four states and non-ready checks carry a fix', async () => {
  const { collectHealth, HEALTH_STATUSES } = await load()
  const report = await collectHealth(deps())
  assert.deepEqual(report.checks.map(c => c.id), ['bridge', 'voice', 'omniroute', 'ollama', 'gh', 'https', 'push'])
  for (const check of report.checks) {
    assert.ok(HEALTH_STATUSES.includes(check.status), `${check.id}: ${check.status}`)
    if (check.status !== 'ready') assert.ok(check.fix && check.fix.length > 10, `${check.id} needs a fix-it step`)
    assert.doesNotMatch(check.detail, /https?:\/\//, `${check.id} detail must not leak URLs`)
  }
  const sum = Object.values(report.summary).reduce((a, b) => a + b, 0)
  assert.equal(sum, report.checks.length)
})

test('bridge: missing without a token, offline when down, error on rejected token, ready otherwise', async () => {
  const { collectHealth } = await load()
  const tokenFile = '/home/me/.ghostforge/bridge/token'
  assert.equal(byId(await collectHealth(deps())).bridge.status, 'missing')
  assert.equal(byId(await collectHealth(deps({ files: { [tokenFile]: 'tok\n' } }))).bridge.status, 'offline')
  const rejected = await collectHealth(deps({ files: { [tokenFile]: 'tok' }, urls: { 'http://127.0.0.1:8765': 401 } }))
  assert.equal(byId(rejected).bridge.status, 'error')
  const d = deps({ files: { [tokenFile]: 'tok' }, urls: { 'http://127.0.0.1:8765': 200 } })
  const ready = await collectHealth(d)
  assert.equal(byId(ready).bridge.status, 'ready')
  assert.equal(d.seen.find(s => s.url.includes(':8765')).headers.Authorization, 'Bearer tok')
  assert.equal(ready.ok, true, 'core is ready when the only required check is ready')
  assert.equal((await collectHealth(deps())).ok, false)
})

test('services distinguish not installed (missing) from installed-but-down (offline)', async () => {
  const { collectHealth } = await load()
  const none = byId(await collectHealth(deps()))
  assert.equal(none.ollama.status, 'missing')
  assert.equal(none.omniroute.status, 'missing')
  assert.equal(none.voice.status, 'missing')
  const installed = byId(await collectHealth(deps({ onPath: ['ollama', 'omniroute'], files: { '/gf/voice-pipeline/start.sh': '' } })))
  assert.equal(installed.ollama.status, 'offline')
  assert.equal(installed.omniroute.status, 'offline')
  assert.equal(installed.voice.status, 'offline')
  const up = byId(await collectHealth(deps({ urls: { 'http://localhost:11434': 200, 'http://localhost:20128': 200, 'http://localhost:8766': 200 } })))
  assert.equal(up.ollama.status, 'ready')
  assert.equal(up.omniroute.status, 'ready')
  assert.equal(up.voice.status, 'ready')
  const broken = byId(await collectHealth(deps({ urls: { 'http://localhost:11434': 500 } })))
  assert.equal(broken.ollama.status, 'error')
})

test('gh: missing, signed out, token error and ready', async () => {
  const { collectHealth } = await load()
  assert.equal(byId(await collectHealth(deps())).gh.status, 'missing')
  const signedOut = deps({ onPath: ['gh'], run: async () => ({ code: 1, stdout: '', stderr: 'not logged in' }) })
  assert.equal(byId(await collectHealth(signedOut)).gh.status, 'missing')
  const badToken = deps({ onPath: ['gh'], env: { GITHUB_TOKEN: 'x' }, run: async () => ({ code: 1, stdout: '', stderr: '' }) })
  assert.equal(byId(await collectHealth(badToken)).gh.status, 'error')
  const calls = []
  const ok = deps({ onPath: ['gh'], run: async (file, args) => { calls.push([file, args]); return { code: 0, stdout: '', stderr: '' } } })
  assert.equal(byId(await collectHealth(ok)).gh.status, 'ready')
  assert.deepEqual(calls, [['/usr/bin/gh', ['auth', 'status']]], 'argv, no shell')
})

test('push keys and HTTPS certificate states', async () => {
  const { collectHealth } = await load()
  assert.equal(byId(await collectHealth(deps({ env: { VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' } }))).push.status, 'ready')
  assert.equal(byId(await collectHealth(deps({ env: { VAPID_PUBLIC_KEY: 'a' } }))).push.status, 'missing')
  assert.match(byId(await collectHealth(deps())).https.fix, /mkcert/)
  assert.equal(byId(await collectHealth(deps({ onPath: ['mkcert'] }))).https.status, 'missing')
  const garbage = byId(await collectHealth(deps({ files: { '/gf/web-ui/certs/cert.pem': 'not a cert' } })))
  assert.equal(garbage.https.status, 'error')
})

test('a check that throws becomes an error row instead of failing the report', async () => {
  const { collectHealth } = await load()
  const d = deps()
  d.findOnPath = async () => { throw new Error('boom') }
  const report = byId(await collectHealth(d))
  assert.equal(report.ollama.status, 'error')
  assert.match(report.ollama.detail, /boom/)
})

test('findOnPath finds executables without a shell and rejects odd names', async () => {
  const { findOnPath } = await load()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-path-'))
  try {
    const bin = path.join(dir, 'gf-tool')
    fs.writeFileSync(bin, '#!/bin/sh\n')
    fs.chmodSync(bin, 0o755)
    assert.equal(await findOnPath('gf-tool', { PATH: dir }, 'linux'), bin)
    assert.equal(await findOnPath('nope', { PATH: dir }, 'linux'), null)
    assert.equal(await findOnPath('gf-tool; rm -rf /', { PATH: dir }, 'linux'), null)
    fs.writeFileSync(path.join(dir, 'winny.EXE'), '')
    assert.equal(await findOnPath('winny', { PATH: dir, PATHEXT: '.EXE' }, 'win32'), path.join(dir, 'winny.EXE'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('parseEnvFile reads KEY=VALUE lines', async () => {
  const { parseEnvFile } = await load()
  assert.deepEqual(parseEnvFile('# c\nA=1\nB="two"\n\nbad\n'), { A: '1', B: 'two' })
})

// ── Route ────────────────────────────────────────────────────────────────────

function loadRoute({ hosted = null, authorized = true, collect }) {
  const dependencies = {
    'next/server': { NextResponse: { json(body, init = {}) { return { status: init.status ?? 200, body, headers: init.headers } } } },
    '@/lib/hosted': { hostedGuard: () => hosted },
    '@/lib/auth': { isAuthorizedRequest: () => authorized },
    '@/lib/health-core.mjs': { collectHealth: collect },
  }
  const routePath = path.resolve(__dirname, '../app/api/health/route.ts')
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const mod = new Module(routePath, module)
    mod.filename = routePath
    mod.paths = Module._nodeModulePaths(path.dirname(routePath))
    mod._compile(compiled, routePath)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

const req = (qs = '') => ({ nextUrl: new URL(`http://localhost/api/health${qs}`) })

test('route: hosted mode and unauthenticated callers never run probes', async () => {
  let runs = 0
  const collect = async () => { runs++; return { checks: [] } }
  const hostedRes = { status: 403 }
  assert.equal(await loadRoute({ hosted: hostedRes, collect }).GET(req()), hostedRes)
  assert.equal((await loadRoute({ authorized: false, collect }).GET(req())).status, 401)
  assert.equal(runs, 0)
})

test('route: concurrent and repeat calls share one probe round; ?fresh=1 re-probes', async () => {
  let runs = 0
  const route = loadRoute({ collect: async () => { runs++; await new Promise(r => setTimeout(r, 20)); return { ok: true, checks: [], n: runs } } })
  const [a, b] = await Promise.all([route.GET(req()), route.GET(req())])
  assert.equal(runs, 1)
  assert.equal(a.body, b.body)
  await route.GET(req())
  assert.equal(runs, 1, 'cached')
  await route.GET(req('?fresh=1'))
  assert.equal(runs, 2)
  assert.equal(a.headers['Cache-Control'], 'no-store')
})
