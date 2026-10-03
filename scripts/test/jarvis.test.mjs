import assert from 'node:assert/strict'
import http from 'node:http'
import { execFile } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { JarvisError, bridgeConfig, main, parseArgs } from '../jarvis.mjs'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'index.js')
const noToken = () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) }

function run(argv, opts = {}) {
  let out = ''
  let err = ''
  const io = { out: s => { out += s }, err: s => { err += s } }
  return main(argv, { io, ...opts }).then(code => ({ code, out, err }))
}

function mockFetch(body, { status = 200 } = {}) {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  f.calls = calls
  return f
}

const env = { MARKL_BRIDGE_TOKEN: 'secret-token' }

test('parseArgs handles sub, prompt words and --json', () => {
  const o = parseArgs(['ask', 'hello', 'there', '--json'])
  assert.deepEqual([o.sub, o.prompt, o.json], ['ask', 'hello there', true])
  assert.throws(() => parseArgs(['ask', '--nope']), JarvisError)
})

test('health calls the bridge with the bearer token and prints a summary', async () => {
  const f = mockFetch({ ok: true, service: 'mark-l-bridge', version: '2.0.0', unavailable_modules: ['x'] })
  const r = await run(['health'], { env, fetchImpl: f })
  assert.equal(r.code, 0)
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8765/api/mark-l/health')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer secret-token')
  assert.match(r.out, /OK\tmark-l-bridge 2\.0\.0\tunavailable modules: 1/)
  assert.ok(!r.out.includes('secret-token') && !r.err.includes('secret-token'))
})

test('health --json prints the raw response', async () => {
  const body = { ok: true, service: 'mark-l-bridge' }
  const r = await run(['health', '--json'], { env, fetchImpl: mockFetch(body) })
  assert.deepEqual(JSON.parse(r.out), body)
})

test('ask posts the prompt and prints the reply text', async () => {
  const f = mockFetch({ ok: true, data: { ok: true, response: { reply: 'Hi \u001b[31mthere\u001b[0m' } } })
  const r = await run(['ask', 'say', 'hi'], { env, fetchImpl: f })
  assert.equal(r.code, 0)
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8765/api/mark-l/chat/unified')
  assert.equal(f.calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { message: 'say hi' })
  assert.equal(r.out, 'Hi there\n')
})

test('ask --json prints the raw response', async () => {
  const body = { ok: true, data: { response: 'x' } }
  const r = await run(['ask', 'q', '--json'], { env, fetchImpl: mockFetch(body) })
  assert.deepEqual(JSON.parse(r.out), body)
})

test('ask requires a prompt and rejects overlong ones', async () => {
  assert.equal((await run(['ask'], { env, fetchImpl: mockFetch({}) })).code, 1)
  const r = await run(['ask', 'a'.repeat(4001)], { env, fetchImpl: mockFetch({}) })
  assert.equal(r.code, 1)
  assert.match(r.err, /too long/)
})

test('missing token gives a clear error and makes no request', async () => {
  const f = mockFetch({})
  const r = await run(['health'], { env: {}, fetchImpl: f, readToken: noToken })
  assert.equal(r.code, 1)
  assert.match(r.err, /Bridge token not found/)
  assert.equal(f.calls.length, 0)
})

test('offline bridge gives a clear error', async () => {
  const f = async () => { throw new TypeError('fetch failed') }
  const r = await run(['health'], { env, fetchImpl: f })
  assert.equal(r.code, 1)
  assert.match(r.err, /Bridge offline/)
})

test('401 and 5xx map to clear errors', async () => {
  const a = await run(['health'], { env, fetchImpl: mockFetch({}, { status: 401 }) })
  assert.match(a.err, /rejected the token/)
  const b = await run(['health'], { env, fetchImpl: mockFetch({}, { status: 500 }) })
  assert.match(b.err, /HTTP 500/)
})

test('remote bridge URL needs explicit opt-in', () => {
  assert.throws(() => bridgeConfig({ ...env, MARKL_BRIDGE_URL: 'http://example.com' }, noToken), /not loopback/)
  assert.equal(bridgeConfig({ ...env, MARKL_BRIDGE_URL: 'https://example.com', GF_ALLOW_REMOTE_BRIDGE: '1' }).baseUrl, 'https://example.com')
})

test('ghostforge jarvis works end-to-end against a stub bridge server', async () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, service: 'stub', version: '1', unavailable_modules: [] }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    const r = await new Promise(resolve => {
      execFile(process.execPath, [cli, 'jarvis', 'health', '--json'], {
        env: { ...process.env, MARKL_BRIDGE_URL: url, MARKL_BRIDGE_TOKEN: 'tok' },
      }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }))
    })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).service, 'stub')
    assert.deepEqual(seen, [{ url: '/api/mark-l/health', auth: 'Bearer tok' }])
  } finally {
    server.close()
  }
})
