const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  resolveWorkspaceRoot,
  normalizeAgentTeamAction,
  readAgentTeamSnapshot,
  readRequestJsonWithLimit,
} = require('../lib/agent-team-api.js')

test('resolveWorkspaceRoot blocks symlink escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-team-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-outside-'))
  const escape = path.join(root, 'escape')
  fs.symlinkSync(outside, escape, 'junction')

  assert.throws(() => resolveWorkspaceRoot(root, escape), /Workspace escape detected/)
  assert.equal(resolveWorkspaceRoot(root, path.join(root, 'inside')), path.join(root, 'inside'))
})

test('say defaults are applied before validation', () => {
  const normalized = normalizeAgentTeamAction({ action: 'say', message: 'hi' })
  assert.deepEqual(normalized, { action: 'say', from: 'boss', to: 'all', message: 'hi' })

  assert.throws(() => normalizeAgentTeamAction({ action: 'say', from: 'boss' }), /requires a message value/)
})

test('GF_AGENT_STATE is honored when reading snapshots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-snapshot-'))
  const stateDir = path.join(root, 'custom-state')
  fs.mkdirSync(stateDir, { recursive: true })

  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({
    health: 82,
    pid: process.pid,
    phase: 7,
    agents: {
      copilot: { state: 'working', task: 'T-001', model: 'gpt-4', cooldownUntil: '2024-01-01T00:00:00Z' },
    },
  }))

  fs.writeFileSync(path.join(stateDir, 'board.json'), JSON.stringify({
    phase: 7,
    tasks: [{ id: 'T-001', title: 'Ship API', kind: 'feature', status: 'in-progress', owner: 'copilot' }],
  }))

  fs.writeFileSync(path.join(stateDir, 'messages.jsonl'), JSON.stringify({
    ts: '2024-01-01T00:00:00.000Z',
    from: 'boss',
    to: 'copilot',
    text: 'hello',
  }) + '\n')

  const previous = process.env.GF_AGENT_STATE
  process.env.GF_AGENT_STATE = stateDir
  try {
    const snapshot = readAgentTeamSnapshot(root)
    assert.equal(snapshot.snapshot.health, 82)
    assert.equal(snapshot.snapshot.phase, 7)
    assert.equal(snapshot.snapshot.agents.copilot.provider, null)
    assert.equal(snapshot.snapshot.agents.copilot.state, 'working')
    assert.equal(snapshot.snapshot.messages[0].text, 'hello')
  } finally {
    if (previous === undefined) delete process.env.GF_AGENT_STATE
    else process.env.GF_AGENT_STATE = previous
  }
})

test('request json can be read from a streaming body without Content-Length', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"action":"say","message":"hello"}'))
      controller.close()
    },
  })

  const result = await readRequestJsonWithLimit({ body: stream }, 1024 * 1024)
  assert.deepEqual(result, { action: 'say', message: 'hello' })
})
