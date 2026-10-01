import assert from 'node:assert/strict'
import test from 'node:test'
import { formatResult, parseArgs, parsePayload, request, resolveBaseUrl, usage } from './n8n.mjs'

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => typeof data === 'string' ? data : JSON.stringify(data),
})

test('documents bounded commands and credential separation', () => {
  assert.match(usage(), /n8n trigger <workflow-id>/)
  assert.match(usage(), /never sent to workflow webhook/)
  assert.deepEqual(parseArgs(['list', '--json']), { command: 'list', json: true })
  assert.deepEqual(parseArgs(['trigger', 'wf-1', '--data', '{"ok":true}']), {
    command: 'trigger', id: 'wf-1', data: { ok: true }, json: false,
  })
})

test('rejects invalid arguments and unsafe URLs', () => {
  assert.throws(() => parseArgs(['show', '../wf']), /Invalid workflow ID/)
  assert.throws(() => parseArgs(['list', 'extra']), /Unknown option/)
  assert.throws(() => parseArgs(['trigger', 'wf', '--data', '[]']), /JSON object/)
  assert.throws(() => parseArgs(['trigger', 'wf', '--data', '{bad']), /valid JSON/)
  assert.throws(() => resolveBaseUrl({ N8N_URL: 'http://example.test' }), /plain HTTP/)
  assert.equal(resolveBaseUrl({ N8N_URL: 'https://example.test/n8n/' }), 'https://example.test/n8n')
  assert.throws(() => resolveBaseUrl({ N8N_URL: 'http://user:pass@localhost:5678' }), /without credentials/)
  assert.deepEqual(parsePayload(undefined), { triggeredFrom: 'ghostforge-cli' })
})

test('list and show authenticate API requests', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return url.includes('/workflows?')
      ? response({ data: [{ id: 'wf-1', name: 'Deploy', active: true }] })
      : response({ id: 'wf/1', name: 'Review', active: false, nodes: [] })
  }
  const env = { N8N_API_KEY: 'secret' }
  const listed = await request(parseArgs(['list']), env, fetchImpl)
  const shown = await request(parseArgs(['show', 'wf/1']), env, fetchImpl)
  assert.deepEqual(listed.workflows, [{ id: 'wf-1', name: 'Deploy', active: true }])
  assert.equal(shown.workflow.name, 'Review')
  assert.equal(calls[0].init.headers['X-N8N-API-KEY'], 'secret')
  assert.match(formatResult(parseArgs(['list']), listed), /active\twf-1\tDeploy/)
})

test('trigger fetches workflow metadata with the key, then omits it from webhook', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url.includes('/api/v1/')) {
      return response({
        id: 'wf-1', name: 'Deploy', active: true,
        nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { path: 'ghostforge/deploy', httpMethod: 'POST' } }],
      })
    }
    return response({ accepted: true })
  }
  const result = await request(parseArgs(['trigger', 'wf-1', '--data', '{"branch":"main"}']), {
    N8N_API_KEY: 'secret',
  }, fetchImpl)
  assert.equal(result.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.headers['X-N8N-API-KEY'], 'secret')
  assert.equal(calls[1].url, 'http://127.0.0.1:5678/webhook/ghostforge/deploy')
  assert.equal(calls[1].init.headers['X-N8N-API-KEY'], undefined)
  assert.deepEqual(JSON.parse(calls[1].init.body), { branch: 'main' })
})

test('trigger refuses inactive, unsupported, and ambiguous workflows', async () => {
  const env = { N8N_API_KEY: 'secret' }
  const run = workflow => request(parseArgs(['trigger', 'wf-1']), env, async () => response(workflow))
  await assert.rejects(run({ id: 'wf-1', name: 'Off', active: false, nodes: [] }), /Only active/)
  await assert.rejects(run({ id: 'wf-1', name: 'Manual', active: true, nodes: [] }), /no supported/)
  await assert.rejects(run({
    id: 'wf-1', name: 'Many', active: true,
    nodes: [
      { type: 'n8n-nodes-base.webhook', parameters: { path: 'one', httpMethod: 'POST' } },
      { type: 'n8n-nodes-base.webhook', parameters: { path: 'two', httpMethod: 'ALL' } },
    ],
  }), /multiple supported/)
})

test('requires an API key and reports API errors', async () => {
  await assert.rejects(request(parseArgs(['list']), {}, async () => response({})), /N8N_API_KEY is required/)
  await assert.rejects(request(parseArgs(['list']), { N8N_API_KEY: 'secret' }, async () => response({ message: 'Nope' }, 401)), /401: Nope/)
})
