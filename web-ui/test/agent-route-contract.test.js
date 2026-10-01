const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/agents/route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')
const agentTeamApi = require('../lib/agent-team-api.js')
const state = { user: null, commands: [], commandResult: { status: 0, stdout: 'mock output', stderr: '' } }
const snapshotFixture = {
  snapshot: {
    health: 90,
    running: false,
    agents: {
      copilot: {
        provider: 'copilot',
        state: 'working',
        task: 'Check C:\\Users\\operator\\repo token=private',
        model: 'gpt-private',
        since: '2026-10-01T00:00:00.000Z',
        cooldownUntil: null,
        enabled: true,
        role: 'worker',
        strengths: ['feature'],
        branch: 'agent/private',
      },
      disabled: {
        provider: 'claude',
        state: 'disabled',
        task: null,
        model: null,
        since: null,
        cooldownUntil: null,
        enabled: false,
        role: 'worker',
        strengths: ['review'],
        branch: 'agent/disabled',
      },
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
  },
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

test('private GET and every POST remain restricted to admin_tools users', async t => {
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
})

test('public GET allows signed-in users and strips private session metadata', async () => {
  state.user = { role: 'user', permissions: [] }
  const response = await route.GET({ nextUrl: { searchParams: new URLSearchParams('view=public') } })
  const body = await responseBody(response)

  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(body.snapshot.agents), ['copilot'])
  assert.equal(body.snapshot.agents.copilot.model, null)
  assert.equal(body.snapshot.agents.copilot.branch, null)
  assert.deepEqual(body.snapshot.agents.copilot.strengths, [])
  assert.match(body.snapshot.agents.copilot.task, /\[local path redacted\]/)
  assert.match(body.snapshot.agents.copilot.task, /token=\[redacted\]/)
  assert.deepEqual(body.snapshot.messages, [])
})

test('GET returns the wrapped agent-team snapshot contract', async () => {
  state.user = admin
  const response = await route.GET({})
  const body = await responseBody(response)

  assert.equal(response.status, 200)
  assert.deepEqual(body, snapshotFixture)
  const { snapshot } = body
  assert.equal(typeof snapshot.health === 'number' || snapshot.health === null, true)
  assert.equal(typeof snapshot.running, 'boolean')
  assert.equal(typeof snapshot.agents, 'object')
  assert.equal(Array.isArray(snapshot.tasks), true)
  assert.equal(Array.isArray(snapshot.messages), true)
  assert.equal(typeof snapshot.phase, 'number')
  for (const agent of Object.values(snapshot.agents)) {
    assert.deepEqual(Object.keys(agent), [
      'provider',
      'state',
      'task',
      'model',
      'since',
      'cooldownUntil',
      'enabled',
      'role',
      'strengths',
      'branch',
    ])
  }
  for (const task of snapshot.tasks) {
    assert.deepEqual(Object.keys(task), ['id', 'title', 'kind', 'status', 'owner'])
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
      args: ['add', 'Add route tests', '--kind', 'test', '--area', 'web-ui/test', '--agent', 'any', '--from', 'human'],
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
