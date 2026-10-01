#!/usr/bin/env node

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SHELL_SCRIPT = path.join(ROOT, 'scripts', 'awesome-llm-apps.sh')
const NODE_SCRIPT = path.join(ROOT, 'scripts', 'awesome-llm-apps.mjs')

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awesome-llm-apps-'))
  const fixture = path.join(dir, 'catalog.json')
  fs.writeFileSync(fixture, JSON.stringify({
    items: [
      { name: 'Agent OS', description: 'Planning agent with a task board.', category: 'agents', url: 'https://example.com/agent-os' },
      { name: 'Voice Notes', description: 'Transcribes and searches voice memos.', category: 'voice', url: 'https://example.com/voice-notes' },
      { name: 'Browser Pilot', description: 'Controls a browser for routine tasks.', category: 'computer-use', url: 'https://example.com/browser-pilot' },
    ],
  }), 'utf8')
  return { dir, fixture }
}

test('shell help explains list and search usage', () => {
  const result = spawnSync('bash', [SHELL_SCRIPT, '--help'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /list/)
  assert.match(result.stdout, /search/)
})

test('list command can read a fixture without network access', () => {
  const { dir, fixture } = makeFixture()
  try {
    const result = spawnSync('bash', [SHELL_SCRIPT, 'list', '--fixture', fixture, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, GF_AWESOME_LLM_API_URL: 'https://example.invalid' },
    })

    assert.equal(result.status, 0, result.stderr)
    const apps = JSON.parse(result.stdout)
    assert.equal(apps.length, 3)
    assert.deepEqual(apps.map(app => app.name), ['Agent OS', 'Voice Notes', 'Browser Pilot'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('search command filters a fixture by app name and description', () => {
  const { dir, fixture } = makeFixture()
  try {
    const result = spawnSync('bash', [SHELL_SCRIPT, 'search', 'voice', '--fixture', fixture], {
      cwd: ROOT,
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Voice Notes/)
    assert.doesNotMatch(result.stdout, /Agent OS/)
    assert.doesNotMatch(result.stdout, /Browser Pilot/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fetch failures include a clear catalog error message', () => {
  const result = spawnSync('node', [NODE_SCRIPT, '--api-url', 'http://127.0.0.1:1/invalid-endpoint', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GF_AWESOME_LLM_API_URL: 'http://127.0.0.1:1/invalid-endpoint' },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Could not fetch the Awesome LLM Apps catalog/)
})
