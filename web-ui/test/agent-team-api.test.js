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
  normalizeSessionConnectorConfig,
  readConnectorSnapshot,
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

test('add preserves leader, assignee, workflow, and acceptance metadata', () => {
  const normalized = normalizeAgentTeamAction({
    action: 'add',
    title: 'Ship orchestrator',
    kind: 'feature',
    leader: 'copilot',
    assignee: 'qa',
    workflow: 'ordered',
    dependencies: 'T-100, T-101',
    acceptanceCriteria: ['Test coverage', 'Health passes'],
  })

  assert.equal(normalized.action, 'add')
  assert.equal(normalized.leader, 'copilot')
  assert.equal(normalized.assignee, 'qa')
  assert.equal(normalized.workflow, 'ordered')
  assert.deepEqual(normalized.dependencies, ['T-100', 'T-101'])
  assert.deepEqual(normalized.acceptanceCriteria, ['Test coverage', 'Health passes'])
})

test('GF_AGENT_STATE is honored when reading snapshots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-snapshot-'))
  const stateDir = path.join(root, 'custom-state')
  fs.mkdirSync(path.join(root, '.agent-sync'), { recursive: true })
  fs.mkdirSync(stateDir, { recursive: true })

  fs.writeFileSync(path.join(root, '.agent-sync', 'team.json'), JSON.stringify({
    agents: {
      copilot: { provider: 'configured-copilot' },
      configuredOnly: { provider: 'configured-only' },
    },
  }))
  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({
    health: 82,
    pid: process.pid,
    phase: 7,
    agents: {
      copilot: { provider: 'reported-copilot', state: 'working', task: 'T-001', model: 'gpt-4', since: '2024-01-01T00:00:00Z', cooldownUntil: '2024-01-01T00:00:00Z' },
      reportedOnly: { provider: 'reported-only', state: 'idle' },
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
    assert.deepEqual(Object.keys(snapshot.snapshot.agents), ['copilot', 'configuredOnly', 'reportedOnly'])
    assert.equal(snapshot.snapshot.agents.copilot.provider, 'configured-copilot')
    assert.equal(snapshot.snapshot.agents.configuredOnly.provider, 'configured-only')
    assert.equal(snapshot.snapshot.agents.reportedOnly.provider, 'reported-only')
    assert.equal(snapshot.snapshot.agents.copilot.state, 'working')
    assert.equal(snapshot.snapshot.agents.copilot.since, '2024-01-01T00:00:00Z')
    assert.equal(snapshot.snapshot.messages[0].text, 'hello')
  } finally {
    if (previous === undefined) delete process.env.GF_AGENT_STATE
    else process.env.GF_AGENT_STATE = previous
  }
})

test('snapshot includes workflow leadership and task metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-metadata-'))
  const stateDir = path.join(root, '.agent-sync', 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  fs.mkdirSync(path.join(root, '.agent-sync'), { recursive: true })
  fs.writeFileSync(path.join(root, '.agent-sync', 'team.json'), JSON.stringify({
    boss: { leader: 'copilot' },
    agents: { copilot: { provider: 'copilot', role: 'lead', strengths: ['feature'] }, qa: { provider: 'copilot', strengths: ['test'] } },
  }))
  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({
    health: 98,
    pid: process.pid,
    phase: 4,
    boss: { leader: 'copilot' },
    agents: {
      copilot: { provider: 'copilot', state: 'working', task: 'T-042', model: 'gpt-5', since: '2024-02-01T00:00:00Z' },
      qa: { provider: 'copilot', state: 'idle', task: null, model: 'gpt-4o' },
    },
  }))
  fs.writeFileSync(path.join(stateDir, 'board.json'), JSON.stringify({
    phase: 4,
    workflow: { mode: 'ordered' },
    tasks: [{ id: 'T-042', title: 'Ship orchestrator', kind: 'feature', status: 'in-progress', owner: 'copilot', assignee: 'copilot', leader: 'copilot', dependencies: ['T-041'], acceptanceCriteria: ['Ship', 'Verify'] }],
  }))

  const snapshot = readAgentTeamSnapshot(root)
  assert.equal(snapshot.snapshot.workflow.leader, 'copilot')
  assert.equal(snapshot.snapshot.workflow.mode, 'ordered')
  assert.equal(snapshot.snapshot.agents.copilot.leader, true)
  assert.equal(snapshot.snapshot.agents.qa.leader, false)
  assert.equal(snapshot.snapshot.agents.copilot.role, 'lead')
  assert.equal(snapshot.snapshot.tasks[0].assignee, 'copilot')
  assert.deepEqual(snapshot.snapshot.tasks[0].dependencies, ['T-041'])
  assert.deepEqual(snapshot.snapshot.tasks[0].acceptanceCriteria, ['Ship', 'Verify'])
})

test('connector configs default to local-only and redact secrets', () => {
  const snapshot = readConnectorSnapshot(null)
  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.mode, 'local-only')
  assert.equal(snapshot.connectors[0].id, 'ghostforge-local')
  assert.equal(snapshot.connectors[0].source, 'local')
  assert.equal(snapshot.connectors[0].project, '.')
  assert.equal(snapshot.connectors[0].status, 'online')
  assert.equal(typeof snapshot.connectors[0].heartbeat, 'string')
  assert.equal(snapshot.connectors[0].staleAfterMs, 30000)
  assert.equal(snapshot.connectors[0].error, null)
  assert.equal(typeof snapshot.connectors[0].events[0].ts, 'string')
  assert.equal(snapshot.connectors[0].events[0].type, 'runtime.heartbeat')
  assert.equal(snapshot.connectors[0].events[0].source, 'local')
  assert.equal(snapshot.connectors[0].events[0].project, '.')

  const config = {
    id: 'cloud-sandbox',
    source: 'cloud',
    project: './web-ui',
    device: 'desk-1',
    provider: 'openai-compatible',
    allow: true,
    url: 'https://example.com/session',
    headers: { Authorization: 'Bearer secret', 'X-Trace': 'abc' },
  }

  const allowlisted = readConnectorSnapshot(config)
  assert.equal(allowlisted.mode, 'allowlisted')
  assert.equal(allowlisted.connectors[1].device, 'desk-1')
  assert.equal(allowlisted.connectors[1].source, 'cloud')
  assert.equal(allowlisted.connectors[1].project, 'web-ui')
  assert.equal(allowlisted.connectors[1].events[0].project, 'web-ui')
  assert.equal(allowlisted.connectors[1].events[0].device, 'desk-1')
  assert.equal(allowlisted.connectors[1].error, null)
  assert.equal(allowlisted.connectors[1].agents[0].provider, 'openai-compatible')
  assert.deepEqual(allowlisted.connectors[1].events[0], { ts: allowlisted.connectors[1].events[0].ts, type: 'session.heartbeat', source: 'cloud', project: 'web-ui', device: 'desk-1' })

  const rejected = readConnectorSnapshot({
    id: 'bad-connector',
    source: 'device',
    project: '../outside',
    allow: true,
  })
  assert.equal(rejected.connectors.at(-1).status, 'offline')
  assert.match(rejected.connectors.at(-1).error, /workspace root/i)
  assert.equal(rejected.connectors.at(-1).project, null)
  assert.equal(normalizeSessionConnectorConfig({ id: 'device', headers: { Authorization: 'Bearer bad' } }).headers.Authorization, '[redacted]')
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
