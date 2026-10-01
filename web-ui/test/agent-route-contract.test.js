const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/agents/route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')
const agentTeamApi = require('../lib/agent-team-api.js')
const { sanitizePublicAgentResponse } = require('../lib/agent-public-snapshot.ts')
const state = { user: null, commands: [], connectorReads: 0, commandResult: { status: 0, stdout: 'mock output', stderr: '' } }
const snapshotFixture = {
  snapshot: {
    health: 90,
    running: false,
    agents: {
      copilot: { provider: 'copilot', state: 'idle', task: null, model: null, since: null, cooldownUntil: null },
    },
    tasks: [{ id: 'T-030', title: 'Route tests', kind: 'test', status: 'in-progress', owner: 'copilot' }],
    messages: [{ ts: '2026-10-01T00:00:00.000Z', from: 'boss', to: 'all', text: 'hello' }],
    phase: 3,
  },
}

const dependencies = {
  'next/server': {
    NextResponse: {
      json(body, init = {}) {
        return { status: init.status ?? 200, json: async () => body }
      },
    },
  },
  '@/lib/auth': {
    getCurrentUser: async () => state.user,
    hasPermission: (user, permission) => Boolean(
      user && (user.role === 'admin' || user.permissions?.includes(permission)),
    ),
  },
  '@/lib/agent-team-api': {
    ...agentTeamApi,
    runAgentTeamCommand(action, params, options = {}) {
      return agentTeamApi.runAgentTeamCommand(action, params, {
        ...options,
        env: { ...options.env, GF_AGENT_STATE: path.resolve(__dirname, '../../.agent-sync/state') },
        runner(executable, args) {
          state.commands.push({ executable, args: args.slice(1) })
          return state.commandResult
        },
      })
    },
    readAgentTeamSnapshot: () => snapshotFixture,
    readConnectorSnapshot: (...args) => {
      state.connectorReads++
      return agentTeamApi.readConnectorSnapshot(...args)
    },
  },
  '@/lib/agent-public-snapshot': { sanitizePublicAgentResponse },
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(dependencies, request)) return dependencies[request]
  return originalLoad.call(this, request, parent, isMain)
}

let route
try {
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const routeModule = new Module(routePath, module)
  routeModule.filename = routePath
  routeModule.paths = Module._nodeModulePaths(path.dirname(routePath))
  routeModule._compile(compiled, routePath)
  route = routeModule.exports
} finally {
  Module._load = originalLoad
}

function requestWithText(text) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return { body }
}

async function responseBody(response) {
  return response.json()
}

const admin = { role: 'admin', permissions: [] }

test('private GET and every POST require admin_tools without reading connectors first', async t => {
  const previousConnectorConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  process.env.GF_AGENT_SESSION_CONNECTORS = JSON.stringify([{
    id: 'private-connector',
    source: 'cloud',
    allow: true,
  }])
  state.connectorReads = 0
  try {
    state.user = null
    const unauthenticatedGet = await route.GET({})
    assert.equal(unauthenticatedGet.status, 401)
    assert.deepEqual(await responseBody(unauthenticatedGet), { error: 'Authentication required.' })

    for (const user of [null, { role: 'user', permissions: [] }]) {
      state.user = user
      await t.test(`POST rejects ${user ? 'non-admin' : 'unauthenticated'} requests`, async () => {
        const response = await route.POST(requestWithText('{}'))
        assert.equal(response.status, 403)
        assert.deepEqual(await responseBody(response), { error: 'Admin tools permission required.' })
      })
    }
    state.user = { role: 'user', permissions: [] }
    const forbiddenGet = await route.GET({})
    assert.equal(forbiddenGet.status, 403)
    assert.deepEqual(await responseBody(forbiddenGet), { error: 'Admin tools permission required.' })
    assert.deepEqual(state.commands, [])
    assert.equal(state.connectorReads, 0)
  } finally {
    if (previousConnectorConfig === undefined) delete process.env.GF_AGENT_SESSION_CONNECTORS
    else process.env.GF_AGENT_SESSION_CONNECTORS = previousConnectorConfig
  }
})

test('public GET preserves bounded connector data while removing maintainer-only fields server-side', async () => {
  state.user = { role: 'user', permissions: [] }
  snapshotFixture.snapshot.agents.copilot.task = 'Inspect C:\\Users\\operator\\repo token=private'
  snapshotFixture.snapshot.agents.copilot.model = 'private-model'
  const previousConnectorConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  delete process.env.GF_AGENT_SESSION_CONNECTORS
  try {
    const response = await route.GET({ nextUrl: { searchParams: new URLSearchParams('view=public') } })
    const body = await responseBody(response)

    assert.equal(response.status, 200)
    assert.equal(body.snapshot.agents.copilot.model, undefined)
    assert.match(body.snapshot.agents.copilot.task, /\[local path redacted\]/)
    assert.match(body.snapshot.agents.copilot.task, /token=\[redacted\]/)
    assert.deepEqual(body.snapshot.messages, [])
    assert.equal(body.connectorSnapshot.connectors[0].id, 'ghostforge-local')
    assert.equal(body.connectorSnapshot.connectors[0].device, null)
    assert.equal(body.connectorSnapshot.connectors[0].provider, null)
    assert.deepEqual(body.connectorSnapshot.connectors[0].sessions, [])
    assert.deepEqual(body.connectorSnapshot.connectors[0].events, [])
  } finally {
    snapshotFixture.snapshot.agents.copilot.task = null
    snapshotFixture.snapshot.agents.copilot.model = null
    if (previousConnectorConfig === undefined) delete process.env.GF_AGENT_SESSION_CONNECTORS
    else process.env.GF_AGENT_SESSION_CONNECTORS = previousConnectorConfig
  }
})

test('public response sanitizer removes federated sessions, events, models, devices, and secrets', () => {
  const sanitized = sanitizePublicAgentResponse({
    snapshot: {
      health: 99,
      running: true,
      agents: {
        worker: {
          provider: 'copilot',
          state: 'working',
          task: 'Read /Users/operator/repo api_key=private',
          model: 'private-model',
          branch: 'agent/private',
          strengths: ['security'],
        },
      },
      tasks: [],
      messages: [{ from: 'boss', to: 'worker', text: 'private message' }],
      phase: 4,
      workflow: { leader: 'boss', mode: 'parallel', specialists: ['worker'] },
    },
  }, {
    version: 1,
    mode: 'allowlisted',
    connectors: [{
      id: 'private-device',
      source: 'device',
      project: 'GhostForge',
      device: 'operator-laptop',
      provider: 'copilot-app',
      status: 'online',
      heartbeat: '2026-10-01T12:00:00.000Z',
      agents: [{ id: 'worker', model: 'private-model', state: 'working' }],
      tasks: [],
      sessions: [{ id: 'session-private', task: 'secret=value' }],
      events: [{ from: 'worker', to: 'boss', text: 'private message' }],
    }],
  })

  const snapshot = sanitized.snapshot
  const connector = sanitized.connectorSnapshot.connectors[0]
  assert.equal(snapshot.agents.worker.model, undefined)
  assert.equal(snapshot.agents.worker.branch, undefined)
  assert.equal(snapshot.agents.worker.strengths, undefined)
  assert.match(snapshot.agents.worker.task, /\[local path redacted\].*api_key=\[redacted\]/)
  assert.deepEqual(snapshot.messages, [])
  assert.deepEqual(snapshot.workflow.specialists, [])
  assert.equal(connector.device, null)
  assert.equal(connector.provider, null)
  assert.deepEqual(connector.sessions, [])
  assert.deepEqual(connector.events, [])
  assert.equal(connector.agents[0].model, undefined)
})

test('GET returns the wrapped agent-team snapshot contract', async () => {
  state.user = admin
  const previousConnectorConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  delete process.env.GF_AGENT_SESSION_CONNECTORS
  try {
    const response = await route.GET({})
    const body = await responseBody(response)

    assert.equal(response.status, 200)
    assert.deepEqual(body.snapshot, snapshotFixture.snapshot)
    assert.equal(body.connectorSnapshot.version, 1)
    assert.equal(body.connectorSnapshot.mode, 'local-only')
    assert.deepEqual(body.connectorSnapshot.connectors.map(connector => connector.id), ['ghostforge-local'])
    const { snapshot } = body
    assert.equal(typeof snapshot.health === 'number' || snapshot.health === null, true)
    assert.equal(typeof snapshot.running, 'boolean')
    assert.equal(typeof snapshot.agents, 'object')
    assert.equal(Array.isArray(snapshot.tasks), true)
    assert.equal(Array.isArray(snapshot.messages), true)
    assert.equal(typeof snapshot.phase, 'number')
    for (const agent of Object.values(snapshot.agents)) {
      assert.deepEqual(Object.keys(agent), ['provider', 'state', 'task', 'model', 'since', 'cooldownUntil'])
    }
    for (const task of snapshot.tasks) {
      assert.deepEqual(Object.keys(task), ['id', 'title', 'kind', 'status', 'owner'])
    }
  } finally {
    if (previousConnectorConfig === undefined) delete process.env.GF_AGENT_SESSION_CONNECTORS
    else process.env.GF_AGENT_SESSION_CONNECTORS = previousConnectorConfig
  }
})

test('GET includes configured connector summaries from the real connector adapter', async () => {
  state.user = admin
  const previousConnectorConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  process.env.GF_AGENT_SESSION_CONNECTORS = JSON.stringify([{
    id: 'cloud-sandbox',
    source: 'cloud',
    project: 'web-ui',
    device: 'desk-1',
    provider: 'openai-compatible',
    allow: true,
    headers: { Authorization: 'must-not-leak' },
  }])

  try {
    const response = await route.GET({})
    const body = await responseBody(response)
    const connector = body.connectorSnapshot.connectors.find(item => item.id === 'cloud-sandbox')

    assert.equal(response.status, 200)
    assert.deepEqual(body.snapshot, snapshotFixture.snapshot)
    assert.equal(body.connectorSnapshot.mode, 'allowlisted')
    assert.equal(connector.source, 'cloud')
    assert.equal(connector.project, 'web-ui')
    assert.equal(connector.device, 'desk-1')
    assert.equal(connector.provider, 'openai-compatible')
    assert.equal(JSON.stringify(body).includes('must-not-leak'), false)
    assert.equal(state.connectorReads > 0, true)
  } finally {
    if (previousConnectorConfig === undefined) delete process.env.GF_AGENT_SESSION_CONNECTORS
    else process.env.GF_AGENT_SESSION_CONNECTORS = previousConnectorConfig
  }
})

test('GET rejects malformed connector configuration without returning a snapshot', async () => {
  state.user = admin
  const previousConnectorConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  process.env.GF_AGENT_SESSION_CONNECTORS = '{'

  try {
    const response = await route.GET({})
    assert.equal(response.status, 500)
    assert.deepEqual(await responseBody(response), {
      error: 'GF_AGENT_SESSION_CONNECTORS must be valid JSON.',
    })
  } finally {
    if (previousConnectorConfig === undefined) delete process.env.GF_AGENT_SESSION_CONNECTORS
    else process.env.GF_AGENT_SESSION_CONNECTORS = previousConnectorConfig
  }
})

test('GET rejects oversized connector configuration', async () => {
  state.user = admin
  const previousConnectorConfig = process.env.GF_AGENT_SESSION_CONNECTORS
  process.env.GF_AGENT_SESSION_CONNECTORS = `[${' '.repeat(65_535)}]`

  try {
    const response = await route.GET({})
    assert.equal(response.status, 500)
    assert.deepEqual(await responseBody(response), {
      error: 'GF_AGENT_SESSION_CONNECTORS exceeds the 65536 byte limit.',
    })
  } finally {
    if (previousConnectorConfig === undefined) delete process.env.GF_AGENT_SESSION_CONNECTORS
    else process.env.GF_AGENT_SESSION_CONNECTORS = previousConnectorConfig
  }
})

test('POST dispatches start, stop, say, and add without launching the boss', async t => {
  state.user = admin
  const cases = [
    { name: 'start', payload: { action: 'start' }, args: ['start'] },
    { name: 'stop', payload: { action: 'stop' }, args: ['stop'] },
    {
      name: 'say',
      payload: { action: 'say', message: 'hello team' },
      args: ['say', '--from', 'boss', '--to', 'all', 'hello team'],
    },
    {
      name: 'add',
      payload: { action: 'add', title: 'Add route tests', kind: 'test', area: ['web-ui/test'] },
      args: ['add', 'Add route tests', '--kind', 'test', '--area', 'web-ui/test', '--agent', 'any', '--leader', 'boss', '--workflow', 'parallel', '--from', 'human'],
    },
    {
      name: 'dispatch',
      payload: { action: 'dispatch', title: 'Dispatch with leader', leader: 'copilot-web', assignee: 'copilot-integration' },
      args: ['add', 'Dispatch with leader', '--kind', 'feature', '--agent', 'copilot-integration', '--leader', 'copilot-web', '--workflow', 'parallel', '--from', 'human'],
    },
  ]

  for (const { name, payload, args } of cases) {
    await t.test(name, async () => {
      state.commands = []
      const response = await route.POST(requestWithText(JSON.stringify(payload)))
      assert.equal(response.status, 200)
      assert.deepEqual(await responseBody(response), { ok: true, action: name, output: 'mock output' })
      assert.equal(state.commands.length, 1)
      assert.equal(state.commands[0].executable, process.execPath)
      assert.deepEqual(state.commands[0].args, args)
    })
  }
})

test('POST reports malformed JSON and oversized bodies without dispatching commands', async t => {
  state.user = admin
  state.commands = []
  state.commandResult = { status: 0, stdout: 'mock output', stderr: '' }

  await t.test('malformed JSON', async () => {
    const response = await route.POST(requestWithText('{'))
    assert.equal(response.status, 400)
    assert.deepEqual(await responseBody(response), { error: 'Request body must be valid JSON' })
    assert.deepEqual(state.commands, [])
  })

  await t.test('body limit', async () => {
    const oversizedBody = ' '.repeat(1024 * 1024 + 1)
    const response = await route.POST(requestWithText(oversizedBody))
    assert.equal(response.status, 400)
    assert.match((await responseBody(response)).error, /exceeds the 1048576 byte limit/)
    assert.deepEqual(state.commands, [])
  })
})

test('POST rejects unsupported actions and missing or invalid payloads', async t => {
  state.user = admin
  state.commands = []

  const cases = [
    {
      name: 'unsupported action',
      payload: { action: 'restart' },
      status: 500,
      error: 'Unsupported agent team action: "restart"',
    },
    {
      name: 'missing action',
      payload: {},
      status: 400,
      error: 'Agent team action is required',
    },
    {
      name: 'empty body',
      body: '',
      status: 400,
      error: 'Agent team action is required',
    },
    {
      name: 'null payload',
      body: 'null',
      status: 400,
      error: 'Agent team action is required',
    },
    {
      name: 'array payload',
      body: '[]',
      status: 400,
      error: 'Agent team action is required',
    },
    {
      name: 'missing say message',
      payload: { action: 'say' },
      status: 400,
      error: 'Agent team say requires a message value',
    },
    {
      name: 'missing add title',
      payload: { action: 'add', kind: 'test' },
      status: 400,
      error: 'Agent team add requires a title',
    },
  ]

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const requestBody = Object.hasOwn(testCase, 'body')
        ? testCase.body
        : JSON.stringify(testCase.payload)
      const response = await route.POST(requestWithText(requestBody))

      assert.equal(response.status, testCase.status)
      assert.deepEqual(await responseBody(response), { error: testCase.error })
      assert.deepEqual(state.commands, [])
    })
  }
})

test('POST returns a stable 500 error shape when the team command fails', async () => {
  state.user = admin
  state.commands = []
  state.commandResult = { status: 1, stdout: '', stderr: 'team command failed' }

  const response = await route.POST(requestWithText(JSON.stringify({ action: 'start' })))

  assert.equal(response.status, 500)
  assert.deepEqual(await responseBody(response), { error: 'team command failed' })
  assert.deepEqual(state.commands, [{
    executable: process.execPath,
    args: ['start'],
  }])

  state.commandResult = { status: 0, stdout: 'mock output', stderr: '' }
})
