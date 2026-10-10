const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/dashboard/route.ts')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-dashboard-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.GITHUB_TOKEN = 'test-token'

let currentUser = null
let pushConfigured = false
const pushes = []

// Fake exec: every command takes 50 ms; record how many run at once.
const execStats = { inFlight: 0, maxInFlight: 0, commands: [] }
let execOutputs = null
function fakeExec(command, _options, callback) {
  if (execOutputs) {
    const key = Object.keys(execOutputs).find(k => command.startsWith(k))
    setImmediate(() => callback(null, { stdout: key ? execOutputs[key] : '', stderr: '' }))
    return
  }
  execStats.commands.push(command)
  execStats.inFlight++
  execStats.maxInFlight = Math.max(execStats.maxInFlight, execStats.inFlight)
  setTimeout(() => {
    execStats.inFlight--
    callback(null, { stdout: '', stderr: '' })
  }, 50)
}

const dependencies = {
  'next/server': {
    NextResponse: { json(body, init = {}) { return { status: init.status ?? 200, json: async () => body } } },
  },
  '@/lib/hosted': { hostedGuard: () => null },
  '@/lib/auth': { isAuthorizedRequest: () => true, getCurrentUser: async () => currentUser },
  '@/lib/push': {
    isPushConfigured: () => pushConfigured,
    sendToUser: async (username, payload) => { pushes.push({ username, payload }); return { sent: true } },
  },
  '@/lib/system-info': {
    getCPU: () => 1,
    getRAM: () => ({ usedGB: 1, totalGB: 2, pct: 50 }),
    getDisk: () => ({ usedGB: 1, totalGB: 2, pct: 50 }),
    getBattery: () => ({ pct: null, charging: false, present: false }),
  },
  child_process: { exec: fakeExec },
}

function transpile(file) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  mod._compile(compiled, file)
  return mod.exports
}
dependencies['@/lib/swr-cache'] = transpile(path.resolve(__dirname, '../lib/swr-cache.ts'))
dependencies['@/lib/dashboard-digest'] = transpile(path.resolve(__dirname, '../lib/dashboard-digest.ts'))

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
  const routeModule = new Module(routePath, module)
  routeModule.filename = routePath
  routeModule.paths = Module._nodeModulePaths(path.dirname(routePath))
  routeModule._compile(compiled, routePath)
  route = routeModule.exports
} finally {
  Module._load = originalLoad
}

const realFetch = global.fetch
const fetched = []
test.before(() => { global.fetch = async (url) => { fetched.push(String(url)); throw new Error('offline') } })
test.after(() => {
  global.fetch = realFetch
  fs.rmSync(home, { recursive: true, force: true })
})

test('dashboard runs the git and gh commands concurrently', async () => {
  const res = await route.GET({})
  assert.equal(res.status, 200)
  assert.ok(execStats.commands.some(c => c.startsWith('gh pr list')), 'gh commands run when GITHUB_TOKEN is set')
  assert.equal(execStats.maxInFlight, execStats.commands.length, 'every command was in flight at once')
})

test('dashboard reads only the newest audit entries and skips malformed lines', async () => {
  const dir = path.join(home, '.ghostforge')
  fs.mkdirSync(dir, { recursive: true })
  const old = Array.from({ length: 5000 }, (_, i) => JSON.stringify({ ts: 't', level: 'info', event: `old-${i}` }))
  const recent = Array.from({ length: 10 }, (_, i) => JSON.stringify({ ts: 't', level: 'warn', event: `new-${i}` }))
  // A malformed line among the newest must not hide the others
  fs.writeFileSync(path.join(dir, 'audit.log'), [...old, ...recent.slice(0, 5), '{not json', ...recent.slice(5)].join('\n') + '\n')

  const body = await (await route.GET({})).json()
  assert.deepEqual(body.audit.map(e => e.event), ['new-9', 'new-8', 'new-7', 'new-6', 'new-5', 'new-4', 'new-3', 'new-2'])
})

test('dashboard does not fetch its own web UI to decide that it is online', async () => {
  fetched.length = 0
  const body = await (await route.GET({})).json()
  assert.ok(!fetched.some(u => u.includes(':3001')), `self-fetch: ${fetched.join(', ')}`)
  assert.equal(body.services.find(s => s.name === 'GhostForge Web UI').status, 'online')
})

test('scope=system returns only host metrics without spawning git or gh', async () => {
  execStats.commands.length = 0
  fetched.length = 0
  const req = { nextUrl: new URL('http://localhost/api/dashboard?scope=system') }
  const body = await (await route.GET(req)).json()
  assert.deepEqual(Object.keys(body).sort(), ['system', 'timestamp'])
  assert.equal(body.system.ram.pct, 50)
  assert.equal(execStats.commands.length, 0)
  assert.equal(fetched.length, 0)
})

test('git/gh panels are cached between loads; ?refresh=1 re-runs them', async () => {
  execStats.commands.length = 0
  const first = await (await route.GET({})).json()
  assert.equal(execStats.commands.length, 0, 'served from the cache filled by earlier tests')
  assert.equal(first.panelsCached, true)
  assert.ok(first.panelsFetchedAt)

  const req = { nextUrl: new URL('http://localhost/api/dashboard?refresh=1') }
  const fresh = await (await route.GET(req)).json()
  assert.equal(fresh.panelsCached, false)
  assert.equal(execStats.commands.length, 5, 'git log, git for-each-ref and three gh calls')
  assert.ok(!execStats.commands.some(c => c.includes('xargs')), 'tag dates come from one for-each-ref call')
})

test('"since you were away": baseline on first visit, then new failures/PRs/tags until dismissed', async () => {
  // Fake gh/git output for this test
  const outputs = {
    'gh run list': JSON.stringify([
      { databaseId: 1, name: 'CI', status: 'completed', conclusion: 'failure', updatedAt: '2026-01-01T00:00:00Z', headBranch: 'main' },
      { databaseId: 2, name: 'Lint', status: 'completed', conclusion: 'success', updatedAt: '2026-01-01T00:00:00Z', headBranch: 'main' },
    ]),
    'gh pr list': JSON.stringify([{ number: 7, title: 'Add x', author: { login: 'a' }, reviewDecision: '' }]),
    'git for-each-ref': 'v1.0.0 2026-01-01',
  }
  const setOutputs = next => Object.assign(outputs, next)
  execOutputs = outputs
  try {
    currentUser = { username: 'owner' }
    const refresh = { nextUrl: new URL('http://localhost/api/dashboard?refresh=1') }
    const first = await (await route.GET(refresh)).json()
    assert.equal(first.digest.firstVisit, true)
    assert.equal(first.digest.total, 0)
    const seenPath = path.join(home, '.ghostforge', 'users', 'owner', 'dashboard-seen.json')
    assert.ok(fs.existsSync(seenPath), 'baseline recorded')

    // Away: a new failing run, a new PR awaiting review and a new tag
    pushConfigured = true
    setOutputs({
      'gh run list': JSON.stringify([
        { databaseId: 3, name: 'Deploy', status: 'completed', conclusion: 'failure', updatedAt: '2026-01-02T00:00:00Z', headBranch: 'main' },
        { databaseId: 1, name: 'CI', status: 'completed', conclusion: 'failure', updatedAt: '2026-01-01T00:00:00Z', headBranch: 'main' },
      ]),
      'gh pr list': JSON.stringify([
        { number: 8, title: 'Fix y', author: { login: 'b' }, reviewDecision: '' },
        { number: 7, title: 'Add x', author: { login: 'a' }, reviewDecision: '' },
      ]),
      'git for-each-ref': 'v1.1.0 2026-01-02\nv1.0.0 2026-01-01',
    })
    const away = await (await route.GET(refresh)).json()
    assert.equal(away.digest.firstVisit, false)
    assert.deepEqual(away.digest.failingRuns.map(r => r.id), ['3'])
    assert.deepEqual(away.digest.prsAwaitingReview.map(p => p.number), ['#8'])
    assert.deepEqual(away.digest.newTags.map(t => t.tag), ['v1.1.0'])
    assert.equal(away.digest.total, 3)
    assert.equal(pushes.length, 1, 'new CI failure pushed once')
    assert.match(pushes[0].payload.body, /Deploy/)

    const again = await (await route.GET({})).json()
    assert.equal(again.digest.total, 3, 'reading does not clear the digest')
    assert.equal(pushes.length, 1, 'no duplicate push for the same run')

    const dismissed = await route.POST({ json: async () => ({ action: 'seen' }) })
    assert.equal(dismissed.status, 200)
    const after = await (await route.GET({})).json()
    assert.equal(after.digest.total, 0)

    assert.equal((await route.POST({ json: async () => ({ action: 'other' }) })).status, 400)
    currentUser = null
    assert.equal((await route.POST({ json: async () => ({ action: 'seen' }) })).status, 401)
    assert.equal((await (await route.GET({})).json()).digest, null)
  } finally {
    execOutputs = null
    pushConfigured = false
    currentUser = null
  }
})
