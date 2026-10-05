const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routeDir = path.resolve(__dirname, '../app/api/security-scan')
const pagePath = path.resolve(__dirname, '../app/security/page.tsx')

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

const scanners = loadTs(path.join(routeDir, 'scanners.ts'))

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
  './scanners': {
    isScannerId: scanners.isScannerId,
    listScanners: () => scanners.SCANNERS.map(s => ({ id: s.id, installed: false })),
    runScanner: async id => {
      state.runs.push(id)
      return { id, status: 'ok', exitCode: 0, durationMs: 1, output: 'clean', truncated: false }
    },
  },
})

const post = body => route.POST({ json: async () => (typeof body === 'string' ? JSON.parse(body) : body) })
const admin = { id: 'a1', username: 'owner', role: 'admin', permissions: ['*'] }
const limited = { id: 'u1', username: 'guest', role: 'user', permissions: ['chat', 'terminal', 'admin_tools'] }

test('unauthenticated callers get 401 and nothing runs', async () => {
  state.user = null
  state.runs = []
  assert.equal((await route.GET({})).status, 401)
  assert.equal((await post({ scanner: 'gitleaks' })).status, 401)
  assert.deepEqual(state.runs, [])
})

test('non-admin users get 403 even with broad permissions', async () => {
  state.user = limited
  state.runs = []
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await post({ scanner: 'security-check' })).status, 403)
  assert.deepEqual(state.runs, [])
})

test('admins can list scanners', async () => {
  state.user = admin
  const res = await route.GET({})
  assert.equal(res.status, 200)
  const { scanners: list } = await res.json()
  assert.deepEqual(list.map(s => s.id), ['security-check', 'gitleaks', 'osv-scanner', 'semgrep'])
})

test('POST rejects unknown or offensive scanners', async () => {
  state.user = admin
  state.runs = []
  for (const scanner of ['nmap', 'sqlmap', 'pentest', '../scripts/pentest.sh', 'bash', '', 42, null]) {
    assert.equal((await post({ scanner })).status, 400, `scanner ${JSON.stringify(scanner)}`)
  }
  assert.deepEqual(state.runs, [])
})

test('POST rejects user-supplied args, paths and extra fields', async () => {
  state.user = admin
  state.runs = []
  const bodies = [
    { scanner: 'gitleaks', args: ['--source', '/etc'] },
    { scanner: 'semgrep', path: 'C:\\Windows' },
    { scanner: 'osv-scanner', cwd: '/' },
    { scanner: 'security-check', env: { PATH: '/tmp' } },
    { id: 'gitleaks' },
    {},
    ['gitleaks'],
    'gitleaks',
  ]
  for (const body of bodies) assert.equal((await post(body)).status, 400, JSON.stringify(body))
  const bad = await route.POST({ json: async () => { throw new SyntaxError('bad json') } })
  assert.equal(bad.status, 400)
  assert.deepEqual(state.runs, [])
})

test('admins can run an allowlisted scanner and the run is audited', async () => {
  state.user = admin
  state.runs = []
  state.audits = []
  const res = await post({ scanner: 'gitleaks' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'ok')
  assert.deepEqual(state.runs, ['gitleaks'])
  assert.equal(state.audits[0].event, 'security_scan')
  assert.equal(state.audits[0].tool, 'gitleaks')
})

// ── Runner: fixed args, execFile options, not-installed, redaction ──────────

const ROOT = path.resolve('/repo/ghostforge')
const allInstalled = { root: ROOT, which: b => `/usr/bin/${b}`, exists: () => true, env: { PATH: '/usr/bin', HOME: '/home/u', GEMINI_API_KEY: 'AIza-should-not-leak', GITHUB_TOKEN: 'ghp_x' } }

function fakeExec(calls, reply = { error: null, stdout: 'ok', stderr: '' }) {
  return (file, args, options, cb) => {
    calls.push({ file, args, options })
    setImmediate(() => cb(reply.error, reply.stdout, reply.stderr))
  }
}

test('only defensive scanners are allowlisted', () => {
  assert.deepEqual(scanners.SCANNERS.map(s => s.id), ['security-check', 'gitleaks', 'osv-scanner', 'semgrep'])
  for (const id of ['nmap', 'sqlmap', 'nikto', 'ffuf', 'amass', 'zap', 'pentest', 'hackingtool', '__proto__', 'constructor']) {
    assert.equal(scanners.isScannerId(id), false, id)
  }
  assert.doesNotMatch(fs.readFileSync(path.join(routeDir, 'scanners.ts'), 'utf8'), /pentest\.sh/)
})

test('each scanner runs via execFile with fixed args, no shell, a timeout and a scrubbed env', async () => {
  for (const s of scanners.SCANNERS) {
    const calls = []
    const result = await scanners.runScanner(s.id, { ...allInstalled, exec: fakeExec(calls) })
    assert.equal(result.status, 'ok')
    assert.equal(calls.length, 1)
    const [{ file, args, options }] = calls
    assert.equal(file, `/usr/bin/${s.binary}`)
    assert.deepEqual(args, s.args(ROOT))
    assert.equal(options.cwd, ROOT)
    assert.equal(options.shell, false)
    assert.equal(options.timeout, scanners.SCAN_TIMEOUT_MS)
    assert.ok(options.timeout > 0 && options.timeout <= 300_000)
    assert.ok(options.maxBuffer > 0)
    assert.equal(options.env.GEMINI_API_KEY, undefined)
    assert.equal(options.env.GITHUB_TOKEN, undefined)
    assert.equal(options.env.PATH, '/usr/bin')
  }
})

test('security-check runs scripts/security-check.sh against the server-resolved root', () => {
  const s = scanners.SCANNERS.find(x => x.id === 'security-check')
  assert.equal(s.binary, 'bash')
  assert.deepEqual(s.args(ROOT), [path.join(ROOT, 'scripts', 'security-check.sh'), ROOT])
})

test('a missing binary or script reports not_installed without executing', async () => {
  const calls = []
  const missing = await scanners.runScanner('semgrep', { ...allInstalled, which: () => null, exec: fakeExec(calls) })
  assert.equal(missing.status, 'not_installed')
  assert.match(missing.installHint, /Semgrep/)
  const noScript = await scanners.runScanner('security-check', { ...allInstalled, exists: () => false, exec: fakeExec(calls) })
  assert.equal(noScript.status, 'not_installed')
  assert.equal(calls.length, 0)

  const list = scanners.listScanners({ root: ROOT, which: b => (b === 'gitleaks' ? '/x/gitleaks' : null), exists: () => true })
  assert.deepEqual(list.map(s => [s.id, s.installed]), [['security-check', false], ['gitleaks', true], ['osv-scanner', false], ['semgrep', false]])
})

test('timeouts and non-zero exits are reported distinctly', async () => {
  const timeout = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', code: null })
  const t = await scanners.runScanner('gitleaks', { ...allInstalled, exec: fakeExec([], { error: timeout, stdout: '', stderr: '' }) })
  assert.equal(t.status, 'timeout')
  const findings = Object.assign(new Error('exit 1'), { code: 1 })
  const f = await scanners.runScanner('osv-scanner', { ...allInstalled, exec: fakeExec([], { error: findings, stdout: '3 vulns', stderr: '' }) })
  assert.equal(f.status, 'findings')
  assert.equal(f.exitCode, 1)
  const overflow = Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' })
  const o = await scanners.runScanner('semgrep', { ...allInstalled, exec: fakeExec([], { error: overflow, stdout: 'x', stderr: '' }) })
  assert.equal(o.status, 'error')
})

test('output is ANSI-stripped, secrets are redacted and long output is truncated', async () => {
  const secrets = [
    'AKIAABCDEFGHIJKLMNOP',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    'AIzaSyA-abcdefghijklmnopqrstuvwxyz012345',
    'xoxb-1234567890-abcdefghij',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ]
  const raw = [
    '\x1b[31mFinding\x1b[0m',
    ...secrets,
    'Authorization: Bearer abcdef0123456789abcdef',
    'DB_PASSWORD=hunter2hunter2',
    'api_key: "supersecretvalue"',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
  ].join('\n')
  const r = await scanners.runScanner('gitleaks', { ...allInstalled, exec: fakeExec([], { error: null, stdout: raw, stderr: '' }) })
  assert.doesNotMatch(r.output, /\x1b/)
  assert.match(r.output, /^Finding/)
  for (const s of [...secrets, 'abcdef0123456789abcdef', 'hunter2hunter2', 'supersecretvalue', 'MIIEow']) {
    assert.ok(!r.output.includes(s), `leaked ${s}`)
  }
  assert.match(r.output, /Bearer \[REDACTED\]/)
  assert.match(r.output, /DB_PASSWORD=\[REDACTED\]/)

  const big = await scanners.runScanner('semgrep', { ...allInstalled, exec: fakeExec([], { error: null, stdout: 'a'.repeat(scanners.MAX_OUTPUT_CHARS + 500), stderr: '' }) })
  assert.equal(big.truncated, true)
  assert.ok(big.output.length < scanners.MAX_OUTPUT_CHARS + 100)
  assert.match(big.output, /output truncated \(500 more characters\)/)
})

test('PATH lookup skips .cmd shims and the WSL bash launcher on Windows', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gf-scan-'))
  try {
    const sys32 = path.join(tmp, 'Windows', 'System32')
    const shims = path.join(tmp, 'npm')
    fs.mkdirSync(sys32, { recursive: true })
    fs.mkdirSync(shims)
    fs.writeFileSync(path.join(sys32, 'bash.exe'), '')
    fs.writeFileSync(path.join(shims, 'semgrep.cmd'), '')
    const env = { PATH: [sys32, shims].join(path.delimiter) }
    if (process.platform === 'win32') {
      assert.equal(scanners.findOnPath('bash', env, 'win32'), null)
      assert.equal(scanners.findOnPath('semgrep', env, 'win32'), null)
    }
    fs.writeFileSync(path.join(shims, 'gitleaks' + (process.platform === 'win32' ? '.exe' : '')), '')
    assert.equal(scanners.findOnPath('gitleaks', env), path.join(shims, 'gitleaks' + (process.platform === 'win32' ? '.exe' : '')))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ── Page ─────────────────────────────────────────────────────────────────────

test('security page is admin-gated, shows not-installed states and uses logical utilities', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.match(page, /status === 403/)
  assert.match(page, /Not installed/)
  assert.match(page, /JSON\.stringify\(\{ scanner: scanner\.id \}\)/)
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr|left|right)-\d|\btext-(?:left|right)\b/)
  const access = fs.readFileSync(path.resolve(__dirname, '../lib/title-profiles.ts'), 'utf8')
  assert.match(access, /path: '\/security',[^\n]*permission: 'admin'/)
})
