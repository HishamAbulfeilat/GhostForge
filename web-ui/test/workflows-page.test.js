const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const { RUNNABLE_COMMAND_REFS, SUGGESTED_COMMAND_REFS, isRunnableStep, unsupportedSteps, summarizeRun } = require('../app/workflows/runnable.ts')

const page = readFileSync(resolve(__dirname, '../app/workflows/page.tsx'), 'utf8')
const templates = readFileSync(resolve(__dirname, '../lib/workflows/templates.ts'), 'utf8')
const bridge = readFileSync(resolve(__dirname, '../../mark-l-bridge/server.py'), 'utf8')

const step = (id, kind, ref, extra = {}) => ({ id, title: id, kind, ref, deps: [], status: 'pending', notes: '', log: [], ...extra })

test('client run allowlist mirrors the bridge allowlist exactly', () => {
  const fn = bridge.slice(bridge.indexOf('def _run_workflow('), bridge.indexOf('def _workflow_step('))
  const tuple = fn.match(/kind == "command" and ref in \(([\s\S]*?)\)/)
  assert.ok(tuple, 'bridge allowlist tuple not found')
  const bridgeRefs = [...tuple[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
  assert.deepEqual([...RUNNABLE_COMMAND_REFS].sort(), bridgeRefs.sort())
  assert.match(fn, /ref\.startswith\("bridge:deploy"\)/)
  for (const ref of SUGGESTED_COMMAND_REFS) assert.ok(RUNNABLE_COMMAND_REFS.includes(ref))
})

test('runnable steps are manual, allow-listed bridge commands, or already finished', () => {
  assert.equal(isRunnableStep(step('a', 'manual', 'sign off')), true)
  assert.equal(isRunnableStep(step('b', 'command', 'bridge:health')), true)
  assert.equal(isRunnableStep(step('c', 'command', 'bridge:deploy:prod:static')), true)
  assert.equal(isRunnableStep(step('d', 'command', 'npm test')), false)
  assert.equal(isRunnableStep(step('e', 'agent', 'ecc:code-reviewer')), false)
  assert.equal(isRunnableStep(step('f', 'skill', 'x', { status: 'done' })), true)
  assert.deepEqual(unsupportedSteps([step('a', 'manual', ''), step('d', 'command', 'rm -rf /'), step('e', 'skill', 'x')]).map(s => s.id), ['d', 'e'])
})

test('run summary counts outcomes and keeps the last log message per step', () => {
  const summary = summarizeRun({
    status: 'done',
    steps: [
      step('s0', 'command', 'bridge:health', { status: 'done', log: [{ at: '1', msg: 'start' }, { at: '2', msg: 'Completed bridge:health' }] }),
      step('s1', 'manual', '', { title: '', status: 'skipped', log: [{ at: '3', msg: 'Skipped: manual steps require a human' }] }),
    ],
  })
  assert.equal(summary.ok, true)
  assert.deepEqual([summary.total, summary.done, summary.skipped, summary.failed], [2, 1, 1, 0])
  assert.equal(summary.steps[0].message, 'Completed bridge:health')
  assert.equal(summary.steps[1].title, 's1')
  assert.equal(summarizeRun({ status: 'failed', steps: [] }).ok, false)
})

test('a shipped template runs end to end under the bridge allowlist', () => {
  const block = templates.slice(templates.indexOf("name: 'Release readiness check'"), templates.indexOf("name: 'Ship a feature'"))
  const refs = [...block.matchAll(/kind: '(\w+)', ref: '([^']*)'/g)].map(m => ({ kind: m[1], ref: m[2], status: 'pending' }))
  assert.ok(refs.length >= 2)
  assert.deepEqual(unsupportedSteps(refs), [])
})

test('workflows page shows loading, error with retry, run result and allowlist warning states', () => {
  assert.match(page, /Loading workflows…/)
  assert.match(page, /aria-busy=\{loading\}/)
  assert.match(page, /Could not load workflows: \{loadError\}/)
  assert.match(page, /onClick=\{\(\) => void loadList\(\)\}[\s\S]{0,120}>Retry</)
  assert.match(page, /setLastRun\(\{ id: d\.workflow\.id, summary: summarizeRun\(d\.workflow\) \}\)/)
  assert.match(page, /<RunResultPanel result=\{lastRun\}/)
  assert.match(page, /role=\{ok \? 'status' : 'alert'\}/)
  assert.match(page, /unsupportedSteps\(selected\.steps\)/)
  assert.match(page, /The bridge will reject this run/)
  assert.match(page, /aria-label=\{`Run workflow \$\{selected\.name\}`\}/)
  assert.match(page, /focus-visible:outline-gf-accent/)
  assert.doesNotMatch(page, /e\.g\. npm test/)
})

test('workflows page uses logical Tailwind utilities only', () => {
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr|left|right)-\d|\btext-(?:left|right)\b|\b(?:border|rounded)-[lr]\b/)
})
