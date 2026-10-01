const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { AgentWorkflowTemplateError } = require('../lib/agent-workflow-templates.js')

const routePath = path.resolve(__dirname, '../app/api/agents/templates/route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')
const page = fs.readFileSync(path.resolve(__dirname, '../app/agents/page.tsx'), 'utf8')
const state = { user: null, templates: [], commands: [], result: { ok: true, output: 'dispatched' } }
const template = {
  id: 'a6a721b4-2ec6-4f12-8e42-6c4bd78d4f00',
  name: 'Release prep',
  title: 'Prepare release checklist',
  kind: 'test',
  leader: 'boss',
  assignee: 'any',
  workflow: 'ordered',
  dependencies: ['T-114'],
  acceptanceCriteria: ['Run tests'],
  createdAt: '2026-10-01T00:00:00.000Z',
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
    hasPermission: (user, permission) => Boolean(user && (user.role === 'admin' || user.permissions?.includes(permission))),
  },
  '@/lib/agent-workflow-templates': {
    AgentWorkflowTemplateError,
    async listAgentWorkflowTemplates() {
      return state.templates
    },
    async saveAgentWorkflowTemplate(username, input) {
      if (username !== 'admin') throw new Error('Unexpected account')
      if (!input || input.name !== 'Release prep') throw new AgentWorkflowTemplateError('Template name is invalid.')
      const saved = { ...template, ...input }
      state.templates = [saved]
      return saved
    },
    getAgentWorkflowTemplate(username, id) {
      return state.templates.find(item => item.id === id) || null
    },
  },
  '@/lib/agent-team-api': {
    repoRootFromLib: () => 'C:\\ghostforge',
    runAgentTeamCommand(action, payload, options) {
      state.commands.push({ action, payload, options })
      return state.result
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const routeModule = new Module(routePath, module)
  routeModule.filename = routePath
  routeModule.paths = Module._nodeModulePaths(path.dirname(routePath))
  routeModule._compile(compiled, routePath)
  route = routeModule.exports
} finally {
  Module._load = originalLoad
}

function requestWithText(text, contentLength) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return {
    body,
    headers: { get: name => name === 'content-length' ? contentLength ?? null : null },
  }
}

const admin = { username: 'admin', role: 'admin', permissions: [] }

test('workflow template APIs require admin_tools access', async () => {
  state.user = null
  state.commands = []
  assert.equal((await route.GET({})).status, 403)
  assert.equal((await route.POST(requestWithText('{"action":"apply","id":"a6a721b4-2ec6-4f12-8e42-6c4bd78d4f00"}'))).status, 403)
  state.user = { username: 'member', role: 'user', permissions: [] }
  assert.equal((await route.GET({})).status, 403)
  assert.deepEqual(state.commands, [])
})

test('admin can list and save validated workflow templates', async () => {
  state.user = admin
  state.templates = []
  const list = await route.GET({})
  assert.equal(list.status, 200)
  assert.deepEqual(await list.json(), { templates: [] })

  const save = await route.POST(requestWithText(JSON.stringify({
    action: 'save',
    template: {
      name: 'Release prep',
      title: 'Prepare release checklist',
      kind: 'test',
      leader: 'boss',
      assignee: 'any',
      workflow: 'ordered',
      dependencies: ['T-114'],
      acceptanceCriteria: ['Run tests'],
    },
  })))
  assert.equal(save.status, 201)
  assert.equal((await save.json()).template.id, template.id)
  assert.equal((await route.GET({})).status, 200)
})

test('applying a saved template requires an existing template and dispatches normalized task data', async () => {
  state.user = admin
  state.templates = [template]
  state.commands = []
  const notFound = await route.POST(requestWithText(JSON.stringify({ action: 'apply', id: '00000000-0000-0000-0000-000000000000' })))
  assert.equal(notFound.status, 404)
  assert.deepEqual(state.commands, [])

  const applied = await route.POST(requestWithText(JSON.stringify({ action: 'apply', id: template.id })))
  assert.equal(applied.status, 200)
  assert.deepEqual(await applied.json(), { ok: true, templateId: template.id, output: 'dispatched' })
  assert.deepEqual(state.commands, [{
    action: 'add',
    payload: {
      title: template.title,
      kind: template.kind,
      agent: template.assignee,
      leader: template.leader,
      workflow: template.workflow,
      dependencies: template.dependencies,
      acceptanceCriteria: template.acceptanceCriteria,
    },
    options: { workspaceRoot: 'C:\\ghostforge' },
  }])
})

test('template API rejects malformed, oversized, and unsupported requests without dispatch', async () => {
  state.user = admin
  state.commands = []
  for (const [body, expectedStatus] of [
    ['{', 400],
    [' '.repeat(16 * 1024 + 1), 400],
    [JSON.stringify({ action: 'apply', id: template.id, extra: true }), 400],
    [JSON.stringify({ action: 'unknown' }), 400],
  ]) {
    const response = await route.POST(requestWithText(body))
    assert.equal(response.status, expectedStatus)
  }
  assert.equal((await route.POST(requestWithText('{}', String(16 * 1024 + 1)))).status, 400)
  assert.deepEqual(state.commands, [])
})

test('agent team dispatch failures are visible to the caller', async () => {
  state.user = admin
  state.templates = [template]
  state.result = { ok: false, output: 'team command failed' }
  const response = await route.POST(requestWithText(JSON.stringify({ action: 'apply', id: template.id })))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'team command failed' })
  state.result = { ok: true, output: 'dispatched' }
})

test('agents page wires template loading, saving, applying, and dispatch confirmation', () => {
  assert.match(page, /fetch\('\/api\/agents\/templates'/)
  assert.match(page, /Workflow templates/)
  assert.match(page, /Save current/)
  assert.match(page, /Apply &amp; dispatch|Apply & dispatch/)
  assert.match(page, /window\.confirm\(/)
  assert.match(page, /Loading workflow templates/)
  assert.match(page, /setNotice\(\{ error: true, text: error instanceof Error \? error\.message/)
})
