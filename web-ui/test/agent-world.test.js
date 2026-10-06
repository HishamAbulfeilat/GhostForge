const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const appDir = path.resolve(__dirname, '../app/agent-world')
const modelPath = path.join(appDir, 'agent-world-model.ts')
const pagePath = path.join(appDir, 'page.tsx')
const navbarPath = path.resolve(__dirname, '../components/Navbar.tsx')
const compiledModel = ts.transpileModule(fs.readFileSync(modelPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const modelModule = new Module(modelPath, module)
modelModule.filename = modelPath
modelModule.paths = Module._nodeModulePaths(path.dirname(modelPath))
modelModule._compile(compiledModel, modelPath)
const { collectAgentWorldData, loadAgentWorld, recordText } = modelModule.exports

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

test('Agent World uses available snapshot data and does not synthesize empty sessions', () => {
  const snapshot = {
    agents: { worker: { state: 'working' } },
    tasks: [{ id: 'T-1', title: 'Test', status: 'in-progress' }],
    messages: [{ from: 'boss', text: 'Started', ts: '2026-10-01T10:00:00Z' }],
  }

  assert.deepEqual(collectAgentWorldData(snapshot), {
    connectors: [],
    sessions: [],
    agents: [{ state: 'working', id: 'worker', source: 'GhostForge runtime' }],
    tasks: [{ id: 'T-1', title: 'Test', status: 'in-progress', source: 'GhostForge runtime' }],
    events: [{ from: 'boss', text: 'Started', ts: '2026-10-01T10:00:00Z', type: 'team.message', source: 'GhostForge runtime' }],
  })
})

test('Agent World includes federated sessions, agents, tasks, events and connector errors', () => {
  const connector = {
    id: 'remote-desk',
    status: 'offline',
    stale: true,
    error: 'Heartbeat timed out',
    sessions: [{ id: 'session-1' }],
    agents: [{ id: 'remote-agent' }],
    tasks: [{ id: 'remote-task' }],
    events: [{ type: 'connector.error', error: 'Heartbeat timed out' }],
  }
  const data = collectAgentWorldData({ agents: {}, tasks: [], messages: [] }, {
    mode: 'allowlisted',
    connectors: [connector],
  })

  assert.equal(data.connectors[0].error, 'Heartbeat timed out')
  assert.deepEqual(data.sessions, [{ id: 'session-1' }])
  assert.deepEqual(data.agents, [{ id: 'remote-agent', source: 'remote-desk' }])
  assert.deepEqual(data.tasks, [{ id: 'remote-task', source: 'remote-desk' }])
  assert.deepEqual(data.events, [{ type: 'connector.error', error: 'Heartbeat timed out', source: 'remote-desk' }])
})

test('Agent World removes duplicate ghostforge-local agents and tasks from the API response', async () => {
  const apiPayload = {
    snapshot: {
      agents: { copilot: { provider: 'copilot', state: 'working' } },
      tasks: [{ id: 'T-1', title: 'Local task', status: 'in-progress' }],
      messages: [],
    },
    connectorSnapshot: {
      connectors: [
        {
          id: 'ghostforge-local',
          agents: [
            { id: 'copilot', provider: 'copilot', state: 'working' },
            { id: 'local-helper', state: 'idle' },
          ],
          tasks: [
            { id: 'T-1', title: 'Local task', status: 'in-progress' },
            { id: 'T-2', title: 'Another local task', status: 'todo' },
          ],
        },
        {
          id: 'remote-desk',
          agents: [{ id: 'copilot', provider: 'remote', state: 'working' }],
          tasks: [{ id: 'T-1', title: 'Remote task', status: 'todo' }],
        },
      ],
    },
  }
  const loaded = await loadAgentWorld(async () => response(200, apiPayload), () => {})

  assert.equal(loaded.status, 'loaded')
  if (loaded.status !== 'loaded') assert.fail('Expected the agents API response to load')

  const data = collectAgentWorldData(loaded.snapshot, loaded.connectorSummary)
  assert.deepEqual(data.agents, [
    { provider: 'copilot', state: 'working', id: 'copilot', source: 'GhostForge runtime' },
    { id: 'local-helper', state: 'idle', source: 'ghostforge-local' },
    { id: 'copilot', provider: 'remote', state: 'working', source: 'remote-desk' },
  ])
  assert.deepEqual(data.tasks, [
    { id: 'T-1', title: 'Local task', status: 'in-progress', source: 'GhostForge runtime' },
    { id: 'T-2', title: 'Another local task', status: 'todo', source: 'ghostforge-local' },
    { id: 'T-1', title: 'Remote task', status: 'todo', source: 'remote-desk' },
  ])
})

test('403 from agents redirects signed-out visitors after checking auth/me', async () => {
  const calls = []
  let redirects = 0
  const fetcher = async url => {
    calls.push(url)
    return url === '/api/agents' ? response(403, { error: 'Admin tools permission required.' }) : response(401, { error: 'Unauthorized' })
  }

  assert.deepEqual(await loadAgentWorld(fetcher, () => { redirects += 1 }), { status: 'redirecting' })
  assert.deepEqual(calls, ['/api/agents', '/api/auth/me'])
  assert.equal(redirects, 1)
})

test('403 from agents remains a permission error for signed-in users without admin_tools', async () => {
  const fetcher = async url => url === '/api/agents'
    ? response(403, { error: 'Admin tools permission required.' })
    : response(200, { user: { role: 'user', permissions: ['chat'] } })

  assert.deepEqual(await loadAgentWorld(fetcher, () => assert.fail('Must not redirect a signed-in user')), {
    status: 'denied',
    message: 'Your account needs the admin_tools permission to access Agent World.',
  })
})

test('API errors and unreadable record values are surfaced without rendering objects', async () => {
  await assert.rejects(
    loadAgentWorld(async () => response(500, { error: 'Snapshot unavailable' }), () => {}),
    /Snapshot unavailable/,
  )
  assert.deepEqual(recordText({ value: { nested: true }, state: 'offline' }, ['value', 'state']), ['state: offline'])
})

test('Agent World includes responsive accessible empty, loading, and error states', () => {
  const source = fs.readFileSync(pagePath, 'utf8')
  const navbar = fs.readFileSync(navbarPath, 'utf8')

  assert.match(source, /No sessions were reported by the available snapshots\./)
  assert.match(source, /No connector sources were reported by the agents API\./)
  assert.match(source, /role="alert"/)
  assert.match(source, /role="status"/)
  assert.match(source, /sm:grid-cols-2/)
  assert.match(source, /xl:grid-cols-3/)
  assert.match(navbar, /href: '\/agent-world'/)
})
