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

function run(cmd, args, cwd, timeoutMs = 10 * 60_000) {
  const t0 = Date.now()
  // npm/npx are .cmd shims on Windows and need a shell (args are fixed literals);
  // absolute paths like process.execPath must not go through it (spaces).
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_BUFFER, shell: IS_WIN && !path.isAbsolute(cmd), env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, windowsHide: true })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`
  return { ok: r.status === 0, output: output.trim().split('\n').slice(-40).join('\n'), ms: Date.now() - t0 }
}

function pythonCmd() {
  for (const c of IS_WIN ? ['python', 'py'] : ['python3', 'python']) {
    if (spawnSync(c, ['--version'], { shell: IS_WIN, windowsHide: true, maxBuffer: MAX_BUFFER }).status === 0) return c
  }
  return null
}

/** The checks. `full` ones are slow and only run with --full. */
export function checks(root) {
  const web = path.join(root, 'web-ui')
  const hasWebDeps = fs.existsSync(path.join(web, 'node_modules'))
  const bridgeDir = path.join(root, 'mark-l-bridge')
  const bridgeFiles = fs.existsSync(bridgeDir)
    ? fs.readdirSync(bridgeDir).filter(f => f.endsWith('.py')).map(f => path.join('mark-l-bridge', f))
    : []
  const needWeb = fn => () => hasWebDeps ? fn() : { ok: false, output: 'web-ui/node_modules missing — run `cd web-ui && npm ci`', ms: 0 }

  return [
    { id: 'root-smoke', label: 'Root smoke test (TUI parse, marketplace JSON)', area: ['tui', 'marketplace', 'scripts'], weight: 15,
      run: () => run(process.execPath, ['scripts/test.js'], root) },
    { id: 'agents-unit', label: 'Agent team unit tests', area: ['scripts/agents'], weight: 5,
      run: () => run(process.execPath, ['--test', 'scripts/agents/agents.test.mjs'], root) },
    { id: 'mcp-parse', label: 'MCP server parses', area: ['mcp'], weight: 5,
      run: () => run(process.execPath, ['--check', 'mcp/index.js'], root) },
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
