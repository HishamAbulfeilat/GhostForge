const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routeDir = path.resolve(__dirname, '../app/api/tickets')
const scanDir = path.resolve(__dirname, '../app/api/security-scan')
const pagePath = path.resolve(__dirname, '../app/tickets/page.tsx')

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
    getTicketCommand: runner.getTicketCommand,
    isTicketCommandId: runner.isTicketCommandId,
    validateTicketInput: runner.validateTicketInput,
    listTicketCommands: () => runner.TICKET_COMMANDS.map(c => ({ id: c.id, available: true })),
    runTicketCommand: async (id, input) => {
      state.runs.push([id, input])
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
  assert.equal((await post({ command: 'ado-status' })).status, 401)
  assert.deepEqual(state.runs, [])
})

test('non-admin users get 403 even with broad permissions', async () => {
  state.user = limited
  state.runs = []
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await post({ command: 'ado-status' })).status, 403)
  assert.deepEqual(state.runs, [])
})

test('admins can list commands', async () => {
  state.user = admin
  const res = await route.GET({})
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).commands.map(c => c.id), ['ticket', 'ado-status', 'ado-tickets', 'ado-pipelines', 'estimate'])
})

test('POST rejects unknown commands, extra fields and bad input', async () => {
  state.user = admin
  state.runs = []
  for (const command of ['rm', 'bash', 'ado.sh', '../scripts/ado.sh', 'ado-status; id', '', 42, null, '__proto__', 'ado-releases', 'ado-config']) {
    assert.equal((await post({ command })).status, 400, `command ${JSON.stringify(command)}`)
  }
  const bodies = [
    { command: 'ado-status', args: ['config'] },
    { command: 'ado-status', input: 'x' },
    { command: 'ado-tickets', input: '--help' },
    { command: 'estimate', input: 'ok', path: '/etc' },
    { command: 'ticket' },
    { command: 'ticket', input: 'PROJ-123; id' },
    { command: 'ticket', input: '../../etc' },
    { command: 'ticket', input: 'PROJ-123\nrm' },
    { command: 'ticket', input: 42 },
    { command: 'estimate' },
    { command: 'estimate', input: '' },
    { command: 'estimate', input: '--path=/etc' },
    { command: 'estimate', input: 'line one\nline two' },
    { command: 'estimate', input: 'x'.repeat(runner.MAX_DESCRIPTION_CHARS + 1) },
    { input: 'PROJ-1' },
    {},
    ['ticket'],
    'ticket',
  ]
  for (const body of bodies) assert.equal((await post(body)).status, 400, JSON.stringify(body))
  assert.equal((await route.POST({ json: async () => { throw new SyntaxError('bad json') } })).status, 400)
  assert.deepEqual(state.runs, [])
})

test('admins can run allowlisted commands and runs are audited', async () => {
  state.user = admin
  state.runs = []
  state.audits = []
  assert.equal((await post({ command: 'ado-pipelines' })).status, 200)
  assert.equal((await post({ command: 'ticket', input: ' proj-123 '.replace('proj', 'PROJ') })).status, 200)
  assert.equal((await post({ command: 'estimate', input: 'Add dark mode to settings' })).status, 200)
  assert.deepEqual(state.runs, [['ado-pipelines', undefined], ['ticket', 'PROJ-123'], ['estimate', 'Add dark mode to settings']])
  assert.equal(state.audits[0].event, 'tickets_run')
  assert.equal(state.audits[0].tool, 'ado-pipelines')
  assert.ok(state.audits.every(a => !JSON.stringify(a).includes('dark mode')))
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

test('only ticket, ado status/tickets/pipelines and estimate are allowlisted', () => {
  assert.deepEqual(runner.TICKET_COMMANDS.map(c => c.id), ['ticket', 'ado-status', 'ado-tickets', 'ado-pipelines', 'estimate'])
  for (const id of ['npm', 'shell', 'bash', 'ado-config', 'ado-releases', '__proto__', 'constructor']) assert.equal(runner.isTicketCommandId(id), false, id)
  for (const c of runner.TICKET_COMMANDS) assert.match(c.script, /^scripts\/(ticket|ado|estimate)\.sh$/)
})

test('only allowlisted scripts execute: bash + repo script + fixed args + validated input, no shell, timeout, scrubbed env', async () => {
  const expected = {
    ticket: [['scripts/ticket.sh', 'PROJ-123'], 'PROJ-123'],
    'ado-status': [['scripts/ado.sh', 'status']],
    'ado-tickets': [['scripts/ado.sh', 'tickets']],
    'ado-pipelines': [['scripts/ado.sh', 'pipelines']],
    estimate: [['scripts/estimate.sh', 'Add dark mode'], 'Add dark mode'],
  }
  for (const c of runner.TICKET_COMMANDS) {
    const calls = []
    const [argv, input] = expected[c.id]
    const result = await runner.runTicketCommand(c.id, input, { ...deps, exec: fakeExec(calls) })
    assert.equal(result.status, 'pass')
    assert.equal(calls.length, 1)
    const [{ file, args, options }] = calls
    assert.equal(file, '/bin/bash')
    const [script, ...rest] = argv
    assert.deepEqual(args, [path.join(ROOT, script), ...rest])
    assert.equal(options.cwd, ROOT)
    assert.equal(options.shell, false)
    assert.equal(options.timeout, runner.TICKET_TIMEOUT_MS)
    assert.ok(options.timeout > 0 && options.timeout <= 300_000)
    assert.ok(options.maxBuffer > 0)
    assert.equal(options.env.GEMINI_API_KEY, undefined)
    assert.equal(options.env.GITHUB_TOKEN, undefined)
    assert.equal(options.env.PATH, '/usr/bin')
  }
})

test('runTicketCommand never executes an unknown id or unvalidated input', async () => {
  const calls = []
  for (const id of ['rm', '../x', '__proto__', 'bash']) {
    assert.throws(() => runner.runTicketCommand(id, undefined, { ...deps, exec: fakeExec(calls) }), /Unknown ticket command/)
  }
  assert.throws(() => runner.runTicketCommand('ticket', '$(id)', { ...deps, exec: fakeExec(calls) }), /Ticket id/)
  assert.throws(() => runner.runTicketCommand('estimate', '--path=/etc', { ...deps, exec: fakeExec(calls) }), /must not start/)
  assert.throws(() => runner.runTicketCommand('ado-status', 'extra', { ...deps, exec: fakeExec(calls) }), /does not take input/)
  assert.equal(calls.length, 0)
})

test('a missing script reports unavailable without executing', async () => {
  const calls = []
  const result = await runner.runTicketCommand('ado-status', undefined, { ...deps, exists: () => false, exec: fakeExec(calls) })
  assert.equal(result.status, 'unavailable')
  assert.equal(calls.length, 0)
  assert.deepEqual(runner.listTicketCommands({ root: ROOT, exists: () => false }).map(c => c.available), [false, false, false, false, false])
})

test('pass, fail, timeout and overflow are reported distinctly', async () => {
  const fail = await runner.runTicketCommand('ado-status', undefined, { ...deps, exec: fakeExec([], { error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: 'found', stderr: '' }) })
  assert.equal(fail.status, 'fail')
  assert.equal(fail.exitCode, 1)
  const timeout = await runner.runTicketCommand('ado-tickets', undefined, { ...deps, exec: fakeExec([], { error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', code: null }), stdout: '', stderr: '' }) })
  assert.equal(timeout.status, 'timeout')
  const overflow = await runner.runTicketCommand('ado-pipelines', undefined, { ...deps, exec: fakeExec([], { error: Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' }), stdout: 'x', stderr: '' }) })
  assert.equal(overflow.status, 'error')
})

test('output is ANSI-stripped, redacted and capped', async () => {
  const raw = ['\x1b[32mok\x1b[0m', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'a'.repeat(scanners.MAX_OUTPUT_CHARS + 500)].join('\n')
  const r = await runner.runTicketCommand('ado-tickets', undefined, { ...deps, exec: fakeExec([], { error: null, stdout: raw, stderr: '' }) })
  assert.doesNotMatch(r.output, /\x1b/)
  assert.ok(!r.output.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
  assert.equal(r.truncated, true)
})

// ── Wiring: page, middleware, access ─────────────────────────────────────────

test('page uses logical utilities only and the middleware locks the routes', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr)-\d|text-(?:left|right)\b|dangerouslySetInnerHTML/)
  const mw = fs.readFileSync(path.resolve(__dirname, '../middleware.ts'), 'utf8')
  for (const p of ["'/tickets'", "'/api/tickets'", "'/tickets/:path*'", "'/api/tickets/:path*'"]) assert.ok(mw.includes(p), p)
  const access = fs.readFileSync(path.resolve(__dirname, '../lib/title-profiles.ts'), 'utf8')
  assert.match(access, /path: '\/tickets'.*permission: 'admin'/)
})
