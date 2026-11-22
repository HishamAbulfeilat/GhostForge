#!/usr/bin/env node
/**
 * scripts/generate.sh records generated agents/commands in registry.generated[]
 * (installed[] stays a list of string ids, as the TUI and web expect), and a
 * name with quotes is stored as text, never run as code. Before the fix the
 * name was pasted into a `node -e` program and the entry went into installed[].
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { findBash } = require('./bash-path.js')

const ROOT = path.resolve(__dirname, '..')
const BASH = findBash()

function register(registry, type, name, file) {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'generate.sh'), 'utf8')
  const pick = (start) => {
    const from = script.indexOf(start)
    const to = script.indexOf('\n}\n', from)
    assert.ok(from >= 0 && to > from, `generate.sh defines ${start}`)
    return script.slice(from, to + 3)
  }
  const body = pick('slugify()').split('\n')[0] + '\n' + pick('register_item()') + '\nregister_item "$1" "$2" "$3"\n'
  return spawnSync(BASH, ['-c', body, 'gen', type, name, file], {
    env: { ...process.env, REGISTRY: registry },
    encoding: 'utf8',
  })
}

test('generate.sh writes generated items to registry.generated[] and leaves installed[] as ids', { skip: !BASH && 'bash not found' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-generate-'))
  try {
    const registry = path.join(dir, 'registry.json')
    fs.writeFileSync(registry, JSON.stringify({ installed: ['semgrep'] }))
    const marker = path.join(dir, 'pwned')
    const name = `Evil'); require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); //`
    const run = register(registry, 'agent', name, 'agents/evil.md')
    assert.equal(run.status, 0, run.stderr)
    const reg = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.deepEqual(reg.installed, ['semgrep'])
    assert.equal(reg.generated.length, 1)
    assert.equal(reg.generated[0].name, name)
    assert.equal(reg.generated[0].type, 'agent')
    assert.equal(reg.generated[0].file, 'agents/evil.md')
    assert.equal(fs.existsSync(marker), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
