import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatResult, parseArgs, request, resolveBridgeConfig } from './collab.mjs'

const cliPath = fileURLToPath(new URL('./collab.mjs', import.meta.url))
const shellPath = fileURLToPath(new URL('./collab.sh', import.meta.url))
const env = { MARKL_BRIDGE_TOKEN: 'bridge-token' }

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => JSON.stringify(data),
  }
}

test('help documents collaboration commands and bridge configuration', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ghostforge collab/)
  assert.match(result.stdout, /collab post/)
  assert.match(result.stdout, /MARKL_BRIDGE_TOKEN/)
})

// On Windows `bash` may resolve to the WSL relay with no distro installed,
// which fails before running anything. Only exercise the launcher where bash works.
const bashWorks = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0

test('shell launcher exists', () => {
  assert.equal(existsSync(shellPath), true)
})

test('shell launcher forwards help to the collaboration CLI', { skip: !bashWorks && 'no working bash on PATH' }, () => {
  const result = spawnSync('bash', [shellPath, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ghostforge collab create/)
})

test('parses create, get, and bounded post commands', () => {
  assert.deepEqual(parseArgs(['create', '--json']), { command: 'create', json: true })
  assert.deepEqual(parseArgs(['get', 'session01']), { command: 'get', id: 'session01', json: false })
  assert.deepEqual(parseArgs(['post', 'session01', '--content', 'Hello']), {
    command: 'post', id: 'session01', content: 'Hello', role: 'user', json: false,
  })
  assert.deepEqual(parseArgs(['post', 'session01', '--content', 'Reply', '--role', 'assistant', '--json']), {
    command: 'post', id: 'session01', content: 'Reply', role: 'assistant', json: true,
  })
})

test('rejects invalid IDs, content, roles, duplicate options, and stray arguments', () => {
  assert.throws(() => parseArgs(['get', 'short']), /Session ID/)
  assert.throws(() => parseArgs(['get', 'session01', '--wat']), /Unknown option/)
  assert.throws(() => parseArgs(['post', 'session01']), /requires --content/)
  assert.throws(() => parseArgs(['post', 'session01', '--content', 'x', '--role', 'system']), /user or assistant/)
  assert.throws(() => parseArgs(['post', 'session01', '--content', 'x', '--content', 'y']), /once/)
  assert.throws(() => parseArgs(['create', '--json', '--json']), /once/)
  assert.throws(() => parseArgs(['post', 'session01', '--content', ' ']), /non-empty/)
  assert.throws(() => parseArgs(['post', 'session01', '--content', 'x'.repeat(10001)]), /at most/)
})

test('uses loopback bridge defaults and explicit remote opt-in', () => {
  assert.deepEqual(resolveBridgeConfig(env), { baseUrl: 'http://127.0.0.1:8765', token: 'bridge-token' })
  assert.throws(() => resolveBridgeConfig({ ...env, MARKL_BRIDGE_URL: 'https://example.test' }), /not loopback/)
  assert.equal(resolveBridgeConfig({
    ...env, MARKL_BRIDGE_URL: 'https://example.test', GF_ALLOW_REMOTE_BRIDGE: '1',
  }).baseUrl, 'https://example.test')
  assert.throws(() => resolveBridgeConfig({
    ...env, MARKL_BRIDGE_URL: 'https://example.test:8443', GF_ALLOW_REMOTE_BRIDGE: '1',
  }), /default port/)
})

test('create, get, and post use authenticated bridge contracts', async () => {
  const calls = []
  const responses = [
    { id: 'session01', shareUrl: '/jarvis?session=session01' },
    { id: 'session01', messages: [], participants: 2 },
    { id: 'session01', ok: true },
  ]
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse(responses.shift())
  }
  await request(parseArgs(['create']), env, fetchImpl)
  await request(parseArgs(['get', 'session01']), env, fetchImpl)
  await request(parseArgs(['post', 'session01', '--content', 'Hello']), env, fetchImpl)
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/api/jarvis/collab')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bridge-token')
  assert.equal(calls[1].url, 'http://127.0.0.1:8765/api/jarvis/collab?id=session01')
  assert.equal(calls[1].init.method, 'GET')
  assert.deepEqual(JSON.parse(calls[2].init.body), { id: 'session01', role: 'user', content: 'Hello' })
  assert.equal(calls[2].init.method, 'POST')
})

test('reports API, network, and malformed response failures', async () => {
  await assert.rejects(request(parseArgs(['get', 'session01']), env, async () =>
    jsonResponse({ detail: 'Session not found' }, 404)), /404: Session not found/)
  await assert.rejects(request(parseArgs(['create']), env, async () => { throw new Error('offline') }),
    /Could not reach the collaboration bridge: offline/)
  await assert.rejects(request(parseArgs(['get', 'session01']), env, async () =>
    jsonResponse({ id: 'session01' })), /messages list/)
  await assert.rejects(request(parseArgs(['post', 'session01', '--content', 'x']), env, async () =>
    jsonResponse({ id: 'session01', ok: false })), /did not confirm/)
})

test('formats human-readable collaboration results', () => {
  assert.match(
    formatResult({ command: 'create' }, { id: 'session01', shareUrl: '/jarvis?session=session01' }),
    /Created[\s\S]*Share link: \/jarvis\?session=session01/,
  )
  assert.match(
    formatResult({ command: 'get' }, { id: 'session01', participants: 1, messages: [{ role: 'user', content: 'Hi' }] }),
    /Share link: \/jarvis\?session=session01[\s\S]*user: Hi/,
  )
  assert.equal(formatResult({ command: 'post' }, { id: 'session01', ok: true }), 'Message sent to session session01.')
})

test('JSON create and get results include a share link', () => {
  assert.deepEqual(JSON.parse(formatResult(
    { command: 'create', json: true },
    { id: 'session01', shareUrl: '/jarvis?session=session01' },
  )), {
    id: 'session01',
    shareUrl: '/jarvis?session=session01',
  })
  assert.deepEqual(JSON.parse(formatResult(
    { command: 'get', json: true },
    { id: 'session01', messages: [], participants: 1 },
  )), {
    id: 'session01',
    messages: [],
    participants: 1,
    shareUrl: '/jarvis?session=session01',
  })
})
