const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/agents/route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')
const agentTeamApi = require('../lib/agent-team-api.js')
const state = { user: null, commands: [] }
const snapshotFixture = {
  snapshot: {
    health: 90,
    running: false,
    agents: {
      copilot: { provider: 'copilot', state: 'idle', task: null, model: null, cooldownUntil: null },
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
          return { status: 0, stdout: 'mock output', stderr: '' }
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

test('GET and POST require an authenticated admin_tools user', async t => {
  for (const user of [null, { role: 'user', permissions: [] }]) {
    state.user = user
    for (const method of ['GET', 'POST']) {
      await t.test(`${method} rejects ${user ? 'non-admin' : 'unauthenticated'} requests`, async () => {
        const request = method === 'GET' ? {} : requestWithText('{}')
        const response = await route[method](request)
        assert.equal(response.status, 403)
        assert.deepEqual(await responseBody(response), { error: 'Admin tools permission required.' })
      })
    }
  }
  assert.deepEqual(state.commands, [])
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
    assert.deepEqual(Object.keys(agent), ['provider', 'state', 'task', 'model', 'cooldownUntil'])
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
