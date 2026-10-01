import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatResult, parseArgs, request, resolveBridgeConfig, validateTriggers } from './webhooks.mjs'

const cliPath = fileURLToPath(new URL('./webhooks.mjs', import.meta.url))
const env = { MARKL_BRIDGE_TOKEN: 'bridge-token' }
const triggers = [{ id: 'build', source: 'GitHub', eventType: 'push', action: 'Review changes' }]

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => JSON.stringify(data),
  }
}

test('CLI help is available without bridge credentials or network access', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ghostforge webhooks/)
  assert.match(result.stdout, /MARKL_BRIDGE_TOKEN/)
})

test('parses trigger inspection, replacement, event log, and clear commands', () => {
  assert.deepEqual(parseArgs(['config', '--json']), { command: 'config', config: undefined, json: true })
  assert.deepEqual(parseArgs(['set', JSON.stringify(triggers)]), {
    command: 'set', config: triggers, json: false,
  })
  assert.deepEqual(parseArgs(['logs']), { command: 'logs', config: undefined, json: false })
  assert.deepEqual(parseArgs(['clear']), { command: 'clear', config: undefined, json: false })
})

test('rejects invalid trigger JSON, incomplete triggers, duplicate IDs, and stray arguments', () => {
  assert.throws(() => parseArgs(['set', 'not-json']), /valid JSON/)
  assert.throws(() => parseArgs(['set', JSON.stringify({})]), /JSON array/)
  assert.throws(() => validateTriggers([{ ...triggers[0], action: ' ' }]), /non-empty action/)
  assert.throws(() => validateTriggers([triggers[0], triggers[0]]), /IDs must be unique/)
  assert.throws(() => parseArgs(['logs', 'unexpected']), /only accepts --json/)
  assert.throws(() => parseArgs(['clear', '--json', '--json']), /only be provided once/)
})

test('bridge URL is loopback-only by default and bridge authentication is explicit', () => {
  assert.deepEqual(resolveBridgeConfig(env), {
    baseUrl: 'http://127.0.0.1:8765',
    token: 'bridge-token',
  })
  assert.throws(
    () => resolveBridgeConfig({ ...env, MARKL_BRIDGE_URL: 'https://example.test' }),
    /not loopback/,
  )
  assert.equal(
    resolveBridgeConfig({
      ...env,
      MARKL_BRIDGE_URL: 'https://example.test',
      GF_ALLOW_REMOTE_BRIDGE: '1',
    }).baseUrl,
    'https://example.test',
  )
  assert.throws(() => resolveBridgeConfig({ MARKL_BRIDGE_TOKEN: 'token\r\nvalue' }), /invalid characters/)
})

test('config and logs use authenticated bridge GET contracts', async () => {
  const calls = []
  const result = await request(
    { command: 'config', json: false },
    env,
    async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(triggers)
    },
  )
  const logs = [{ source: 'ci', event: 'build.complete', body: { id: 1 }, receivedAt: 'now' }]
  await request({ command: 'logs', json: true }, env, async (url, init) => {
    calls.push({ url, init })
    return jsonResponse(logs)
  })

  assert.deepEqual(result, triggers)
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/api/webhook')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bridge-token')
  assert.equal(calls[1].url, 'http://127.0.0.1:8765/api/webhook?log=1')
  assert.match(formatResult({ command: 'logs' }, logs), /ci · build\.complete · now/)
})

test('set and clear use the bridge mutation contracts', async () => {
  const calls = []
  const saved = await request(
    { command: 'set', config: triggers },
    env,
    async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({ ok: true })
    },
  )
  const cleared = await request(
    { command: 'clear' },
    env,
    async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({ ok: true })
    },
  )

  assert.deepEqual(saved, { ok: true })
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].init.body), { config: triggers })
  assert.equal(calls[1].init.method, 'DELETE')
  assert.equal(formatResult({ command: 'clear' }, cleared), 'Webhook event log cleared.')
})

test('authentication, network, malformed response, and API errors are reported explicitly', async () => {
  await assert.rejects(
    request({ command: 'config' }, env, async () => jsonResponse({ detail: 'Unauthorized' }, 401)),
    /401: Unauthorized/,
  )
  await assert.rejects(
    request({ command: 'clear' }, env, async () => { throw new Error('offline') }),
    /Could not reach the webhook bridge: offline/,
  )
  await assert.rejects(
    request({ command: 'config' }, env, async () => jsonResponse({ unexpected: true })),
    /config response must be a JSON array/,
  )
  await assert.rejects(
    request({ command: 'set', config: [] }, env, async () => jsonResponse({ ok: false })),
    /did not confirm the requested change/,
  )
})
