#!/usr/bin/env node

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { buildHelp, parseArgs, resolveCommand } = require('../cli/index.js')

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'cli', 'index.js')

function isolatedState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ghostforge-agents-'))
}

function runAgents(args, state) {
  return spawnSync(process.execPath, [CLI, 'agents', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GF_AGENT_STATE: state },
  })
}

test('agents is an alias for agent-team and preserves arguments', () => {
  assert.deepEqual(parseArgs(['agents', 'status']), { command: 'agent-team', args: ['status'] })
  assert.equal(resolveCommand('agents'), resolveCommand('agent-team'))
  assert.match(buildHelp(), /ghostforge agents\s+-> ghostforge agent-team/)
})

test('agents add forwards title and flags to team.mjs in isolated state', () => {
  const state = isolatedState()
  try {
    const result = runAgents(['add', 'Test task', '--kind', 'feature', '--area', 'cli,tests', '--from', 'test'], state)
    assert.equal(result.status, 0, result.stderr)
    const requests = fs.readFileSync(path.join(state, 'requests.jsonl'), 'utf8').trim().split('\n')
    assert.deepEqual(JSON.parse(requests[0]), {
      title: 'Test task',
      kind: 'feature',
      area: ['cli', 'tests'],
      agent: 'any',
      from: 'test',
    })
  } finally {
    fs.rmSync(state, { recursive: true, force: true })
  }
})

test('agents reports delegated command errors', () => {
  const state = isolatedState()
  try {
    const result = runAgents(['say', '--to', 'all'], state)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /usage: say --from <me>/)
  } finally {
    fs.rmSync(state, { recursive: true, force: true })
  }
})
