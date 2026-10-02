const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const workflowLibraryPath = path.resolve(__dirname, '../../../../lib/agent-workflows.ts')
const workflowLibrarySource = fs.readFileSync(workflowLibraryPath, 'utf8')
const workflowLibraryModule = new Module(workflowLibraryPath, module)
workflowLibraryModule.filename = workflowLibraryPath
workflowLibraryModule.paths = Module._nodeModulePaths(path.dirname(workflowLibraryPath))
workflowLibraryModule._compile(ts.transpileModule(workflowLibrarySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, workflowLibraryPath)
const workflowLibrary = workflowLibraryModule.exports

const routePath = path.resolve(__dirname, 'route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')
const state = {
  user: { username: 'admin', role: 'admin', permissions: [] },
  snapshot: { running: true, tasks: [] },
  commands: [],
}
class MockNextResponse {
  constructor(body, status) {
    this.status = status
    this.body = body
  }
  async json() {
    return this.body
  }
  static json(body, init = {}) {
    return new MockNextResponse(body, init.status ?? 200)
  }
}
const dependencies = {
  'next/server': {
    NextResponse: MockNextResponse,
  },
  '@/lib/agent-workflows': workflowLibrary,
  '@/lib/agent-team-api': {
    runAgentTeamCommand(action, payload) {
      state.commands.push({ action, payload })
      const id = `T-${100 + state.snapshot.tasks.length}`
      state.snapshot.tasks.push({ id, title: payload.title, status: 'todo' })
      return { ok: true, output: 'queued' }
    },
  },
  '../workflow-server': {
    async requireWorkflowAdmin() {
      return state.user
        ? { username: 'admin' }
        : new MockNextResponse({ error: 'Admin tools permission required.' }, 403)
    },
    async readWorkflowJson(request) {
      return JSON.parse(request.body)
    },
    getEnabledWorkflowAgents() {
      return {
        root: 'C:\\ghostforge',
        snapshot: state.snapshot,
        agents: new Map([
          ['boss', { provider: 'claude', model: 'opus' }],
          ['copilot', { provider: 'copilot', model: 'auto' }],
          ['copilot-qa', { provider: 'copilot', model: 'auto' }],
        ]),
      }
    },
    workflowErrorResponse(error) {
      return { status: error.status ?? 500, json: async () => ({ error: error.message }) }
    },
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const routeModule = new Module(routePath, module)
  routeModule.filename = routePath
  routeModule.paths = Module._nodeModulePaths(path.dirname(routePath))
  routeModule._compile(compiled, routePath)
  route = routeModule.exports
} finally {
  Module._load = originalLoad
}

function request(body) {
  return { body: JSON.stringify(body) }
}

function workflow(overrides = {}) {
  return {
    name: 'Dependency regression',
    description: 'Ensure dependency edges reach the task board.',
    leader: 'boss',
    workers: [
      { id: 'copilot', provider: 'copilot', model: 'auto' },
      { id: 'copilot-qa', provider: 'copilot', model: 'auto' },
    ],
    mode: 'dependent',
    tasks: [
      { id: 'implement', title: 'Implement change', kind: 'feature', assignee: 'copilot', area: [], dependsOn: [], acceptanceCriteria: ['Change works'] },
      { id: 'verify', title: 'Verify change', kind: 'test', assignee: 'copilot-qa', area: [], dependsOn: ['implement'], acceptanceCriteria: ['Tests pass'] },
    ],
    ...overrides,
  }
}

test('workflow launch dispatches internal and existing dependencies using actual board task IDs', async () => {
  state.user = { username: 'admin', role: 'admin', permissions: [] }
  state.snapshot = {
    running: true,
    tasks: [{ id: 'T-050', title: 'Existing prerequisite', status: 'done' }],
  }
  state.commands = []
  const input = workflow({
    tasks: [
      { id: 'implement', title: 'Implement change', kind: 'feature', assignee: 'copilot', area: [], dependsOn: ['T-050'], acceptanceCriteria: ['Change works'] },
      { id: 'verify', title: 'Verify change', kind: 'test', assignee: 'copilot-qa', area: [], dependsOn: ['implement'], acceptanceCriteria: ['Tests pass'] },
    ],
  })

  const response = await route.POST(request({ workflow: input }))

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    queued: [
      { workflowTaskId: 'implement', taskId: 'T-101', dependencies: ['T-050'] },
      { workflowTaskId: 'verify', taskId: 'T-102', dependencies: ['T-101'] },
    ],
  })
  assert.deepEqual(state.commands.map(({ payload }) => payload.dependencies), [['T-050'], ['T-101']])
})

test('workflow launch refuses non-admin users and stopped teams without dispatch', async () => {
  state.snapshot = { running: true, tasks: [] }
  state.commands = []
  state.user = null
  const denied = await route.POST(request({ workflow: workflow() }))
  assert.equal(denied.status, 403)

  state.user = { username: 'admin', role: 'admin', permissions: [] }
  state.snapshot = { running: false, tasks: [] }
  const stopped = await route.POST(request({ workflow: workflow() }))
  assert.equal(stopped.status, 409)
  assert.deepEqual(state.commands, [])
})
