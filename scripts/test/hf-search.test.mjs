import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { HfSearchError, main, parseArgs, searchModels } from '../hf-search.mjs'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'index.js')

function mockFetch(body, { status = 200 } = {}) {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  f.calls = calls
  return f
}

const sample = [
  { id: 'a/llama', downloads: 100, likes: 5, pipeline_tag: 'text-generation' },
  { id: 'b/llama-2', downloads: 50, likes: 1 },
]

test('parseArgs handles limit, json and query words', () => {
  const o = parseArgs(['search', 'llama', '3b', '--limit', '5', '--json'])
  assert.deepEqual([o.sub, o.query, o.limit, o.json], ['search', 'llama 3b', 5, true])
  assert.equal(parseArgs(['search', 'x', '--limit=7']).limit, 7)
})

test('parseArgs rejects bad limit and unknown options', () => {
  for (const bad of [['--limit', '0'], ['--limit', 'abc'], ['--limit', '101'], ['--limit'], ['--nope']]) {
    assert.throws(() => parseArgs(['search', 'x', ...bad]), HfSearchError)
  }
})

test('searchModels builds the request, sends token, maps results', async () => {
  const f = mockFetch(sample)
  const r = await searchModels('llama', { limit: 2, token: 'hf_secret', fetchImpl: f })
  const u = new URL(f.calls[0].url)
  assert.equal(u.origin + u.pathname, 'https://huggingface.co/api/models')
  assert.equal(u.searchParams.get('search'), 'llama')
  assert.equal(u.searchParams.get('limit'), '2')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer hf_secret')
  assert.equal(r[0].url, 'https://huggingface.co/a/llama')
  assert.equal(r[1].pipeline_tag, null)
})

test('no Authorization header without a token', async () => {
  const f = mockFetch([])
  await searchModels('x', { fetchImpl: f })
  assert.equal(f.calls[0].init.headers.Authorization, undefined)
})

test('validates query', async () => {
  for (const q of ['', '   ', 'a'.repeat(201), 'bad\u001bquery']) {
    await assert.rejects(searchModels(q, { fetchImpl: mockFetch([]) }), HfSearchError)
  }
})

test('maps HTTP and network errors without leaking the token', async () => {
  for (const [status, re] of [[401, /HF_TOKEN/], [429, /rate limit/], [500, /HTTP 500/]]) {
    await assert.rejects(searchModels('x', { token: 'hf_secret', fetchImpl: mockFetch({}, { status }) }), re)
  }
  await assert.rejects(searchModels('x', { fetchImpl: mockFetch({ not: 'array' }) }), /unexpected response/)
  const boom = async () => { throw new Error('connect ECONNREFUSED hf_secret') }
  await assert.rejects(
    searchModels('x', { token: 'hf_secret', fetchImpl: boom }),
    e => /network error/.test(e.message) && !e.message.includes('hf_secret'),
  )
})

test('main prints text and json, returns exit codes', async () => {
  let out = ''
  let err = ''
  const io = { out: s => { out += s }, err: s => { err += s } }
  assert.equal(await main(['search', 'llama'], { env: {}, fetchImpl: mockFetch(sample), io }), 0)
  assert.match(out, /a\/llama\ttext-generation\t↓100/)
  out = ''
  assert.equal(await main(['search', 'llama', '--json'], { env: {}, fetchImpl: mockFetch(sample), io }), 0)
  assert.equal(JSON.parse(out).length, 2)
  assert.equal(await main(['search'], { env: {}, fetchImpl: mockFetch([]), io }), 1)
  assert.match(err, /query is required/)
  assert.equal(await main(['search', 'x'], { env: {}, fetchImpl: mockFetch({}, { status: 500 }), io }), 1)
})

test('cli dispatches models to the script', () => {
  const r = spawnSync(process.execPath, [cli, 'models', 'search'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /query is required/)
})
