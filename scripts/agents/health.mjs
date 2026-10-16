#!/usr/bin/env node
// GhostForge project health score (0–100) — the agent team's definition of done.
//
// Runs every verifiable check in a checkout and weights the results. The boss
// runs it after each merge (quick) and when the board runs dry (full); every
// failing check becomes a board task, so the team keeps working until 100.
// (scripts/health-score.sh is a different, cache-based code-quality grade.)
//
// Usage: node scripts/agents/health.mjs [--full] [--json] [--cwd <dir>]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const { MAX_BUFFER } = createRequire(import.meta.url)('../spawn-limits.cjs')

const IS_WIN = process.platform === 'win32'

export function run(cmd, args, cwd, timeoutMs = 10 * 60_000) {
  const t0 = Date.now()
  // npm/npx are .cmd shims on Windows and need a shell (args are fixed literals);
  // absolute paths like process.execPath must not go through it (spaces).
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_BUFFER, shell: IS_WIN && !path.isAbsolute(cmd), env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, windowsHide: true })
  const ok = r.status === 0
  let output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.trim()
  // A process killed before it printed anything (T-244: `next build` on the
  // boss host) used to become a task with empty notes — nothing to diagnose.
  if (!ok && !output) output = `${cmd} ${args.join(' ')} failed with no output (exit code ${r.status ?? 'none'}, signal ${r.signal ?? 'none'})`
  return { ok, output: output.split('\n').slice(-40).join('\n'), ms: Date.now() - t0 }
}

function pythonCmd() {
  for (const c of IS_WIN ? ['python', 'py'] : ['python3', 'python']) {
    if (spawnSync(c, ['--version'], { shell: IS_WIN, windowsHide: true, maxBuffer: MAX_BUFFER }).status === 0) return c
  }
  return null
}

/**
 * The imports the bridge suite needs at collection time — the same small set CI
 * installs (.github/workflows/pr-check.yml), NOT mark-l-bridge/requirements.txt,
 * which is the full runtime tree (crewai, mem0ai, browser-use…). Those heavy
 * deps are optional at import time and the handlers under test are mocked, so
 * the suite runs on a bare interpreter.
 */
export const BRIDGE_TEST_MODULES = ['pytest', 'fastapi', 'httpx', 'multipart']

/**
 * An interpreter that can actually collect the bridge suite, or why it can't.
 * Probed by importing, not by running pytest: a missing fastapi makes the tests
 * error at *collection*, which would read as a code defect when it is only a
 * missing install.
 */
export function pythonProbe(modules = BRIDGE_TEST_MODULES) {
  const py = pythonCmd()
  if (!py) return { ok: false, reason: 'python not found' }
  // Never shell:true here (unlike pythonCmd, whose `--version` has no spaces):
  // the shell splits `import a, b` on whitespace and python then sees a bare
  // `import`, so the probe would report a false negative on a fine interpreter.
  const r = spawnSync(py, ['-c', `import ${modules.join(', ')}`], { windowsHide: true, maxBuffer: MAX_BUFFER })
  return r.status === 0 ? { ok: true, cmd: py } : { ok: false, reason: `${modules.join(', ')} not installed` }
}

/**
 * Wrap a check so it runs only when `present()` is true, and otherwise SKIPS.
 *
 * A checkout that never ran `npm ci` cannot run mcp's or the TUI's tests, and a
 * check that reports "failing" there sends the boss after a defect that isn't in
 * the code — it has happened, in the other direction, with web-ui/app/.omc
 * (T-010). scoreOf drops skips from both sides, so an uninstalled toolchain
 * costs nothing instead of dragging the score down.
 *
 * This is deliberately NOT what needWeb does: web-ui is the primary surface, so
 * its missing node_modules still reports as a failure. Changing that is a
 * judgement call about the score's inflation, not part of adding new checks.
 */
export function needsDeps(present, hint, fn) {
  return () => (present() ? fn() : { ok: false, skipped: true, output: `${hint} — skipped`, ms: 0 })
}

/** The checks. `full` ones are slow and only run with --full. */
export function checks(root) {
  const web = path.join(root, 'web-ui')
  const hasWebDeps = fs.existsSync(path.join(web, 'node_modules'))
  const bridgeDir = path.join(root, 'mark-l-bridge')
  const bridgeFiles = fs.existsSync(bridgeDir)
    ? fs.readdirSync(bridgeDir).filter(f => f.endsWith('.py')).map(f => path.join('mark-l-bridge', f))
    : []
  const bridgeTests = fs.existsSync(bridgeDir)
    ? fs.readdirSync(bridgeDir).filter(f => /^test_.*\.py$/.test(f))
    : []
  const needWeb = fn => () => hasWebDeps ? fn() : { ok: false, output: 'web-ui/node_modules missing — run `cd web-ui && npm ci`', ms: 0 }

  return [
    { id: 'root-smoke', label: 'Root smoke test (TUI parse, marketplace JSON)', area: ['tui', 'marketplace', 'scripts'], weight: 15,
      run: () => run(process.execPath, ['scripts/test.js'], root) },
    { id: 'agents-unit', label: 'Agent team unit tests', area: ['scripts/agents'], weight: 5,
      run: () => run(process.execPath, ['--test', 'scripts/agents/agents.test.mjs'], root) },
    { id: 'mcp-parse', label: 'MCP server parses', area: ['mcp'], weight: 5,
      run: () => run(process.execPath, ['--check', 'mcp/index.js'], root) },
    // mcp/ and tui/ have their own dependency trees that npm ci never touches
    // at the root, so their suites could pass unreported or fail unreported
    // depending on the machine — both blind. Each is skipped, not failed, when
    // its node_modules is absent.
    { id: 'mcp-tests', label: 'MCP server unit tests', area: ['mcp'], weight: 5,
      run: needsDeps(() => fs.existsSync(path.join(root, 'mcp', 'node_modules')), 'mcp/node_modules missing — run `cd mcp && npm install`',
        () => run('npm', ['test', '--silent'], path.join(root, 'mcp'))) },
    { id: 'tui-tests', label: 'TUI unit tests (menus, marketplace, users)', area: ['tui'], weight: 5,
      run: needsDeps(() => fs.existsSync(path.join(root, 'tui', 'node_modules')), 'tui/node_modules missing — run `cd tui && npm install`',
        () => run('npm', ['test', '--silent'], path.join(root, 'tui'))) },
    // The desktop app compiles TypeScript first (`npm test` = `tsc && node --test`),
    // so this covers its build too. Slow (a few seconds of tsc) and it launches a
    // real Electron process, so it stays a --full-only check rather than taxing
    // every boss review.
    { id: 'electron-tests', label: 'Electron desktop app tests (incl. headless launch)', area: ['electron-app'], weight: 5, full: true,
      run: needsDeps(() => fs.existsSync(path.join(root, 'electron-app', 'node_modules')), 'electron-app/node_modules missing — run `cd electron-app && npm ci`',
        () => run('npm', ['test', '--silent'], path.join(root, 'electron-app'))) },
    { id: 'web-typecheck', label: 'web-ui TypeScript typecheck', area: ['web-ui'], weight: 20,
      run: needWeb(() => run('npx', ['tsc', '--noEmit'], web)) },
    { id: 'web-lint', label: 'web-ui ESLint', area: ['web-ui'], weight: 10,
      run: needWeb(() => run('npx', ['next', 'lint', '--quiet'], web)) },
    { id: 'web-tests', label: 'web-ui unit tests (JARVIS tools, job hunter…)', area: ['web-ui'], weight: 20,
      run: needWeb(() => run('npm', ['test'], web)) },
    { id: 'bridge-compile', label: 'Python bridge compiles', area: ['mark-l-bridge'], weight: 10,
      run: () => {
        const py = pythonCmd()
        return py ? run(py, ['-m', 'py_compile', ...bridgeFiles], root) : { ok: false, skipped: true, output: 'python not found', ms: 0 }
      } },
    // py_compile only proves the bridge parses. Until this ran, a handler that
    // imported cleanly but blew up mid-request passed every local check while CI
    // (which has run pytest since T-231) failed it. Slow — 157 tests — so --full.
    { id: 'bridge-tests', label: 'Python bridge tests (pytest)', area: ['mark-l-bridge'], weight: 10, full: true,
      run: () => {
        // Also skipped with no test files: pytest exits 5 ("nothing collected"),
        // which would otherwise read as a failure on a tree that ships no
        // bridge tests at all.
        if (!bridgeTests.length) return { ok: false, skipped: true, output: 'no mark-l-bridge tests found — skipped', ms: 0 }
        const probe = pythonProbe()
        return probe.ok ? run(probe.cmd, ['-m', 'pytest', '.', '-q'], bridgeDir) : { ok: false, skipped: true, output: `${probe.reason} — skipped`, ms: 0 }
      } },
    { id: 'web-audit', label: 'web-ui npm audit (no high/critical)', area: ['web-ui/package.json'], weight: 5, full: true,
      run: needWeb(() => {
        const r = run('npm', ['audit', '--omit=dev', '--audit-level=high'], web, 120_000)
        // Offline / registry errors aren't the project's fault — don't count them.
        if (!r.ok && /ENOTFOUND|ECONNRESET|ETIMEDOUT|audit endpoint/i.test(r.output)) return { ...r, skipped: true }
        return r
      }) },
    { id: 'web-build', label: 'web-ui production build', area: ['web-ui'], weight: 10, full: true,
      run: needWeb(() => run('npx', ['next', 'build'], web, 20 * 60_000)) },
  ]
}

/** Run the checks and compute a weighted score over the checks that ran. */
export function healthScore(root, { full = false, only } = {}) {
  const results = []
  for (const c of checks(root)) {
    if (c.full && !full) continue
    if (only && !only.includes(c.id)) continue
    const r = c.run()
    results.push({ id: c.id, label: c.label, area: c.area, weight: c.weight, ok: r.ok, skipped: !!r.skipped, ms: r.ms, output: r.ok ? '' : r.output })
  }
  return { ts: new Date().toISOString(), full, score: scoreOf(results), checks: results }
}

/** Weighted percentage over the checks that actually ran (skips don't count). */
export function scoreOf(results) {
  const counted = results.filter(r => !r.skipped)
  const max = counted.reduce((s, r) => s + r.weight, 0)
  const got = counted.filter(r => r.ok).reduce((s, r) => s + r.weight, 0)
  return max ? Math.round((got / max) * 100) : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2)
  const cwdIdx = argv.indexOf('--cwd')
  const root = cwdIdx >= 0 ? path.resolve(argv[cwdIdx + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const report = healthScore(root, { full: argv.includes('--full') })
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`\n  GhostForge health: ${report.score}/100${report.full ? '' : '  (quick — add --full for audit + build)'}\n`)
    for (const c of report.checks) {
      console.log(`  ${c.skipped ? '–' : c.ok ? '✓' : '✗'} ${c.label.padEnd(50)} ${String(c.weight).padStart(3)}  ${(c.ms / 1000).toFixed(1)}s`)
      if (!c.ok && !c.skipped) console.log(c.output.split('\n').slice(-6).map(l => `      ${l}`).join('\n'))
    }
    console.log()
  }
  process.exit(report.score === 100 ? 0 : 1)
}
