const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const {
  AGENT_SESSION_CONNECTOR_MAX_BYTES,
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

test('snapshots safely default missing and malformed status records', () => {
  const loadTypeScriptSnapshot = loadTypeScriptAgentTeamApi().readAgentTeamSnapshot

  for (const statusContent of [undefined, 'null', JSON.stringify({ agents: null, boss: null, workflow: null, pid: null })]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-missing-status-'))
    const stateDir = path.join(root, '.agent-sync', 'state')
    fs.mkdirSync(stateDir, { recursive: true })
    if (statusContent !== undefined) {
      fs.writeFileSync(path.join(stateDir, 'status.json'), statusContent)
    }

    const jsSnapshot = readAgentTeamSnapshot(root).snapshot
    const tsSnapshot = loadTypeScriptSnapshot(root).snapshot
    assert.deepEqual(tsSnapshot, jsSnapshot)
    assert.equal(jsSnapshot.health, null)
    assert.equal(jsSnapshot.running, false)
    assert.deepEqual(jsSnapshot.agents, {})
    assert.deepEqual(jsSnapshot.tasks, [])
    assert.deepEqual(jsSnapshot.messages, [])
    assert.equal(jsSnapshot.phase, 1)
    assert.deepEqual(jsSnapshot.workflow, { leader: null, mode: 'parallel', specialists: [] })
  }
})

test('connector snapshots default to local-only and do not fabricate online runtime data', async t => {
  const snapshot = await readConnectorSnapshot(null)
  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.mode, 'local-only')
  assert.equal(snapshot.connectors[0].id, 'ghostforge-local')
  assert.equal(snapshot.connectors[0].source, 'local')
  assert.equal(snapshot.connectors[0].project, '.')
  assert.equal(snapshot.connectors[0].status === 'online', snapshot.connectors[0].online)
  assert.equal(snapshot.connectors[0].agents.some(agent => agent.id === 'ghostforge'), false)
  assert.equal(snapshot.connectors[0].tasks.some(task => task.id === 'T-local'), false)
  assert.deepEqual(snapshot.connectors[0].sessions, [])
  assert.equal(snapshot.connectors[0].staleAfterMs, 30000)
  assert.equal(Array.isArray(snapshot.connectors[0].events), true)

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

  const originalFetch = global.fetch
  global.fetch = async () => mockJsonResponse({
    heartbeat: new Date().toISOString(),
    agents: [{ id: 'actual-remote-agent', provider: 'openai-compatible' }],
    tasks: [],
    sessions: [{ id: 'remote-session' }],
    events: [{ ts: new Date().toISOString(), type: 'session.heartbeat', project: 'web-ui', device: 'desk-1' }],
  })
  t.after(() => { global.fetch = originalFetch })
  const allowlisted = await readConnectorSnapshot(config)
  assert.equal(allowlisted.mode, 'allowlisted')
  assert.equal(allowlisted.connectors[1].device, 'desk-1')
  assert.equal(allowlisted.connectors[1].source, 'cloud')
  assert.equal(allowlisted.connectors[1].project, 'web-ui')
  assert.equal(allowlisted.connectors[1].events[0].project, 'web-ui')
  assert.equal(allowlisted.connectors[1].events[0].device, 'desk-1')
  assert.equal(allowlisted.connectors[1].error, null)
  assert.equal(allowlisted.connectors[1].agents[0].provider, 'openai-compatible')
  assert.equal(allowlisted.connectors[1].sessions[0].id, 'remote-session')
  assert.equal(allowlisted.connectors[1].sessions[0].source, 'cloud')
  assert.equal(allowlisted.connectors[1].sessions[0].project, 'web-ui')
  assert.equal(allowlisted.connectors[1].sessions[0].device, 'desk-1')
  assert.deepEqual(allowlisted.connectors[1].events[0], { ts: allowlisted.connectors[1].events[0].ts, type: 'session.heartbeat', source: 'cloud', project: 'web-ui', device: 'desk-1' })

  const rejected = await readConnectorSnapshot({
    id: 'bad-connector',
    source: 'device',
    project: '../outside',
    allow: true,
  })
  assert.equal(rejected.connectors.at(-1).status, 'offline')
  assert.match(rejected.connectors.at(-1).error, /workspace root/i)
  assert.equal(rejected.connectors.at(-1).project, null)
  assert.deepEqual(rejected.connectors.at(-1).sessions, [])
  assert.equal(normalizeSessionConnectorConfig({ id: 'device', headers: { Authorization: 'Bearer bad' } }).headers.Authorization, '[redacted]')
})

function createConnectorWorkspace({ agents = {}, tasks = [], pid = process.pid } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-connector-workspace-'))
  const stateDir = path.join(root, '.agent-sync', 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({ pid, agents }))
  fs.writeFileSync(path.join(stateDir, 'board.json'), JSON.stringify({ tasks }))
  return { root, stateDir }
}

function mockJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function loadTypeScriptAgentTeamApi() {
  const apiPath = path.resolve(__dirname, '../lib/agent-team-api.ts')
  const source = fs.readFileSync(apiPath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const loaded = new Module(apiPath, module)
  loaded.filename = apiPath
  loaded.paths = Module._nodeModulePaths(path.dirname(apiPath))
  loaded._compile(compiled, apiPath)
  return loaded.exports
}

test('TypeScript and JavaScript connector snapshot adapters stay behaviorally aligned', async t => {
  const { root } = createConnectorWorkspace({
    agents: { worker: { state: 'working', provider: 'copilot' } },
    tasks: [{ id: 'T-11', title: 'Real task', status: 'todo' }],
  })
  const previousFetch = global.fetch
  const heartbeat = new Date().toISOString()
  global.fetch = async () => mockJsonResponse({
    heartbeat,
    agents: [{ id: 'remote-agent', state: 'idle' }],
    tasks: [{ id: 'T-remote', title: 'Remote task' }],
    sessions: [{ id: 'remote-session', name: 'Remote session', secret: 'must-not-leak' }],
    events: [{ ts: heartbeat, type: 'heartbeat' }],
  })
  t.after(() => { global.fetch = previousFetch })
  const config = { id: 'remote', source: 'cloud', allow: true, url: 'https://remote.example/snapshot' }
  const jsSummary = await readConnectorSnapshot(config, root)
  const tsSummary = await loadTypeScriptAgentTeamApi().readConnectorSnapshot(config, root)
  assert.deepEqual(tsSummary, jsSummary)
})

test('local connector reflects runtime state and reports dead processes offline', async () => {
  const { root } = createConnectorWorkspace({
    agents: { worker: { state: 'working', provider: 'copilot', task: 'T-11' } },
    tasks: [{ id: 'T-11', title: 'Real task', status: 'in-progress', owner: 'worker' }],
  })
  const local = (await readConnectorSnapshot(null, root)).connectors[0]
  assert.equal(local.status, 'online')
  assert.deepEqual(local.sessions, [])
  assert.deepEqual(local.agents, [{
    id: 'worker',
    state: 'working',
    provider: 'copilot',
    task: 'T-11',
    role: 'agent',
    leader: false,
    strengths: [],
  }])
  assert.deepEqual(local.tasks[0], {
    id: 'T-11',
    title: 'Real task',
    kind: 'feature',
    status: 'in-progress',
    owner: 'worker',
    assignee: 'worker',
    dependencies: [],
    acceptanceCriteria: [],
  })
  assert.equal(local.events.length, 0)

  const offlineRoot = createConnectorWorkspace({ pid: Number.MAX_SAFE_INTEGER })
  const offline = (await readConnectorSnapshot(null, offlineRoot.root)).connectors[0]
  assert.equal(offline.status, 'offline')
  assert.equal(offline.online, false)
  assert.equal(offline.error, 'Runtime process is not running')
  assert.deepEqual(offline.sessions, [])
})

test('remote connector sessions are bounded, sanitized, and scoped to connector identity', async t => {
  const { root } = createConnectorWorkspace()
  const heartbeat = new Date().toISOString()
  const previousFetch = global.fetch
  global.fetch = async () => mockJsonResponse({
    heartbeat,
    sessions: [
      {
        sessionId: 's-1',
        name: 'Remote session',
        status: 'active',
        state: 'working',
        agent: 'worker-1',
        task: 'T-20',
        createdAt: heartbeat,
        updatedAt: 'invalid-date',
        source: 'spoofed',
        project: '../outside',
        device: 'spoofed-device',
        provider: 'spoofed-provider',
        token: 'must-not-leak',
        headers: { Authorization: 'must-not-leak' },
      },
      ...Array.from({ length: 105 }, (_, index) => ({
        id: `s-${index + 2}`,
        name: 'n'.repeat(520),
        extra: 'must-not-leak',
      })),
      { name: 'missing id is omitted' },
    ],
  })
  t.after(() => { global.fetch = previousFetch })

  const connector = (await readConnectorSnapshot({
    id: 'cloud-sessions',
    source: 'cloud',
    project: './web-ui',
    device: 'desk-1',
    provider: 'configured-provider',
    allow: true,
    url: 'https://cloud.example/snapshot',
  }, root)).connectors[1]

  assert.equal(connector.sessions.length, 100)
  assert.deepEqual(connector.sessions[0], {
    id: 's-1',
    source: 'cloud',
    project: 'web-ui',
    device: 'desk-1',
    provider: 'configured-provider',
    name: 'Remote session',
    status: 'active',
    state: 'working',
    agent: 'worker-1',
    task: 'T-20',
    createdAt: new Date(heartbeat).toISOString(),
  })
  assert.ok(connector.sessions.every(session => session.name.length <= 512))
  const serialized = JSON.stringify(connector.sessions)
  assert.equal(serialized.includes('must-not-leak'), false)
  assert.equal(serialized.includes('spoofed'), false)
  assert.equal(serialized.includes('../outside'), false)
})

test('remote connector rejects a non-array sessions field and returns an empty offline projection', async t => {
  const { root } = createConnectorWorkspace()
  const previousFetch = global.fetch
  global.fetch = async () => mockJsonResponse({
    heartbeat: new Date().toISOString(),
    sessions: { id: 'not-an-array' },
  })
  t.after(() => { global.fetch = previousFetch })
  const connector = (await readConnectorSnapshot({
    id: 'invalid-sessions',
    source: 'cloud',
    allow: true,
    url: 'https://cloud.example/snapshot',
  }, root)).connectors[1]

  assert.equal(connector.status, 'offline')
  assert.equal(connector.error, 'Connector sessions must be an array')
  assert.deepEqual(connector.sessions, [])
})

test('local connector bounds agent/task counts and all projected field/list sizes', async () => {
  const agents = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [
    `agent-${index}-${'a'.repeat(300)}`,
    { state: 'x'.repeat(1000), strengths: Array(30).fill('s'.repeat(300)) },
  ]))
  const tasks = Array.from({ length: 150 }, (_, index) => ({
    id: `T-${index}`,
    title: 't'.repeat(2000),
    dependencies: Array(30).fill('d'.repeat(300)),
    acceptanceCriteria: Array(30).fill('c'.repeat(300)),
  }))
  const { root } = createConnectorWorkspace({ agents, tasks })
  const local = (await readConnectorSnapshot(null, root)).connectors[0]
  assert.equal(local.agents.length, 100)
  assert.equal(local.tasks.length, 100)
  assert.ok(local.agents.every(agent => agent.id.length <= 128 && agent.state.length <= 256 && agent.strengths.length <= 10))
  assert.ok(local.tasks.every(task => task.title.length <= 512 && task.dependencies.length <= 10 && task.acceptanceCriteria.length <= 10))
  assert.ok(local.tasks.every(task => task.dependencies.every(item => item.length <= 160)))
})

test('remote connector snapshots are validated and request headers stay with their connector', async t => {
  const { root } = createConnectorWorkspace()
  const previousFetch = global.fetch
  const requests = []
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization })
    return mockJsonResponse({
      heartbeat: new Date().toISOString(),
      agents: [{ id: 'actual-agent', state: 'working', provider: 'remote-provider' }],
      tasks: [{ id: 'T-remote', title: 'Remote task', status: 'running' }],
      events: [{ ts: new Date().toISOString(), type: 'session.started', text: 'actual event' }],
    })
  }
  t.after(() => { global.fetch = previousFetch })

  const result = await readConnectorSnapshot([
    {
      id: 'cloud-sandbox',
      source: 'cloud',
      project: './web-ui',
      device: 'desk-1',
      provider: 'openai-compatible',
      allow: true,
      url: 'https://cloud.example/snapshot',
      headers: { Authorization: 'cloud-secret' },
    },
    {
      id: 'device-sandbox',
      source: 'device',
      project: '.',
      allow: true,
      url: 'https://device.example/snapshot',
      headers: { Authorization: 'device-secret' },
    },
  ], root)

  assert.equal(result.mode, 'allowlisted')
  assert.deepEqual(requests, [
    { url: 'https://cloud.example/snapshot', authorization: 'cloud-secret' },
    { url: 'https://device.example/snapshot', authorization: 'device-secret' },
  ])
  const cloud = result.connectors[1]
  assert.equal(cloud.device, 'desk-1')
  assert.equal(cloud.source, 'cloud')
  assert.equal(cloud.project, 'web-ui')
  assert.equal(cloud.status, 'online')
  assert.equal(cloud.agents[0].id, 'actual-agent')
  assert.equal(cloud.tasks[0].id, 'T-remote')
  assert.equal(cloud.events[0].type, 'session.started')
  assert.equal(JSON.stringify(result).includes('cloud-secret'), false)
  assert.equal(JSON.stringify(result).includes('device-secret'), false)
})

test('duplicate connector IDs fail closed before making any request', async t => {
  const previousFetch = global.fetch
  let requests = 0
  global.fetch = async () => {
    requests++
    return mockJsonResponse({})
  }
  t.after(() => { global.fetch = previousFetch })
  await assert.rejects(readConnectorSnapshot([
    { id: 'same-id', source: 'cloud', allow: true, url: 'https://one.example', headers: { Authorization: 'first' } },
    { id: 'SAME-ID', source: 'device', allow: true, url: 'https://two.example', headers: { Authorization: 'second' } },
  ]), /Duplicate connector IDs/)
  assert.equal(requests, 0)
})

test('stale and oversized remote snapshots are not reported as online', async t => {
  const { root } = createConnectorWorkspace()
  const previousFetch = global.fetch
  global.fetch = async () => mockJsonResponse({
    heartbeat: new Date(Date.now() - 60_000).toISOString(),
    status: 'online',
    agents: [{ id: 'reported-agent', state: 'ready' }],
    tasks: [],
  })
  t.after(() => { global.fetch = previousFetch })

  const stale = (await readConnectorSnapshot({
    id: 'stale-cloud',
    source: 'cloud',
    allow: true,
    url: 'https://cloud.example/snapshot',
    staleAfterMs: 1_000,
  }, root)).connectors[1]
  assert.equal(stale.status, 'stale')
  assert.equal(stale.online, false)
  assert.equal(stale.stale, true)
  assert.equal(stale.agents[0].id, 'reported-agent')

  global.fetch = async () => new Response(new Uint8Array(AGENT_SESSION_CONNECTOR_MAX_BYTES + 1))
  const oversized = (await readConnectorSnapshot({
    id: 'large-cloud',
    source: 'cloud',
    allow: true,
    url: 'https://cloud.example/snapshot',
  }, root)).connectors[1]
  assert.equal(oversized.status, 'offline')
  assert.equal(oversized.online, false)
  assert.equal(oversized.error, 'Connector response exceeded the size limit')
  assert.deepEqual(oversized.agents, [])

  global.fetch = async () => mockJsonResponse({ heartbeat: 'not-a-timestamp', agents: [{ id: 'fake' }] })
  const invalid = (await readConnectorSnapshot({
    id: 'invalid-cloud',
    source: 'cloud',
    allow: true,
    url: 'https://cloud.example/snapshot',
  }, root)).connectors[1]
  assert.equal(invalid.status, 'offline')
  assert.equal(invalid.online, false)
  assert.equal(invalid.error, 'Connector heartbeat is missing or invalid')
  assert.deepEqual(invalid.agents, [])

  global.fetch = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  const timeout = (await readConnectorSnapshot({
    id: 'timeout-cloud',
    source: 'cloud',
    allow: true,
    url: 'https://cloud.example/snapshot',
    timeoutMs: 250,
  }, root)).connectors[1]
  assert.equal(timeout.status, 'offline')
  assert.equal(timeout.online, false)
  assert.equal(timeout.error, 'Connector request timed out')
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
