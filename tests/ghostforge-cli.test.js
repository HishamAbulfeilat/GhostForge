#!/usr/bin/env node

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildHelp, parseArgs, resolveCommand, main } = require('../cli/index.js')

const ROOT = path.resolve(__dirname, '..')

test('ghostforge help includes the supported commands', () => {
  const help = buildHelp()
  assert.match(help, /ghostforge marketplace/)
  assert.match(help, /ghostforge agent-team/)
  assert.match(help, /ghostforge workflows/)
  assert.match(help, /ghostforge jobs/)
  assert.match(help, /users/)
  assert.match(help, /collab/)
  assert.match(help, /device-status/)
  assert.match(help, /awesome-llm-apps/)
  assert.match(help, /ghostforge package-apps/)
})

test('parseArgs normalizes terminal aliases', () => {
  assert.deepEqual(parseArgs(['team', 'status']), { command: 'agent-team', args: ['status'] })
  assert.deepEqual(parseArgs(['workflow', 'list']), { command: 'workflows', args: ['list'] })
  assert.deepEqual(parseArgs(['users', 'list']), { command: 'users', args: ['list'] })
  assert.deepEqual(parseArgs(['collab', 'create']), { command: 'collab', args: ['create'] })
  assert.equal(resolveCommand('jobs').summary.includes('Job Hunter'), true)
  assert.equal(resolveCommand('users').summary.includes('users'), true)
  assert.match(resolveCommand('package-apps').script, /package-apps\.mjs$/)
})

test('main dispatches the agent-team status command', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostforge-team-status-'))
  try {
    const exit = main(['team', 'status'], { env: { ...process.env, GF_AGENT_STATE: state } })
    assert.equal(exit, 0)
  } finally {
    fs.rmSync(state, { recursive: true, force: true })
  }
})

test('main dispatches the user help command and rejects unknown commands', () => {
  const usersHelp = main(['users', '--help'], { env: process.env })
  assert.equal(usersHelp, 0)

  const unknown = main(['nope'], { env: process.env, stdout: process.stdout, stderr: process.stderr })
  assert.equal(unknown, 1)
})

test('main dispatches packaged-app dry runs through the bounded builder', () => {
  const exit = main(['package-apps', 'linux', '--dry-run'], { env: process.env })
  assert.equal(exit, 0)
})

test('ghostforge --help exits cleanly via the shell launcher', () => {
  const result = spawnSync('bash', [path.join(ROOT, 'ghostforge'), '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /ghostforge marketplace/)
  assert.match(result.stdout, /ghostforge users/)
})
