// T-220: /api/bridge-start must never shell out to an env-derived path, and
// scripts/bridge-server.js must not leak stack traces to its callers.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const WEB_UI = path.resolve(__dirname, '..')
const REPO = path.resolve(WEB_UI, '..')

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

const launcher = loadTs(path.join(WEB_UI, 'lib', 'bridge-launcher.ts'))

/** Build a throwaway directory that looks like a GhostForge checkout. */
function makeRoot(name, { withLauncher = true, platform = 'win32' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gf-bridge-${name}-`))
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts', 'bridge.sh'), '#!/usr/bin/env bash\n')
  fs.writeFileSync(path.join(root, 'scripts', 'bridge-server.js'), '//\n')
  if (withLauncher) {
    fs.writeFileSync(path.join(root, 'scripts', platform === 'win32' ? 'bridge.cmd' : 'bridge.sh'), '@echo off\n')
  }
  return root
}

// ── Root resolution ──────────────────────────────────────────────────────────

test('resolveBridgeLauncher rejects a GHOSTFORGE_ROOT that is not a GhostForge checkout', () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bridge-fake-'))
  try {
    // Nothing that looks like the repo: must not resolve, even though the
    // variable points at a real, existing directory.
    const resolved = launcher.resolveBridgeLauncher({
      env: { GHOSTFORGE_ROOT: fake },
      cwd: fake,
      platform: 'win32',
    })
    assert.equal(resolved, null)
  } finally {
    fs.rmSync(fake, { recursive: true, force: true })
  }
})

test('resolveBridgeLauncher falls back to the server cwd when the env root is bogus', () => {
  const real = makeRoot('fallback')
  try {
    const resolved = launcher.resolveBridgeLauncher({
      env: { GHOSTFORGE_ROOT: path.join(real, 'nope') },
      cwd: real,
      platform: 'win32',
    })
    assert.ok(resolved, 'must fall back to the cwd checkout')
    assert.equal(resolved.repoRoot, fs.realpathSync(real))
    assert.equal(path.basename(resolved.scriptPath), 'bridge.cmd')
  } finally {
    fs.rmSync(real, { recursive: true, force: true })
  }
})

test('resolveBridgeLauncher requires the launcher script to exist as a regular file', () => {
  const root = makeRoot('nolaucher', { withLauncher: false })
  try {
    assert.equal(launcher.resolveBridgeLauncher({ env: { GHOSTFORGE_ROOT: root }, cwd: root, platform: 'win32' }), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  // A directory named bridge.cmd is not a launchable script.
  const dirRoot = makeRoot('dirlaucher', { withLauncher: false })
  try {
    fs.mkdirSync(path.join(dirRoot, 'scripts', 'bridge.cmd'))
    assert.equal(
      launcher.resolveBridgeLauncher({ env: { GHOSTFORGE_ROOT: dirRoot }, cwd: dirRoot, platform: 'win32' }),
      null,
      'a directory must not pass the isFile check'
    )
  } finally {
    fs.rmSync(dirRoot, { recursive: true, force: true })
  }
})

test('resolveBridgeLauncher returns the platform script and keeps the root out of relativeScript', () => {
  for (const [platform, expected] of [['win32', 'bridge.cmd'], ['linux', 'bridge.sh'], ['darwin', 'bridge.sh']]) {
    const root = makeRoot(platform, { platform })
    try {
      const resolved = launcher.resolveBridgeLauncher({ env: { GHOSTFORGE_ROOT: root }, cwd: root, platform })
      assert.ok(resolved, platform)
      assert.equal(resolved.isWindows, platform === 'win32')
      assert.equal(path.basename(resolved.relativeScript), expected)
      assert.equal(resolved.relativeScript, path.join('scripts', expected))
      assert.ok(!resolved.relativeScript.includes(root), 'relativeScript must not embed the root')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

// ── argv construction: the root never reaches the shell's parser ─────────────

test('bridgeArgv passes a constant relative path to cmd.exe, with the root only as cwd', () => {
  const resolved = { repoRoot: 'C:\\evil & calc\\repo', scriptPath: 'C:\\evil & calc\\repo\\scripts\\bridge.cmd', relativeScript: path.join('scripts', 'bridge.cmd'), isWindows: true }
  const { file, args } = launcher.bridgeArgv(resolved, 'start')
  assert.match(file, /cmd(\.exe)?$/i)
  assert.deepEqual(args, ['/d', '/s', '/c', path.join('scripts', 'bridge.cmd'), 'start'])

  // The danger: the repo root appearing anywhere in the command line. cmd.exe
  // re-parses its command string, so a root with & | ^ % ( ) would inject.
  const commandLine = [file, ...args].join(' ')
  for (const meta of ['&', '|', '^', '%', '(', ')', 'evil', 'calc']) {
    assert.ok(!commandLine.includes(meta), `argv must not contain ${meta}: ${commandLine}`)
  }
  assert.deepEqual(launcher.bridgeArgv(resolved, 'stop').args, ['/d', '/s', '/c', path.join('scripts', 'bridge.cmd'), 'stop'])
})

test('bridgeArgv on POSIX runs bash with the relative script and no shell', () => {
  const resolved = { repoRoot: '/opt/gf repo', scriptPath: '/opt/gf repo/scripts/bridge.sh', relativeScript: path.join('scripts', 'bridge.sh'), isWindows: false }
  const { file, args } = launcher.bridgeArgv(resolved, 'start')
  assert.equal(file, 'bash')
  assert.deepEqual(args, [path.join('scripts', 'bridge.sh'), 'start'])
})

test('isInside rejects traversal and sibling-prefix paths', () => {
  const root = path.resolve('/srv/ghostforge')
  assert.equal(launcher.isInside(root, path.join(root, 'scripts', 'bridge.sh')), true)
  assert.equal(launcher.isInside(root, root), true)
  assert.equal(launcher.isInside(root, path.resolve('/srv/ghostforge-evil/scripts/x')), false)
  assert.equal(launcher.isInside(root, path.resolve('/srv/ghostforge/../etc/passwd')), false)
  assert.equal(launcher.isInside(root, path.resolve('/etc/passwd')), false)
})

// ── Route: the wiring itself ────────────────────────────────────────────────

test('bridge-start route validates the launcher and never spawns an env-derived path', () => {
  const src = fs.readFileSync(path.join(WEB_UI, 'app', 'api', 'bridge-start', 'route.ts'), 'utf8')
  assert.match(src, /resolveBridgeLauncher\(\)/, 'route must use the validating resolver')
  assert.match(src, /bridgeArgv\(launcher, action\)/, 'route must build argv via bridgeArgv')

  // The CodeQL taint path: env → path.join → shell. No shell:true, no
  // cmd.exe /c with a computed script path, and no env-derived script path.
  assert.doesNotMatch(src, /shell:\s*true/, 'route must not enable a shell')
  assert.doesNotMatch(src, /'\/c',\s*scriptPath/, 'route must not interpolate a computed path into cmd /c')
  assert.doesNotMatch(src, /GHOSTFORGE_ROOT/, 'route must not read GHOSTFORGE_ROOT itself')
  assert.doesNotMatch(src, /path\.join\(repoRoot/, 'route must not build paths from a repo root')
})

// The route is loaded once, with child_process and the launcher resolver
// mocked, so each case below drives it through the shared state.
const spawnCalls = []
const state = { authed: true, launcher: null }
const route = loadTs(path.join(WEB_UI, 'app', 'api', 'bridge-start', 'route.ts'), {
  'next/server': { NextResponse: { json: (b, i = {}) => ({ status: i.status ?? 200, json: async () => b }) } },
  // Real hosted-mode policy: off unless GHOSTFORGE_MODE=hosted
  '@/lib/hosted': require('../lib/hosted.ts'),
  '@/lib/auth': { isAuthorizedRequest: () => state.authed },
  // The route calls resolveBridgeLauncher() with no arguments; the mock
  // supplies the outcome so both the found and missing cases are exercised.
  '@/lib/bridge-launcher': {
    resolveBridgeLauncher: () => state.launcher,
    bridgeArgv: launcher.bridgeArgv,
  },
  child_process: {
    spawn: (...args) => { spawnCalls.push(args); return { unref() {}, on() {} } },
    spawnSync: (...args) => { spawnCalls.push(args); return { status: 0 } },
  },
})

const post = body => route.POST({ json: async () => body })

test('bridge-start route: unauthorized callers get 401 and nothing is spawned', async () => {
  state.authed = false
  state.launcher = { repoRoot: '/tmp/gf', scriptPath: '/tmp/gf/scripts/bridge.sh', relativeScript: path.join('scripts', 'bridge.sh'), isWindows: false }
  spawnCalls.length = 0
  assert.equal((await post({ action: 'start' })).status, 401)
  assert.deepEqual(spawnCalls, [])
})

test('bridge-start route: a missing launcher is a 500 with a generic message and no spawn', async () => {
  state.authed = true
  state.launcher = null
  spawnCalls.length = 0
  const res = await post({ action: 'start' })
  assert.equal(res.status, 500)
  const body = await res.json()
  assert.equal(body.error, 'Bridge launcher not found')
  assert.equal(body.ok, false)
  assert.equal(JSON.stringify(body).includes('/tmp'), false, 'no path may leak in the error')
  assert.deepEqual(spawnCalls, [])
})

test('bridge-start route: a valid launcher spawns with cwd set and a root-free command line', async () => {
  state.authed = true
  state.launcher = {
    repoRoot: '/tmp/gf root & more',
    scriptPath: '/tmp/gf root & more/scripts/bridge.sh',
    relativeScript: path.join('scripts', 'bridge.sh'),
    isWindows: false,
  }
  spawnCalls.length = 0
  const res = await post({ action: 'stop' })
  assert.equal(res.status, 200)
  const [file, args, options] = spawnCalls[0]
  assert.equal(file, 'bash')
  assert.deepEqual(args, [path.join('scripts', 'bridge.sh'), 'stop'])
  assert.equal(options.cwd, '/tmp/gf root & more', 'the root travels as cwd')
  assert.ok(!JSON.stringify([file, args]).includes('&'), 'no metacharacter may reach the shell')
})

// ── bridge-server.js: no stack traces over the wire ─────────────────────────

test('bridge-server logs command failures server-side and returns generic JSON', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'bridge-server.js'), 'utf8')

  // A stack/message must never be the client payload.
  assert.doesNotMatch(src, /output:\s*error\.message/, 'raw error.message must not be sent to callers')
  assert.doesNotMatch(src, /output:\s*String\(error\)/, 'raw String(error) must not be sent to callers')
  assert.doesNotMatch(src, /\bstack\b\s*[:,]/, 'no stack field in a response payload')
  assert.match(src, /function logError\(context, error\)/, 'failures must be logged server-side')
  assert.match(src, /function clientErrorOutput\(error\)/, 'clients must get the sanitised helper')

  // Both failure paths log then respond with the sanitised output.
  const sanitised = (src.match(/respond\(res, 200, \{ output: clientErrorOutput\(error\), error: true \}\)/g) || []).length
  assert.equal(sanitised, 2, 'copilot and execute must both use clientErrorOutput')
  const logged = (src.match(/logError\('(copilot|execute) failed', error\)/g) || []).length
  assert.equal(logged, 2, 'copilot and execute must both log the detail server-side')

  // Generic fallback text, not a stack.
  assert.match(src, /Command failed\. Check the bridge log on the host machine\./)
})

test('bridge-server does not throw a raw stack on a missing token file or root', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'bridge-server.js'), 'utf8')
  assert.match(src, /function readTokenFile\(file\)/, 'the token file read must be guarded')
  assert.doesNotMatch(src, /^const token = fs\.readFileSync\(process\.env\.BRIDGE_TOKEN_FILE/m, 'unguarded top-level token read')
  assert.match(src, /BRIDGE_ROOT is not set/, 'a missing BRIDGE_ROOT must exit with a message')
})

// ── End-to-end: the argv form actually executes under a hostile root ───────
//
// Source assertions cannot tell whether cmd.exe really runs the script. These
// execute the real argv that bridgeArgv produces, from a repo root whose name
// contains spaces and shell metacharacters — the exact shape that made the old
// `cmd /c <abs path>` form split into extra commands.

const { spawnSync } = require('node:child_process')

const WINDOWS_ONLY = process.platform === 'win32'

/** A checkout whose root name carries a space, &, ^ and parentheses. */
function makeHostileRoot(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bridge-e2e-'))
  const root = path.join(base, name)
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts', 'bridge.sh'), '#!/usr/bin/env bash\n')
  fs.writeFileSync(path.join(root, 'scripts', 'bridge-server.js'), '//\n')
  fs.writeFileSync(
    path.join(root, 'scripts', 'bridge.cmd'),
    '@echo off\r\nif "%1"=="start" (echo ran=start) else (echo ran=%1)\r\n'
  )
  return { base, root }
}

test('the resolved launcher runs the real script from a root containing spaces and metacharacters', { skip: !WINDOWS_ONLY }, () => {
  for (const name of ['ev il & x', 'x^y', 'x(y)']) {
    const { base, root } = makeHostileRoot(name)
    try {
      const resolved = launcher.resolveBridgeLauncher({ env: { GHOSTFORGE_ROOT: root }, cwd: root, platform: 'win32' })
      assert.ok(resolved, `must resolve for ${name}`)

      const { file, args } = launcher.bridgeArgv(resolved, 'start')
      const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', timeout: 15000 })
      const output = (result.stdout || '').trim()

      assert.equal(result.status, 0, `${name}: exit ${result.status} — ${(result.stderr || '').trim()}`)
      assert.match(output, /ran=start/, `${name}: the launcher must run, not split into extra commands`)
      // A split command line would leave a marker of its own on stdout.
      assert.doesNotMatch(output, /not recognized as an internal or external command/i, `${name}: cmd split the path`)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  }
})

test('the real GhostForge checkout resolves to its own bridge launcher', () => {
  const platform = process.platform === 'win32' ? 'win32' : 'linux'
  const resolved = launcher.resolveBridgeLauncher({ env: {}, cwd: WEB_UI, platform })
  assert.ok(resolved, 'this repository must resolve — the feature would be broken otherwise')
  assert.equal(path.basename(resolved.scriptPath), platform === 'win32' ? 'bridge.cmd' : 'bridge.sh')
  assert.ok(fs.existsSync(resolved.scriptPath))
  assert.equal(launcher.isInside(resolved.repoRoot, resolved.scriptPath), true)
})