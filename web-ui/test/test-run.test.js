const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routeDir = path.resolve(__dirname, '../app/api/test-run')
const scanDir = path.resolve(__dirname, '../app/api/security-scan')
const pagePath = path.resolve(__dirname, '../app/testing/page.tsx')

function loadTs(filePath, dependencies = {}) {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const compiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const mod = new Module(filePath, module)
    mod.filename = filePath
    mod.paths = Module._nodeModulePaths(path.dirname(filePath))
    mod._compile(compiled, filePath)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

const scanners = loadTs(path.join(scanDir, 'scanners.ts'))
const runner = loadTs(path.join(routeDir, 'runner.ts'), { '../security-scan/scanners': scanners })

// ── Route: auth + request allowlist ──────────────────────────────────────────

const state = { user: null, runs: [], audits: [] }
const route = loadTs(path.join(routeDir, 'route.ts'), {
  'next/server': {
    NextResponse: {
      json(body, init = {}) {
        return { status: init.status ?? 200, json: async () => body }
      },
    },
  },
  '@/lib/auth': {
    getCurrentUser: async () => state.user,
    isAdmin: user => user?.role === 'admin',
  },
  '@/lib/audit': { auditLog: async entry => { state.audits.push(entry) } },
  './runner': {
    isTestCommandId: runner.isTestCommandId,
    listTestCommands: () => runner.TEST_COMMANDS.map(c => ({ id: c.id, available: true })),
    runTestCommand: async id => {
      state.runs.push(id)
      return { id, status: 'pass', exitCode: 0, durationMs: 1, output: 'ok', truncated: false }
    },
  },
})

const post = body => route.POST({ json: async () => body })
const admin = { id: 'a1', username: 'owner', role: 'admin', permissions: ['*'] }
const limited = { id: 'u1', username: 'guest', role: 'user', permissions: ['chat', 'terminal', 'admin_tools'] }

test('unauthenticated callers get 401 and nothing runs', async () => {
  state.user = null
  state.runs = []
  assert.equal((await route.GET({})).status, 401)
  assert.equal((await post({ command: 'smoke' })).status, 401)
  assert.deepEqual(state.runs, [])
})

test('non-admin users get 403 even with broad permissions', async () => {
  state.user = limited
  state.runs = []
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await post({ command: 'smoke' })).status, 403)
  assert.deepEqual(state.runs, [])
})

test('admins can list commands', async () => {
  state.user = admin
  const res = await route.GET({})
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).commands.map(c => c.id), ['smoke', 'coverage'])
})

test('POST rejects unknown commands, args, paths and extra fields', async () => {
  state.user = admin
  state.runs = []
  for (const command of ['rm', 'npm', 'npm test', 'bash', '../scripts/test.js', '', 42, null, '__proto__']) {
    assert.equal((await post({ command })).status, 400, `command ${JSON.stringify(command)}`)
  }
  const bodies = [
    { command: 'smoke', args: ['--help'] },
    { command: 'coverage', path: '/etc' },
    { command: 'smoke', cwd: '/' },
    { command: 'smoke', env: { PATH: '/tmp' } },
    { id: 'smoke' },
    {},
    ['smoke'],
    'smoke',
  ]
  for (const body of bodies) assert.equal((await post(body)).status, 400, JSON.stringify(body))
  assert.equal((await route.POST({ json: async () => { throw new SyntaxError('bad json') } })).status, 400)
  assert.deepEqual(state.runs, [])
})

test('admins can run an allowlisted command and the run is audited', async () => {
  state.user = admin
  state.runs = []
  state.audits = []
  const res = await post({ command: 'smoke' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'pass')
  assert.deepEqual(state.runs, ['smoke'])
  assert.equal(state.audits[0].event, 'test_run')
  assert.equal(state.audits[0].tool, 'smoke')
})

// ── Runner: fixed args, execFile options, status mapping, output caps ───────

const ROOT = path.resolve('/repo/ghostforge')
const deps = { root: ROOT, node: '/usr/bin/node', exists: () => true, env: { PATH: '/usr/bin', HOME: '/home/u', GEMINI_API_KEY: 'AIza-should-not-leak', GITHUB_TOKEN: 'ghp_x' } }

function fakeExec(calls, reply = { error: null, stdout: 'ok', stderr: '' }) {
  return (file, args, options, cb) => {
    calls.push({ file, args, options })
    setImmediate(() => cb(reply.error, reply.stdout, reply.stderr))
  }
}

test('only the smoke and coverage commands are allowlisted', () => {
  assert.deepEqual(runner.TEST_COMMANDS.map(c => c.id), ['smoke', 'coverage'])
  for (const id of ['npm', 'shell', 'bash', 'install', '__proto__', 'constructor']) assert.equal(runner.isTestCommandId(id), false, id)
})

test('each command runs via execFile with fixed args, no shell, a timeout and a scrubbed env', async () => {
  for (const c of runner.TEST_COMMANDS) {
    const calls = []
    const result = await runner.runTestCommand(c.id, { ...deps, exec: fakeExec(calls) })
    assert.equal(result.status, 'pass')
    assert.equal(calls.length, 1)
    const [{ file, args, options }] = calls
    assert.equal(file, '/usr/bin/node')
    assert.deepEqual(args, c.args(ROOT))
    assert.equal(options.cwd, ROOT)
    assert.equal(options.shell, false)
    assert.equal(options.timeout, runner.TEST_TIMEOUT_MS)
    assert.ok(options.timeout > 0 && options.timeout <= 300_000)
    assert.ok(options.maxBuffer > 0)
    assert.equal(options.env.GEMINI_API_KEY, undefined)
    assert.equal(options.env.GITHUB_TOKEN, undefined)
    assert.equal(options.env.PATH, '/usr/bin')
  }
})

test('smoke runs scripts/test.js against the server-resolved root', () => {
  const smoke = runner.TEST_COMMANDS.find(c => c.id === 'smoke')
  assert.deepEqual(smoke.args(ROOT), [path.join(ROOT, 'scripts', 'test.js')])
})

test('a missing test script reports unavailable without executing', async () => {
  const calls = []
  const result = await runner.runTestCommand('smoke', { ...deps, exists: () => false, exec: fakeExec(calls) })
  assert.equal(result.status, 'unavailable')
  assert.equal(calls.length, 0)
  assert.deepEqual(runner.listTestCommands({ root: ROOT, exists: () => false }).map(c => c.available), [false, false])
})

test('pass, fail, timeout and overflow are reported distinctly', async () => {
  const fail = await runner.runTestCommand('smoke', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: '1 failing', stderr: '' }) })
  assert.equal(fail.status, 'fail')
  assert.equal(fail.exitCode, 1)
  const timeout = await runner.runTestCommand('smoke', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', code: null }), stdout: '', stderr: '' }) })
  assert.equal(timeout.status, 'timeout')
  const overflow = await runner.runTestCommand('coverage', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' }), stdout: 'x', stderr: '' }) })
  assert.equal(overflow.status, 'error')
})

test('output is ANSI-stripped, redacted and capped', async () => {
  const raw = ['\x1b[32mpass\x1b[0m', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'a'.repeat(scanners.MAX_OUTPUT_CHARS + 500)].join('\n')
  const r = await runner.runTestCommand('smoke', { ...deps, exec: fakeExec([], { error: null, stdout: raw, stderr: '' }) })
  assert.doesNotMatch(r.output, /\x1b/)
  assert.ok(!r.output.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
  assert.equal(r.truncated, true)
  assert.ok(r.output.length < scanners.MAX_OUTPUT_CHARS + 100)
})

// ── Page ─────────────────────────────────────────────────────────────────────

test('testing page is admin-gated, labelled and uses logical utilities', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.match(page, /status === 403/)
  assert.match(page, /JSON\.stringify\(\{ command: command\.id \}\)/)
  assert.match(page, /aria-label=\{`Run \$\{command\.label\}`\}/)
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr|left|right)-\d|\btext-(?:left|right)\b/)
  const access = fs.readFileSync(path.resolve(__dirname, '../lib/title-profiles.ts'), 'utf8')
  assert.match(access, /path: '\/testing',[^\n]*permission: 'admin'/)
  const mw = fs.readFileSync(path.resolve(__dirname, '../middleware.ts'), 'utf8')
  assert.match(mw, /'\/testing'/)
  assert.match(mw, /'\/testing\/:path\*'/)
})
