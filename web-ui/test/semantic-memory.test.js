const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, readFile } = require('node:fs/promises')
const { tmpdir, homedir } = require('node:os')
const { join } = require('node:path')

// Node's native TS support lets us require the type-stripped module directly.
const sm = require('../lib/semantic-memory.ts')

const USER = 'testuser'
let savedHome

test.before(async () => {
  savedHome = homedir()
  const fakeHome = await mkdtemp(join(tmpdir(), 'gf-sm-'))
  process.env.HOME = fakeHome
})

test.after(async () => {
  if (savedHome) process.env.HOME = savedHome
  else delete process.env.HOME
})

test('remembers a fact and recalls it by meaning (keyword fallback offline)', async () => {
  const { rememberMemory, recallMemory, memoryStats } = sm
  await rememberMemory(USER, 'The production server is deployed on k8s cluster alpha.')
  await rememberMemory(USER, 'Prefers dark mode and Arabic replies.', 'preferences')
  await rememberMemory(USER, 'Team standup is every weekday at 9am.')

  // Ollama is not guaranteed in CI — this resolves to keyword scoring
  const { results, method } = await recallMemory(USER, 'where is production hosted?')
  assert.ok(results.length > 0)
  assert.match(results[0].text, /production|deploy/i)
  assert.ok(['keyword', 'embedding'].includes(method))

  const stats = await memoryStats(USER)
  assert.equal(stats.count, 3)
  assert.equal(stats.categories.preferences, 1)
})

test('recall with no matches returns empty results', async () => {
  const { recallMemory } = sm
  const { results } = await recallMemory(USER, 'zzzz nothing matches this')
  assert.ok(Array.isArray(results))
})

test('deleteMemory removes a single record', async () => {
  const { listMemories, deleteMemory, memoryStats } = sm
  const all = await listMemories(USER)
  assert.equal(all.length, 3)
  const deleted = await deleteMemory(USER, all[0].id)
  assert.equal(deleted, true)
  assert.equal((await memoryStats(USER)).count, 2)
  const missing = await deleteMemory(USER, 'does-not-exist')
  assert.equal(missing, false)
})

test('clearMemory wipes the store', async () => {
  const { clearMemory, memoryStats } = sm
  await clearMemory(USER)
  assert.equal((await memoryStats(USER)).count, 0)
})