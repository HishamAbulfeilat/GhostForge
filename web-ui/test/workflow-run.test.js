const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw error
    }
  },
})

const { runWorkflowOnBridge, RunError, MAX_RUN_STEPS } = require('../app/api/workflows/run.ts')
const route = readFileSync(resolve(__dirname, '../app/api/workflows/route.ts'), 'utf8')
const page = readFileSync(resolve(__dirname, '../app/workflows/page.tsx'), 'utf8')

test.after(() => hooks.deregister())

const step = (id, extra = {}) => ({ id, title: id, kind: 'command', ref: 'bridge:health', deps: [], status: 'pending', notes: '', log: [], ...extra })
const workflow = (steps) => ({ id: 'wf-1', name: 'Ship', goal: 'g', status: 'draft', steps, createdAt: '', updatedAt: '' })
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

function fakeBridge(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    return handler(call)
  }
  return { calls, config: { url: 'http://bridge', token: 'tok', fetchImpl } }
}

test('run mirrors the workflow, runs it with bounded max_steps, then removes the mirror', async () => {
  const bridge = fakeBridge(call => {
    if (call.method === 'POST' && !call.body.action) return reply(200, { workflow: { id: 'b-1' } })
    if (call.method === 'POST') return reply(200, { workflow: { id: 'b-1', status: 'done', steps: [step('s1', { status: 'done' })] } })
    return reply(200, { ok: true })
  })
  const result = await runWorkflowOnBridge('alice', workflow([step('s1')]), bridge.config)
  assert.equal(result.status, 'done')
  assert.deepEqual(bridge.calls.map(c => c.method), ['POST', 'POST', 'DELETE'])
  assert.deepEqual(bridge.calls[1].body, { user_id: 'alice', id: 'b-1', action: 'run', max_steps: MAX_RUN_STEPS })
  assert.equal(bridge.calls[0].headers.Authorization, 'Bearer tok')
  assert.match(bridge.calls[2].url, /user_id=alice&id=b-1$/)
})

test('bridge rejection of unsupported steps surfaces as 422 and the mirror is still removed', async () => {
  const bridge = fakeBridge(call => {
    if (call.method === 'POST' && !call.body.action) return reply(200, { workflow: { id: 'b-1' } })
    if (call.method === 'POST') return reply(422, { detail: "Unsupported workflow step: kind='agent', ref='x'" })
    return reply(200, { ok: true })
  })
  await assert.rejects(
    runWorkflowOnBridge('alice', workflow([step('s1', { kind: 'agent', ref: 'x' })]), bridge.config),
    err => err instanceof RunError && err.status === 422 && /Unsupported workflow step/.test(err.message),
  )
  assert.equal(bridge.calls.at(-1).method, 'DELETE')
})

test('unreachable bridge and bridge failures map to 502', async () => {
  const down = { url: 'http://bridge', token: 't', fetchImpl: async () => { throw new Error('ECONNREFUSED') } }
  await assert.rejects(runWorkflowOnBridge('a', workflow([step('s1')]), down), err => err.status === 502 && /port 8765/.test(err.message))
  const broken = fakeBridge(() => reply(500, {}))
  await assert.rejects(runWorkflowOnBridge('a', workflow([step('s1')]), broken.config), err => err.status === 502)
})

test('empty and oversized workflows are rejected without calling the bridge', async () => {
  const bridge = fakeBridge(() => reply(200, {}))
  await assert.rejects(runWorkflowOnBridge('a', workflow([]), bridge.config), err => err.status === 400)
  const big = Array.from({ length: MAX_RUN_STEPS + 1 }, (_, i) => step(`s${i}`))
  await assert.rejects(runWorkflowOnBridge('a', workflow(big), bridge.config), err => err.status === 400)
  assert.equal(bridge.calls.length, 0)
})

test('route authorizes before running and only accepts the run action on the caller\'s own workflow', () => {
  const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function PUT'))
  assert.ok(post.indexOf("requirePermission(req, 'workflows')") < post.indexOf('runWorkflow('))
  assert.match(route, /body\.action !== 'run'\) return NextResponse\.json\(\{ error: 'Unknown workflow action' \}, \{ status: 400 \}\)/)
  assert.match(route, /getWorkflow\(username, body\.id\)/)
  assert.match(route, /status: 404/)
  assert.match(route, /already running'.*status: 409/)
  assert.doesNotMatch(route, /exec|spawn|child_process/)
})

test('workflows page exposes a disabled-while-running Run control', () => {
  assert.match(page, /action: 'run', id: selected\.id/)
  assert.match(page, /disabled=\{running \|\| selected\.status === 'running' \|\| selected\.steps\.length === 0\}/)
  assert.match(page, /'Running…' : '▶ Run'/)
  assert.match(page, /Run failed:/)
})
