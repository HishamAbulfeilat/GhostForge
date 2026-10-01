import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatResult, parseArgs, request, resolveBaseUrl, sessionHeaders } from './workflows.mjs'

const cliPath = fileURLToPath(new URL('./workflows.mjs', import.meta.url))

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => JSON.stringify(data),
  }
}

test('help explains workflow management without claiming step execution', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /does not execute steps/i)
  assert.match(result.stdout, /MARKL_BRIDGE_TOKEN/)
})

test('parses workflow list, create, update, step status, show, and delete commands', () => {
  assert.deepEqual(parseArgs(['list', '--json']), { command: 'list', json: true })
  assert.deepEqual(parseArgs([
    'create', '--name', ' Ship it ', '--goal', 'Release safely', '--step', 'Build', '--step', 'Verify',
  ]), {
    command: 'create',
    name: 'Ship it',
    goal: 'Release safely',
    steps: ['Build', 'Verify'],
    json: false,
  })
  assert.deepEqual(parseArgs(['update', 'wf-1', '--name', 'Updated', '--status', 'paused']), {
    command: 'update', id: 'wf-1', name: 'Updated', status: 'paused', json: false,
  })
  assert.deepEqual(parseArgs(['step', 'wf-1', 'step-1', 'done', '--notes', 'Reviewed']), {
    command: 'step', id: 'wf-1', stepId: 'step-1', status: 'done', notes: 'Reviewed', json: false,
  })
  assert.deepEqual(parseArgs(['show', 'wf-1']), { command: 'show', id: 'wf-1', json: false })
  assert.deepEqual(parseArgs(['delete', 'wf-1']), { command: 'delete', id: 'wf-1', json: false })
})

test('rejects missing values, duplicate options, invalid statuses, and extra arguments', () => {
  assert.throws(() => parseArgs(['create', '--goal', 'Release']), /non-empty --name/)
  assert.throws(() => parseArgs(['create', '--name', 'Plan', '--step', ' ']), /step title/)
  assert.throws(() => parseArgs(['update', 'wf-1']), /at least one/)
  assert.throws(() => parseArgs(['update', 'wf-1', '--status', 'complete']), /workflow status/)
  assert.throws(() => parseArgs(['step', 'wf-1', 'step-1', 'complete']), /step status/)
  assert.throws(() => parseArgs(['show', '../workflow']), /workflow ID/)
  assert.throws(() => parseArgs(['list', 'unexpected']), /Unknown option or argument/)
  assert.throws(() => parseArgs(['delete', 'wf-1', 'wf-2']), /Unknown option or argument/)
  assert.throws(() => parseArgs(['create', '--name', 'Plan', '--name', 'Again']), /only be provided once/)
})

test('bridge hosts default to loopback and tokens are sent only as bearer credentials', () => {
  assert.equal(resolveBaseUrl({}), 'http://127.0.0.1:8765')
  assert.throws(() => resolveBaseUrl({ MARKL_BRIDGE_URL: 'https://example.test' }), /not loopback/)
  assert.equal(
    resolveBaseUrl({ MARKL_BRIDGE_URL: 'https://example.test', GF_ALLOW_REMOTE_BRIDGE: '1' }),
    'https://example.test',
  )
  assert.throws(() => resolveBaseUrl({ MARKL_BRIDGE_URL: 'http://localhost:8765/api' }), /scheme, host/)
  assert.deepEqual(sessionHeaders({ MARKL_BRIDGE_TOKEN: 'bridge token' }), {
    Authorization: 'Bearer bridge token',
  })
  assert.throws(() => sessionHeaders({}), /MARKL_BRIDGE_TOKEN is required/)
  assert.throws(() => sessionHeaders({ MARKL_BRIDGE_TOKEN: 'token\r\nvalue' }), /invalid characters/)
})

test('list and show use authenticated bridge GET requests with encoded identifiers', async () => {
  const calls = []
  const responses = [
    { workflows: [{ id: 'wf-1', name: 'Release', status: 'draft', progress: { pct: 0 } }] },
    { workflow: { id: 'wf/2', name: 'Review', status: 'draft', steps: [] }, progress: { pct: 0 } },
  ]
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse(responses.shift())
  }
  const env = { MARKL_BRIDGE_TOKEN: 'bridge-token' }
  const listed = await request(parseArgs(['list']), env, fetchImpl)
  const shown = await request(parseArgs(['show', 'wf/2']), env, fetchImpl)

  assert.equal(calls[0].url, 'http://127.0.0.1:8765/api/workflows')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bridge-token')
  assert.equal(calls[1].url, 'http://127.0.0.1:8765/api/workflows?id=wf%2F2')
  assert.match(formatResult(parseArgs(['list']), listed), /Release.*draft/)
  assert.match(formatResult(parseArgs(['show', 'wf/2']), shown), /Review/)
})

test('create and update send the bridge workflow contracts', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({ workflow: { id: 'wf-1', name: 'Release', status: 'draft', steps: [] } })
  }
  const env = { MARKL_BRIDGE_TOKEN: 'bridge-token' }

  await request(parseArgs(['create', '--name', 'Release', '--goal', 'Ship', '--step', 'Build']), env, fetchImpl)
  await request(parseArgs(['update', 'wf-1', '--name', 'Release v2', '--goal', 'Ship safely']), env, fetchImpl)

  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: 'Release', goal: 'Ship', steps: [{ title: 'Build', kind: 'manual' }],
  })
  assert.equal(calls[1].init.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    id: 'wf-1', name: 'Release v2', goal: 'Ship safely',
  })
})

test('step status updates and deletes use the bridge endpoints without executing steps', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return init.method === 'DELETE'
      ? jsonResponse({ ok: true })
      : jsonResponse({ workflow: { id: 'wf-1', name: 'Release', status: 'draft', steps: [] } })
  }
  const env = { MARKL_BRIDGE_TOKEN: 'bridge-token' }

  await request(parseArgs(['step', 'wf-1', 'step-1', 'done', '--notes', 'Reviewed']), env, fetchImpl)
  await request(parseArgs(['delete', 'wf/1']), env, fetchImpl)

  assert.equal(calls[0].init.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    id: 'wf-1', step_id: 'step-1', step: { status: 'done', notes: 'Reviewed' }, log: 'CLI status update: done',
  })
  assert.equal(calls[1].url, 'http://127.0.0.1:8765/api/workflows?id=wf%2F1')
  assert.equal(calls[1].init.method, 'DELETE')
})

test('API errors and malformed success responses fail clearly', async () => {
  await assert.rejects(
    request(parseArgs(['list']), { MARKL_BRIDGE_TOKEN: 'token' }, async () =>
      jsonResponse({ detail: 'Unauthorized' }, 401)),
    /401: Unauthorized/,
  )
  await assert.rejects(
    request(parseArgs(['list']), { MARKL_BRIDGE_TOKEN: 'token' }, async () => jsonResponse({})),
    /did not include a workflows list/,
  )
  await assert.rejects(
    request(parseArgs(['create', '--name', 'Plan']), { MARKL_BRIDGE_TOKEN: 'token' }, async () =>
      jsonResponse({ workflow: {} })),
    /did not include the requested workflow/,
  )
  await assert.rejects(
    request(parseArgs(['list']), { MARKL_BRIDGE_TOKEN: 'token' }, async () =>
      jsonResponse({ detail: [{ msg: 'Invalid field' }] }, 422)),
    /422: \[\{"msg":"Invalid field"\}\]/,
  )
  await assert.rejects(
    request(parseArgs(['delete', 'wf-1']), { MARKL_BRIDGE_TOKEN: 'token' }, async () =>
      jsonResponse({ ok: false })),
    /Workflow not found/,
  )
})
