const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../app/agents/builder/workflow-server.ts')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const sourceModule = new Module(sourcePath, module)
sourceModule.filename = sourcePath
sourceModule.paths = Module._nodeModulePaths(path.dirname(sourcePath))
const state = {
  user: null,
  snapshot: {
    agents: {
      copilot: { enabled: true, provider: 'copilot', model: 'auto' },
      disabled: { enabled: false, provider: 'claude', model: 'opus' },
    },
    boss: { enabled: true, provider: 'claude', model: 'opus' },
    tasks: [],
  },
}

class MockNextResponse {
  constructor(body, status) {
    this.body = body
    this.status = status
  }
  async json() {
    return this.body
  }
  static json(body, init = {}) {
    return new MockNextResponse(body, init.status ?? 200)
  }
}

const dependencies = {
  'next/server': { NextResponse: MockNextResponse },
  '@/lib/auth': {
    getCurrentUser: async () => state.user,
    hasPermission: (user, permission) => Boolean(
      user && (user.role === 'admin' || user.permissions?.includes(permission)),
    ),
  },
  '@/lib/agent-team-api': {
    readAgentTeamSnapshot: () => ({ snapshot: state.snapshot }),
    repoRootFromLib: () => 'C:\\ghostforge',
  },
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(dependencies, request)) return dependencies[request]
  return originalLoad.call(this, request, parent, isMain)
}

try {
  sourceModule._compile(compiled, sourcePath)
} finally {
  Module._load = originalLoad
}

const { MAX_WORKFLOW_REQUEST_BYTES, getEnabledWorkflowAgents, readWorkflowJson, requireWorkflowAdmin } = sourceModule.exports

function requestWithBody(text) {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    }),
  }
}

test('workflow server restricts access to admin_tools users', async () => {
  state.user = null
  const anonymous = await requireWorkflowAdmin({})
  assert.equal(anonymous.status, 403)
  assert.deepEqual(await anonymous.json(), { error: 'Admin tools permission required.' })

  state.user = { username: 'member', role: 'user', permissions: [] }
  assert.equal((await requireWorkflowAdmin({})).status, 403)

  state.user = { username: 'operator', role: 'user', permissions: ['admin_tools'] }
  assert.equal(await requireWorkflowAdmin({}), state.user)
})

test('workflow request reader parses valid JSON and rejects malformed or oversized bodies', async () => {
  assert.deepEqual(await readWorkflowJson(requestWithBody('{"action":"save"}')), { action: 'save' })
  await assert.rejects(readWorkflowJson(requestWithBody('{')), /Request body must be valid JSON/)
  await assert.rejects(readWorkflowJson({ body: null }), /Request body must be valid JSON/)
  await assert.rejects(
    readWorkflowJson(requestWithBody('x'.repeat(MAX_WORKFLOW_REQUEST_BYTES + 1))),
    new RegExp(`Request body exceeds the ${MAX_WORKFLOW_REQUEST_BYTES} byte limit`),
  )
})

test('workflow server exposes only enabled agents and the configured boss', () => {
  const { root, agents } = getEnabledWorkflowAgents('C:\\ghostforge')
  assert.equal(root, 'C:\\ghostforge')
  assert.deepEqual([...agents.entries()], [
    ['copilot', { provider: 'copilot', model: 'auto' }],
    ['boss', { provider: 'claude', model: 'opus' }],
  ])
})
