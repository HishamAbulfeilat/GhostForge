const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const file = path.resolve(__dirname, '../lib/swr-cache.ts')
const mod = new Module(file, module)
mod.filename = file
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const { createSwrCache } = mod.exports

test('serves cached values, revalidates stale ones in the background, force waits', async () => {
  let clock = 0
  let loads = 0
  const cache = createSwrCache(100, () => clock)
  const load = async () => { loads++; return `v${loads}` }

  assert.deepEqual(await cache.get('k', load), { value: 'v1', fetchedAt: 0, cached: false })
  clock = 50
  assert.equal((await cache.get('k', load)).value, 'v1')
  assert.equal(loads, 1, 'fresh hit does not reload')

  clock = 500
  const stale = await cache.get('k', load)
  assert.equal(stale.value, 'v1', 'stale copy is served at once')
  assert.equal(stale.cached, true)
  await new Promise(r => setImmediate(r))
  assert.equal(loads, 2, 'background refresh ran')
  assert.equal((await cache.get('k', load)).value, 'v2')

  const forced = await cache.get('k', load, true)
  assert.deepEqual([forced.value, forced.cached], ['v3', false])
})

test('concurrent misses share one load; a failed load is not cached', async () => {
  let loads = 0
  const cache = createSwrCache(1000)
  const slow = () => new Promise(r => setTimeout(() => r(++loads), 10))
  const [a, b] = await Promise.all([cache.get('k', slow), cache.get('k', slow)])
  assert.equal(loads, 1)
  assert.equal(a.value, b.value)
  await assert.rejects(cache.get('x', async () => { throw new Error('boom') }))
  assert.equal((await cache.get('x', async () => 'ok')).value, 'ok')
})
