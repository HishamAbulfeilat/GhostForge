#!/usr/bin/env node
/**
 * `ghostforge <name>` / `--command <name>` only run scripts/<name>.sh for a
 * plain name, and the bridge's /execute only forwards the subcommands the web
 * UI sends. Before the fix `ghostforge ../../outside/evil` ran <root>/../outside/evil.sh and
 * the bridge forwarded any `ghostforge ...` argv.
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { createServer } = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { findBash } = require('./bash-path.js')

const ROOT = path.resolve(__dirname, '..')
const BASH = findBash()

/** A copy of the launcher in a throwaway root with one legit and one outside script. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-script-names-'))
  const root = path.join(dir, 'root')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tui', 'node_modules'), { recursive: true }) // skip first-run npm install
  fs.copyFileSync(path.join(ROOT, 'ghostforge'), path.join(root, 'ghostforge'))
  fs.writeFileSync(path.join(root, 'scripts', 'hello.sh'), 'echo "hello ran $*"\n')
  fs.mkdirSync(path.join(dir, 'outside'))
  const marker = path.join(dir, 'pwned')
  fs.writeFileSync(path.join(dir, 'outside', 'evil.sh'), `echo pwned > "${marker}"\n`)
  return { dir, root, marker }
}

test('ghostforge refuses path-like legacy script names in both branches', { skip: !BASH && 'no bash' }, () => {
  const { dir, root, marker } = sandbox()
  try {
    const run = (...args) => spawnSync(BASH, [path.join(root, 'ghostforge'), ...args], { encoding: 'utf8' })

    const ok = run('hello', 'x')
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /hello ran x/)
    const okCommand = run('--command', 'hello')
    assert.equal(okCommand.status, 0, okCommand.stderr)

    for (const args of [['../../outside/evil'], ['--command', '../../outside/evil'], ['Hello'], ['--command', 'a/b']]) {
      const res = run(...args)
      assert.notEqual(res.status, 0, args.join(' '))
      assert.equal(fs.existsSync(marker), false, `${args.join(' ')} ran a script outside scripts/`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

test('bridge /execute forwards only the subcommands the web UI sends', { skip: !BASH && 'no bash' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-exec-allow-'))
  const token = 'allowlist-test-token'
  fs.writeFileSync(path.join(dir, 'token'), `${token}\n`)
  fs.writeFileSync(path.join(dir, 'ghostforge'), 'printf "ran:"; for a in "$@"; do printf " [%s]" "$a"; done; echo\n')
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'bridge-server.js')], {
    env: { ...process.env, BRIDGE_TOKEN_FILE: path.join(dir, 'token'), BRIDGE_ROOT: dir, BRIDGE_PORT: String(port), BRIDGE_HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  const base = `http://127.0.0.1:${port}`
  const post = async command => {
    const res = await fetch(`${base}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ command }),
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 50))
    }
    const ok = await post('ghostforge health-score --json src')
    assert.equal(ok.status, 200)
    assert.equal(ok.body.output, 'ran: [health-score] [--json] [src]')

    for (const command of ['ghostforge deploy-azure --env production', 'ghostforge ../../tmp/x', 'ghostforge --command deploy-azure', 'ghostforge update', 'ghostforge tunnel']) {
      const res = await post(command)
      assert.equal(res.status, 403, command)
    }
  } finally {
    child.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('bridge /execute allowlist covers every subcommand the web execute route sends', () => {
  const route = fs.readFileSync(path.join(ROOT, 'web-ui', 'app', 'api', 'execute', 'route.ts'), 'utf8')
  const map = route.slice(route.indexOf('GHOSTFORGE_SCRIPT_MAP'), route.indexOf('] as const'))
  const webSubcommands = [...map.matchAll(/\['([a-z0-9-]+)', '[^']+'\]/g)].map(m => m[1])
  assert.ok(webSubcommands.length > 10)
  const bridge = fs.readFileSync(path.join(ROOT, 'scripts', 'bridge-server.js'), 'utf8')
  const set = bridge.slice(bridge.indexOf('const EXECUTE_SUBCOMMANDS'), bridge.indexOf('])', bridge.indexOf('const EXECUTE_SUBCOMMANDS')))
  const allowed = new Set([...set.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]))
  for (const name of [...webSubcommands, 'doctor']) assert.ok(allowed.has(name), `bridge must allow ${name}`)
  assert.deepEqual([...allowed].sort(), [...new Set([...webSubcommands, 'doctor'])].sort())
})
