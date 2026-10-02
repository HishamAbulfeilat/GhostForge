const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const libraryPath = path.resolve(__dirname, '../../../../lib/agent-workflows.ts')
const libraryModule = new Module(libraryPath, module)
libraryModule.filename = libraryPath
libraryModule.paths = Module._nodeModulePaths(path.dirname(libraryPath))
libraryModule._compile(ts.transpileModule(fs.readFileSync(libraryPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, libraryPath)

const routePath = path.resolve(__dirname, 'route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-workflow-template-route-'))
const state = { user: true }

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
  '@/lib/agent-workflows': libraryModule.exports,
  '../workflow-server': {
    async requireWorkflowAdmin() {
      return state.user ? { username: 'admin' } : MockNextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
    },
    async readWorkflowJson(request) {
      return JSON.parse(request.body)
    },
    getEnabledWorkflowAgents() {
      return {
        root,
        agents: new Map([
          ['boss', { provider: 'claude', model: 'opus' }],
          ['copilot', { provider: 'copilot', model: 'auto' }],
          ['copilot-qa', { provider: 'copilot', model: 'auto' }],
        ]),
      }
    },
    workflowErrorResponse(error) {
      return MockNextResponse.json({ error: error.message }, { status: error.status ?? 500 })
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

function validWorkflow() {
  return {
    name: 'Template route',
    description: 'A reusable workflow.',
    leader: 'boss',
    workers: [{ id: 'copilot', provider: 'copilot', model: 'auto' }],
    mode: 'dependent',
    tasks: [{
      id: 'work',
      title: 'Do the work',
      kind: 'feature',
      assignee: 'copilot',
      area: [],
      dependsOn: [],
      acceptanceCriteria: ['The work is complete'],
    }],
  }
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }))

test('workflow template routes require admin and save templates under the workflow subdirectory', async () => {
  state.user = false
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await route.POST({ body: JSON.stringify({ action: 'save', workflow: validWorkflow() }) })).status, 403)

  state.user = true
  const saved = await route.POST({ body: JSON.stringify({ action: 'save', workflow: validWorkflow() }) })
  assert.equal(saved.status, 201)
  assert.equal((await saved.json()).template.id, 'template-route')

  const listing = await route.GET({})
  assert.deepEqual((await listing.json()).workflowTemplates.map(template => template.id), ['template-route'])
  assert.equal(fs.existsSync(path.join(root, '.agent-sync', 'templates', 'workflow-template-route.json')), false)
  assert.equal(fs.existsSync(path.join(root, '.agent-sync', 'templates', 'workflows', 'workflow-template-route.json')), true)
})

test('workflow template route rejects unknown properties and invalid workflows', async () => {
  state.user = true
  for (const body of [
    { action: 'save', workflow: validWorkflow(), extra: true },
    { action: 'save', workflow: { ...validWorkflow(), tasks: [] } },
  ]) {
    const response = await route.POST({ body: JSON.stringify(body) })
    assert.equal(response.status, 400)
  }
})
