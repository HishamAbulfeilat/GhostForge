const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const file = path.resolve(__dirname, '../lib/dashboard-digest.ts')
const mod = new Module(file, module)
mod.filename = file
mod.paths = Module._nodeModulePaths(path.dirname(file))
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, file)
const digest = mod.exports

test('per-user seen files reject path-like usernames', () => {
  assert.equal(digest.seenFile('../../etc', '/h'), null)
  assert.equal(digest.seenFile('a/b', '/h'), null)
  assert.equal(digest.seenFile('', '/h'), null)
  assert.equal(digest.seenFile('Owner', '/h'), path.join('/h', '.ghostforge', 'users', 'owner', 'dashboard-seen.json'))
})

test('only failures, pending reviews and unseen tags count; approved PRs and passing runs do not', () => {
  const input = {
    runs: [{ id: '1', name: 'a', branch: 'm', conclusion: 'success', updated: '' }, { id: '2', name: 'b', branch: 'm', conclusion: 'failure', updated: '' }],
    prs: [{ number: '#1', title: 't', author: 'x', review: 'approved' }, { number: '#2', title: 't', author: 'x', review: 'pending' }],
    releases: [{ tag: 'v2', date: '' }, { tag: 'v1', date: '' }],
  }
  const seen = { lastVisitAt: 't', runs: [], prs: [], tags: ['v1'], notifiedRuns: [] }
  const d = digest.computeDigest(seen, input)
  assert.deepEqual(d.failingRuns.map(r => r.id), ['2'])
  assert.deepEqual(d.prsAwaitingReview.map(p => p.number), ['#2'])
  assert.deepEqual(d.newTags.map(t => t.tag), ['v2'])
  const snap = digest.snapshot(input, seen)
  assert.equal(digest.computeDigest(snap, input).total, 0)
  assert.deepEqual(digest.runsToNotify(snap, input), [])
})
