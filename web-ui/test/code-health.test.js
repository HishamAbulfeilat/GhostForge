const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routeDir = path.resolve(__dirname, '../app/api/code-health')
const scanDir = path.resolve(__dirname, '../app/api/security-scan')
const pagePath = path.resolve(__dirname, '../app/code-health/page.tsx')

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
  // Real hosted-mode policy: off unless GHOSTFORGE_MODE=hosted
  '@/lib/hosted': require('../lib/hosted.ts'),
  '@/lib/auth': {
    getCurrentUser: async () => state.user,
    isAdmin: user => user?.role === 'admin',
  },
  '@/lib/audit': { auditLog: async entry => { state.audits.push(entry) } },
  './runner': {
    isHealthCommandId: runner.isHealthCommandId,
    listHealthCommands: () => runner.HEALTH_COMMANDS.map(c => ({ id: c.id, available: true })),
    runHealthCommand: async id => {
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
  assert.equal((await post({ script: 'bundle' })).status, 401)
  assert.deepEqual(state.runs, [])
})

test('non-admin users get 403 even with broad permissions', async () => {
  state.user = limited
  state.runs = []
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await post({ script: 'bundle' })).status, 403)
  assert.deepEqual(state.runs, [])
})

test('admins can list scripts', async () => {
  state.user = admin
  const res = await route.GET({})
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).commands.map(c => c.id), ['perf', 'bundle', 'unused', 'dep-health'])
})

test('POST rejects unknown script ids, args, paths and extra fields', async () => {
  state.user = admin
  state.runs = []
  for (const script of ['rm', 'bash', 'npm test', '../scripts/perf.sh', 'scripts/perf.sh', 'perf; id', '', 42, null, '__proto__', 'security-check']) {
    assert.equal((await post({ script })).status, 400, `script ${JSON.stringify(script)}`)
  }
  const bodies = [
    { script: 'perf', args: ['--help'] },
    { script: 'unused', fix: true },
    { script: 'bundle', path: '/etc' },
    { script: 'dep-health', env: { PATH: '/tmp' } },
    { command: 'perf' },
    {},
    ['perf'],
    'perf',
  ]
  for (const body of bodies) assert.equal((await post(body)).status, 400, JSON.stringify(body))
  assert.equal((await route.POST({ json: async () => { throw new SyntaxError('bad json') } })).status, 400)
  assert.deepEqual(state.runs, [])
})

test('admins can run an allowlisted script and the run is audited', async () => {
  state.user = admin
  state.runs = []
  state.audits = []
  const res = await post({ script: 'dep-health' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'pass')
  assert.deepEqual(state.runs, ['dep-health'])
  assert.equal(state.audits[0].event, 'code_health_run')
  assert.equal(state.audits[0].tool, 'dep-health')
})

// ── Runner: fixed argv, execFile options, status mapping, output caps ───────

const ROOT = path.resolve('/repo/ghostforge')
const deps = { root: ROOT, bash: '/bin/bash', exists: () => true, env: { PATH: '/usr/bin', HOME: '/home/u', GEMINI_API_KEY: 'AIza-should-not-leak', GITHUB_TOKEN: 'ghp_x' } }

function fakeExec(calls, reply = { error: null, stdout: 'ok', stderr: '' }) {
  return (file, args, options, cb) => {
    calls.push({ file, args, options })
    setImmediate(() => cb(reply.error, reply.stdout, reply.stderr))
  }
}

test('only perf, bundle, unused and dep-health are allowlisted', () => {
  assert.deepEqual(runner.HEALTH_COMMANDS.map(c => c.id), ['perf', 'bundle', 'unused', 'dep-health'])
  for (const id of ['npm', 'shell', 'bash', 'install', 'security-check', '__proto__', 'constructor']) assert.equal(runner.isHealthCommandId(id), false, id)
  for (const c of runner.HEALTH_COMMANDS) assert.match(c.script, /^scripts\/(perf|bundle|unused|dep-health)\.sh$/)
})

test('only allowlisted scripts execute: bash + repo script + fixed args, no shell, timeout, scrubbed env', async () => {
  const expected = {
    perf: ['scripts/perf.sh', 'http://localhost:3000', 'desktop', 'json'],
    bundle: ['scripts/bundle.sh', 'track', 'web-ui'],
    unused: ['scripts/unused.sh'],
    'dep-health': ['scripts/dep-health.sh', 'full'],
  }
  for (const c of runner.HEALTH_COMMANDS) {
    const calls = []
    const result = await runner.runHealthCommand(c.id, { ...deps, exec: fakeExec(calls) })
    assert.equal(result.status, 'pass')
    assert.equal(calls.length, 1)
    const [{ file, args, options }] = calls
    assert.equal(file, '/bin/bash')
    const [script, ...rest] = expected[c.id]
    assert.deepEqual(args, [path.join(ROOT, script), ...rest])
    assert.ok(!args.includes('--fix'))
    assert.equal(options.cwd, ROOT)
    assert.equal(options.shell, false)
    assert.equal(options.timeout, runner.HEALTH_TIMEOUT_MS)
    assert.ok(options.timeout > 0 && options.timeout <= 300_000)
    assert.ok(options.maxBuffer > 0)
    assert.equal(options.env.GEMINI_API_KEY, undefined)
    assert.equal(options.env.GITHUB_TOKEN, undefined)
    assert.equal(options.env.PATH, '/usr/bin')
  }
})

test('runHealthCommand never executes an id outside the allowlist', async () => {
  const calls = []
  for (const id of ['rm', '../x', '__proto__', 'bash']) {
    assert.throws(() => runner.runHealthCommand(id, { ...deps, exec: fakeExec(calls) }), /Unknown code-health command/)
  }
  assert.equal(calls.length, 0)
})

test('a missing script reports unavailable without executing', async () => {
  const calls = []
  const result = await runner.runHealthCommand('perf', { ...deps, exists: () => false, exec: fakeExec(calls) })
  assert.equal(result.status, 'unavailable')
  assert.equal(calls.length, 0)
  assert.deepEqual(runner.listHealthCommands({ root: ROOT, exists: () => false }).map(c => c.available), [false, false, false, false])
})

test('pass, fail, timeout and overflow are reported distinctly', async () => {
  const fail = await runner.runHealthCommand('unused', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: 'found', stderr: '' }) })
  assert.equal(fail.status, 'fail')
  assert.equal(fail.exitCode, 1)
  const timeout = await runner.runHealthCommand('perf', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', code: null }), stdout: '', stderr: '' }) })
  assert.equal(timeout.status, 'timeout')
  const overflow = await runner.runHealthCommand('bundle', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' }), stdout: 'x', stderr: '' }) })
  assert.equal(overflow.status, 'error')
})

test('output is ANSI-stripped, redacted and capped', async () => {
  const raw = ['\x1b[32mok\x1b[0m', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'a'.repeat(scanners.MAX_OUTPUT_CHARS + 500)].join('\n')
  const r = await runner.runHealthCommand('dep-health', { ...deps, exec: fakeExec([], { error: null, stdout: raw, stderr: '' }) })
  assert.doesNotMatch(r.output, /\x1b/)
  assert.ok(!r.output.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
  assert.equal(r.truncated, true)
})

// ── Page + middleware ────────────────────────────────────────────────────────

test('code-health page is admin-gated, has main + h1 and uses logical utilities', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.match(page, /status === 403/)
  assert.match(page, /JSON\.stringify\(\{ script: command\.id \}\)/)
  assert.match(page, /<main\b/)
  assert.match(page, /<h1\b/)
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr|left|right)-\d|\btext-(?:left|right)\b/)
  const mw = fs.readFileSync(path.resolve(__dirname, '../middleware.ts'), 'utf8')
  for (const p of ['/code-health', '/api/code-health']) {
    assert.ok(mw.includes(`'${p}',`), `${p} in PROTECTED_PREFIXES`)
    assert.ok(mw.includes(`'${p}/:path*'`), `${p} in matcher`)
  }
})
