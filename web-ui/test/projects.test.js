// T-229: the admin-only /projects panel.
//
// Covers the route's auth boundary, the request allow-list, the fixed-argv
// execFile invocation, the registered-project list, and — the part that can
// silently rot — that the answer sequence we feed create-project.sh still selects
// the template it claims. The last test runs the REAL script; it is what catches
// a reworded prompt shifting every later answer into the wrong slot.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const routeDir = path.resolve(__dirname, '../app/api/projects')
const scanDir = path.resolve(__dirname, '../app/api/security-scan')
const pagePath = path.resolve(__dirname, '../app/projects/page.tsx')
const repoRoot = path.resolve(__dirname, '../..')

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

const state = { user: null, scaffolds: [], audits: [] }
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
    TEMPLATES: runner.TEMPLATES,
    getTemplate: runner.getTemplate,
    isTemplateId: runner.isTemplateId,
    listProjects: () => [],
    validateProjectName: runner.validateProjectName,
    runScaffold: async (template, name) => {
      state.scaffolds.push([template, name])
      return { status: 'pass', template, projectPath: `/repo/${name}`, exitCode: 0, durationMs: 1, output: 'ok', truncated: false }
    },
  },
})

const post = body => route.POST({ json: async () => body })
const admin = { id: 'a1', username: 'owner', role: 'admin', permissions: ['*'] }
const limited = { id: 'u1', username: 'guest', role: 'user', permissions: ['chat', 'terminal', 'admin_tools'] }

test('unauthenticated callers get 401 and nothing scaffolds', async () => {
  state.user = null
  state.scaffolds = []
  assert.equal((await route.GET({})).status, 401)
  assert.equal((await post({ template: 'nextjs', name: 'demo' })).status, 401)
  assert.deepEqual(state.scaffolds, [])
})

test('non-admin users get 403 even with broad permissions', async () => {
  state.user = limited
  state.scaffolds = []
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await post({ template: 'nextjs', name: 'demo' })).status, 403)
  assert.deepEqual(state.scaffolds, [])
})

test('admins can list the registered projects and the templates', async () => {
  state.user = admin
  const res = await route.GET({})
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.projects, [])
  assert.deepEqual(body.templates.map(t => t.id), ['nextjs', 'react-vite', 'react-native', 'nestjs'])
})

test('POST rejects unknown templates, extra fields and unsafe names', async () => {
  state.user = admin
  state.scaffolds = []
  for (const template of ['bash', '../scripts/create-project.sh', 'nextjs; id', '', 42, null, '__proto__', 'constructor', 'toString']) {
    assert.equal((await post({ template, name: 'demo' })).status, 400, `template ${JSON.stringify(template)}`)
  }
  const bodies = [
    { template: 'nextjs' },
    { name: 'demo' },
    { template: 'nextjs', name: 'demo', path: '/etc' },
    { template: 'nextjs', name: 'demo', args: ['--yes'] },
    { template: 'nextjs', name: '../escape' },
    { template: 'nextjs', name: 'a/b' },
    { template: 'nextjs', name: 'a\\b' },
    { template: 'nextjs', name: '..' },
    { template: 'nextjs', name: '--flag' },
    { template: 'nextjs', name: 'demo\nrm -rf /' },
    { template: 'nextjs', name: 'demo $(id)' },
    { template: 'nextjs', name: '' },
    { template: 'nextjs', name: 42 },
    { template: 'nextjs', name: 'x'.repeat(runner.MAX_NAME_LENGTH + 1) },
    { template: 'nextjs', name: 'demo; rm -rf /' },
    {},
    ['nextjs'],
    'nextjs',
  ]
  for (const body of bodies) assert.equal((await post(body)).status, 400, JSON.stringify(body))
  assert.equal((await route.POST({ json: async () => { throw new SyntaxError('bad json') } })).status, 400)
  assert.deepEqual(state.scaffolds, [], 'nothing may scaffold for a rejected request')
})

test('admins can scaffold and the run is audited', async () => {
  state.user = admin
  state.scaffolds = []
  state.audits = []
  assert.equal((await post({ template: 'nextjs', name: 'demo-app' })).status, 200)
  assert.deepEqual(state.scaffolds, [['nextjs', 'demo-app']])
  assert.equal(state.audits[0].event, 'project_scaffold')
  assert.equal(state.audits[0].tool, 'nextjs')
})

// ── Runner: argv, name validation, registry ────────────────────────────────

const ROOT = '/repo/ghostforge'
const deps = {
  root: ROOT,
  bash: '/bin/bash',
  exists: () => true,
  env: { PATH: '/usr/bin', HOME: '/home/u', GITHUB_TOKEN: 'ghp_x', OPENAI_API_KEY: 'sk-x' },
}

function fakeExec(calls, reply = { error: null, stdout: 'ok', stderr: '' }) {
  return (file, args, options, cb) => {
    calls.push({ file, args, options })
    const child = { stdin: { on() {}, end() {} } }
    setImmediate(() => cb(reply.error, reply.stdout, reply.stderr))
    return child
  }
}

test('only the four templates are allowlisted', () => {
  assert.deepEqual(runner.TEMPLATES.map(t => t.id), ['nextjs', 'react-vite', 'react-native', 'nestjs'])
  for (const id of ['bash', 'sh', 'next', '__proto__', 'constructor', 'toString', 'react_native', 'NESTJS']) {
    assert.equal(runner.isTemplateId(id), false, id)
  }
  assert.throws(() => runner.getTemplate('bash'), /Unknown project template/)
})

test('project names must be a single plain folder name', () => {
  assert.deepEqual(runner.validateProjectName('demo-app'), { value: 'demo-app' })
  assert.deepEqual(runner.validateProjectName('  demo-app  '), { value: 'demo-app' })
  assert.deepEqual(runner.validateProjectName('demo.app_2'), { value: 'demo.app_2' })
  for (const bad of ['', '   ', '..', '.', '../x', 'a/b', 'a\\b', '/abs', '-x', '--flag', 'a b', 'a$b', 'a`id`', 'a$(id)', 'a\nb', 'a;rm', 42, null, undefined, {}, 'x'.repeat(200)]) {
    assert.ok(runner.validateProjectName(bad).error, `expected rejection for ${JSON.stringify(bad)}`)
  }
})

test('the scaffolder runs bash with a fixed argv, no shell, a timeout and a scrubbed env', async () => {
  const calls = []
  const result = await runner.runScaffold('nextjs', 'demo-app', { ...deps, exec: fakeExec(calls) })
  assert.equal(result.status, 'pass')
  assert.equal(calls.length, 1)
  const [{ file, args, options }] = calls
  assert.equal(file, '/bin/bash')
  // The only argv entry is the server-resolved script; the name never reaches a command line.
  assert.deepEqual(args, [path.join(ROOT, 'scripts/create-project.sh')])
  assert.equal(options.cwd, ROOT)
  assert.equal(options.shell, false)
  assert.equal(options.timeout, runner.SCAFFOLD_TIMEOUT_MS)
  assert.ok(options.timeout > 0 && options.timeout <= 600_000)
  assert.ok(options.maxBuffer > 0)
  assert.equal(options.env.GITHUB_TOKEN, undefined)
  assert.equal(options.env.OPENAI_API_KEY, undefined)
  assert.equal(options.env.PATH, '/usr/bin')
})

test('the project name is delivered on stdin, never on the command line', async () => {
  const calls = []
  let written = null
  const exec = (file, args, options, cb) => {
    calls.push({ file, args, options })
    const child = { stdin: { on() {}, end(data) { written = data } } }
    setImmediate(() => cb(null, 'ok', ''))
    return child
  }
  await runner.runScaffold('nestjs', 'demo-app', { ...deps, exec })
  assert.equal(written, runner.scaffoldAnswers('nestjs', 'demo-app'))
  assert.ok(written.includes('demo-app'))
  assert.deepEqual(calls[0].args, [path.join(ROOT, 'scripts/create-project.sh')])
})

test('a missing scaffolder reports unavailable without executing', async () => {
  const calls = []
  const result = await runner.runScaffold('nextjs', 'demo-app', { ...deps, exists: () => false, exec: fakeExec(calls) })
  assert.equal(result.status, 'unavailable')
  assert.equal(calls.length, 0)
})

test('fail, timeout and overflow are reported distinctly', async () => {
  const fail = await runner.runScaffold('nextjs', 'demo', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: 'nope', stderr: '' }) })
  assert.equal(fail.status, 'fail')
  assert.equal(fail.exitCode, 1)
  const timeout = await runner.runScaffold('nextjs', 'demo', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', code: null }), stdout: '', stderr: '' }) })
  assert.equal(timeout.status, 'timeout')
  const overflow = await runner.runScaffold('nextjs', 'demo', { ...deps, exec: fakeExec([], { error: Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' }), stdout: 'x', stderr: '' }) })
  assert.equal(overflow.status, 'error')
})

test('the wizard declining to generate is reported as cancelled, not as a failure', async () => {
  const cancelled = await runner.runScaffold('nextjs', 'demo', { ...deps, exec: fakeExec([], { error: null, stdout: 'summary\nCancelled.\n', stderr: '' }) })
  assert.equal(cancelled.status, 'cancelled')
})

test('scaffold output is ANSI-stripped, redacted and capped', async () => {
  const raw = ['\x1b[32mok\x1b[0m', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'a'.repeat(scanners.MAX_OUTPUT_CHARS + 500)].join('\n')
  const r = await runner.runScaffold('nextjs', 'demo', { ...deps, exec: fakeExec([], { error: null, stdout: raw, stderr: '' }) })
  assert.doesNotMatch(r.output, /\x1b/)
  assert.ok(!r.output.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
  assert.equal(r.truncated, true)
})

test('the registered-project list resolves entries and flags missing ones', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-projects-'))
  try {
    fs.writeFileSync(path.join(tmp, '.registered-projects'), `${tmp}/present\n/tmp/gf-does-not-exist-xyz\n`)
    fs.mkdirSync(path.join(tmp, 'present'))
    fs.mkdirSync(path.join(tmp, 'present', 'ghostforge'))
    const listed = runner.listProjects(tmp)
    assert.equal(listed.length, 2)
    const [present, missing] = listed
    assert.equal(present.exists, true)
    assert.equal(present.toolkit, true)
    assert.equal(present.name, 'present')
    assert.equal(missing.exists, false)
    assert.equal(missing.toolkit, false)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('a missing or empty registry lists no projects instead of throwing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-projects-'))
  try {
    assert.deepEqual(runner.listProjects(tmp), [])
    fs.writeFileSync(path.join(tmp, '.registered-projects'), '   \n\n')
    assert.deepEqual(runner.listProjects(tmp), [])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ── Wiring: page, middleware, access, nav ───────────────────────────────────

test('page uses logical utilities only and the middleware locks the routes', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr)-\d|text-(?:left|right)\b|dangerouslySetInnerHTML/)
  const mw = fs.readFileSync(path.resolve(__dirname, '../middleware.ts'), 'utf8')
  for (const p of ["'/projects'", "'/projects/:path*'"]) assert.ok(mw.includes(p), p)
  const access = fs.readFileSync(path.resolve(__dirname, '../lib/title-profiles.ts'), 'utf8')
  assert.match(access, /path: '\/projects'.*permission: 'admin'/)
})

test('/projects is admin-only in the navbar and the command palette', () => {
  const access = require('../lib/title-profiles.ts')
  const adminUser = { role: 'admin', permissions: [] }
  const engineer = { role: 'user', permissions: access.permissionsForProfile(access.getProfile('engineer')) }
  assert.equal(access.canAccessPage(adminUser, '/projects'), true)
  assert.equal(access.canAccessPage(engineer, '/projects'), false)
  assert.match(fs.readFileSync(path.resolve(__dirname, '../components/Navbar.tsx'), 'utf8'), /href: '\/projects'/)
  assert.match(fs.readFileSync(path.resolve(__dirname, '../components/CommandPalette.tsx'), 'utf8'), /go\('\/projects'\)/)
})

test('the Open link actually opens the project: the files page reads ?path=', () => {
  const files = fs.readFileSync(path.resolve(__dirname, '../app/files/page.tsx'), 'utf8')
  assert.match(files, /useSearchParams\(\)\??\.get\('path'\)/, 'files page must read ?path=')
  // The mount effect has to use it too, or the link silently opens ~/GhostForge.
  assert.match(files, /loadDir\(initialPath \|\| '~\/GhostForge'\)/)
  assert.doesNotMatch(files, /useEffect\(\(\) => \{ loadDir\('~\/GhostForge'\) \}, \[loadDir\]\)/)
  assert.match(fs.readFileSync(pagePath, 'utf8'), /href=\{`\/files\?path=\$\{encodeURIComponent\(project\.path\)\}`\}/)
})

// ── The answer sequence still selects the template it claims ────────────────

/**
 * Runs the REAL scripts/create-project.sh with stub scaffolders on PATH and
 * asserts each template reaches its own branch. This is the regression that
 * matters: the answer lists are positional, so any change to the wizard's prompt
 * order shifts every later answer and would silently scaffold the wrong stack.
 * Needs bash (Git Bash or WSL on Windows); skipped elsewhere.
 */
function scaffoldRealScript(template) {
  return new Promise(resolve => {
    const Module = require('node:module')
    const execFile = require('child_process').execFile
    const fsReal = fs
    const tmp = fsReal.mkdtempSync(path.join(os.tmpdir(), 'gf-scaffold-'))
    const bin = path.join(tmp, 'bin')
    fsReal.mkdirSync(bin)
    // Stub npx/npm/git: create the first non-flag argument as the project dir and
    // echo the call, so the test can see which scaffolder branch ran.
    for (const tool of ['npx', 'npm', 'git', 'code', 'gh', 'az']) {
      const file = path.join(bin, tool)
      fsReal.writeFileSync(file, [
        '#!/usr/bin/env bash',
        'echo "STUB|$0|$*"',
        'prev=""',
        'for a in "$@"; do',
        '  case "$a" in',
        '    -*) ;;',
        '    create-*|@nestjs|new|vite|init|"$0") ;;',
        '    *) if [ -z "$prev" ] || [ ! -d "$a" ]; then mkdir -p "$a" 2>/dev/null; fi ;;',
        '  esac',
        '  prev="$a"',
        'done',
        'exit 0',
      ].join('\n'))
      fsReal.chmodSync(file, 0o755)
    }
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`
    const child = execFile('bash', [path.join(repoRoot, 'scripts/create-project.sh')], {
      cwd: tmp,
      env: { ...process.env, TERM: 'xterm', NO_COLOR: '1' },
      timeout: runner.SCAFFOLD_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    }, (error, stdout, stderr) => {
      process.env.PATH = originalPath
      let output = `${stdout || ''}\n${stderr || ''}`
      try { fsReal.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
      resolve({ error, output })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(runner.scaffoldAnswers(template, 'demo-project'))
    void Module
  })
}

const BRANCH_MARKER = {
  nextjs: 'Creating Next.js project',
  'react-vite': 'Creating React + Vite project',
  'react-native': 'Creating React Native (Expo) project',
  nestjs: 'Creating NestJS project',
}

test('each template drives the real create-project.sh into its own branch', { skip: process.platform === 'win32' ? 'bash stub harness runs on POSIX only' : false }, async () => {
  for (const [template, marker] of Object.entries(BRANCH_MARKER)) {
    const { output } = await scaffoldRealScript(template)
    assert.ok(
      output.includes(marker),
      `template ${template} did not reach "${marker}". Wizard output:\n${output.slice(-2000)}`,
    )
  }
})

test('a wrong answer slot sends the wizard to the wrong branch (mutation check)', { skip: process.platform === 'win32' ? 'bash stub harness runs on POSIX only' : false }, async () => {
  // Claiming "nextjs" while answering the React Native slot must NOT produce a
  // Next.js project — this is what would happen if the sequences drifted.
  const Module = require('node:module')
  void Module
  const shifted = runner.scaffoldAnswers('nextjs', 'demo-project').replace(/^2$/m, '1')
  assert.notEqual(shifted, runner.scaffoldAnswers('nextjs', 'demo-project'))
  const { output } = await new Promise(resolve => {
    const execFile = require('child_process').execFile
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-scaffold-mut-'))
    const bin = path.join(tmp, 'bin')
    fs.mkdirSync(bin)
    for (const tool of ['npx', 'npm', 'git', 'code']) {
      const file = path.join(bin, tool)
      fs.writeFileSync(file, '#!/usr/bin/env bash\necho "STUB|$*"\nexit 0\n')
      fs.chmodSync(file, 0o755)
    }
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`
    const child = execFile('bash', [path.join(repoRoot, 'scripts/create-project.sh')], {
      cwd: tmp,
      env: { ...process.env, TERM: 'xterm', NO_COLOR: '1' },
      timeout: runner.SCAFFOLD_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    }, (error, stdout, stderr) => {
      process.env.PATH = originalPath
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
      resolve({ error, output: `${stdout || ''}\n${stderr || ''}` })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(shifted)
  })
  assert.ok(!output.includes('Creating Next.js project'), 'the mutated sequence must not reach the Next.js branch')
})