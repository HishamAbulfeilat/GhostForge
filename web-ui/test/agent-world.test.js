const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const appDir = path.resolve(__dirname, '../app/agent-world')
const modelPath = path.join(appDir, 'agent-world-model.ts')
const pagePath = path.join(appDir, 'page.tsx')
const viewPath = path.resolve(__dirname, '../components/AgentWorldView.tsx')
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
    agents: [{ state: 'working', id: 'worker', source: 'ghostforge-runtime' }],
    tasks: [{ id: 'T-1', title: 'Test', status: 'in-progress', source: 'ghostforge-runtime' }],
    events: [{ from: 'boss', text: 'Started', ts: '2026-10-01T10:00:00Z', type: 'team.message', source: 'ghostforge-runtime' }],
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
  assert.deepEqual(data.sessions, [{ id: 'session-1', connectorId: 'remote-desk', connectorSource: undefined, source: 'remote-desk' }])
  assert.deepEqual(data.agents, [{ id: 'remote-agent', source: 'remote-desk', connectorSource: undefined }])
  assert.deepEqual(data.tasks, [{ id: 'remote-task', source: 'remote-desk', connectorSource: undefined }])
  assert.deepEqual(data.events, [{ type: 'connector.error', error: 'Heartbeat timed out', source: 'remote-desk', connectorSource: undefined }])
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

test('product Agent World requests the authenticated public snapshot shape', async () => {
  const calls = []
  const fetcher = async url => {
    calls.push(url)
    return response(200, { snapshot: { agents: {}, tasks: [], messages: [] }, connectorSnapshot: { connectors: [] } })
  }

  const result = await loadAgentWorld(fetcher, () => assert.fail('Must not redirect'), 'product')
  assert.equal(result.status, 'loaded')
  assert.deepEqual(calls, ['/api/agents?view=public'])
})

test('API errors and unreadable record values are surfaced without rendering objects', async () => {
  await assert.rejects(
    loadAgentWorld(async () => response(500, { error: 'Snapshot unavailable' }), () => {}),
    /Snapshot unavailable/,
  )
  assert.deepEqual(recordText({ value: { nested: true }, state: 'offline' }, ['value', 'state']), ['state: offline'])
})

test('Agent World includes responsive accessible empty, loading, and error states', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  const source = fs.readFileSync(viewPath, 'utf8')
  const navbar = fs.readFileSync(navbarPath, 'utf8')

  assert.match(page, /variant="product"/)
  assert.match(source, /No real Agent World records yet/)
  assert.match(source, /never creates placeholder occupancy/)
  assert.match(source, /role="alert"/)
  assert.match(source, /role="status"/)
  assert.match(source, /overflow-x-auto/)
  assert.match(source, /min-w-\[900px\]/)
  assert.match(navbar, /href: '\/agent-world'/)
})
