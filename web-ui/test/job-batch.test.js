// Durable server-side batch "Confirm & apply" (lib/job-hunter/batch.ts and its API actions)
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir, hostname } = require('node:os')
const { join, dirname } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-jobbatch-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) { try { return nextResolve(specifier + ext, context) } catch { /* next */ } }
      }
      throw err
    }
  },
})
const store = require('../lib/job-hunter/store.ts')
const batch = require('../lib/job-hunter/batch.ts')

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 200)) // fire-and-forget audit/notification writes
  store.closeJobStores()
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const listing = n => ({
  key: `k${n}`, source: 'test', title: `Engineer ${n}`, company: `Co ${n}`, location: 'Remote', remote: true, salary: '',
  url: 'https://example.com/j', applyUrl: 'https://example.com/j', ats: 'lever', description: '', postedAt: '', fit: 'High', score: 90, reasons: '',
})

/** n prepared jobs for `user`, returned in creation order */
async function prepared(user, n, extra = () => ({})) {
  await store.upsertJobs(user, Array.from({ length: n }, (_, i) => listing(i + 1)))
  const jobs = await store.listJobs(user)
  for (const [i, j] of jobs.entries()) {
    await store.updateJob(user, j.id, { status: 'ready', tailoredResume: `CV ${i + 1}`, coverLetter: `Letter ${i + 1}`, answers: [{ label: 'Email', value: 'a@example.com' }], ...extra(i) })
  }
  return store.listJobs(user)
}

/** A fake approveJob that records calls and settles each job */
function fakeApprove(user, outcome = () => 'submitted') {
  const calls = []
  let active = 0
  const approve = async (username, id, opts) => {
    assert.equal(username, user)
    calls.push({ id, ...opts })
    active++
    assert.equal(active, 1, 'one application at a time')
    await new Promise(r => setTimeout(r, 5))
    const result = outcome(id)
    active--
    if (result instanceof Error) throw result
    const job = await store.updateJob(username, id, { status: result }, `fake ${result}`)
    return { job, message: `Result: ${result}`, missing: [] }
  }
  return { approve, calls }
}

test('a confirmed batch is persisted and applied one at a time on the server, with each result', async () => {
  const user = 'batch1'
  const jobs = await prepared(user, 3)
  const { approve, calls } = fakeApprove(user, id => id === jobs[1].id ? 'failed' : id === jobs[2].id ? 'needs_user' : 'submitted')
  const started = await batch.startApplyBatch(user, jobs.map(j => ({ id: j.id })), { autoStart: false })
  assert.equal(started.state, 'running')
  assert.deepEqual(started.items.map(i => i.state), ['queued', 'queued', 'queued'])
  // Persisted: a fresh read (another request, another tab, after a restart) sees it
  assert.deepEqual((await batch.getApplyBatch(user)).items.map(i => i.id), jobs.map(j => j.id))
  assert.equal(calls.length, 0, 'confirming queues; the worker applies')

  await batch.runApplyBatch(user, { approve })
  assert.deepEqual(calls.map(c => c.id), jobs.map(j => j.id))
  assert.ok(calls.every(c => c.by === 'user' && c.confirmResubmit === false))
  const done = await batch.getApplyBatch(user)
  assert.equal(done.state, 'done')
  assert.deepEqual(done.items.map(i => i.state), ['submitted', 'failed', 'needs_user'])
  assert.equal(done.items[1].message, 'Result: failed')
  assert.equal(done.worker, null)
})

test('confirming checks ownership, preparation and duplicates, and allows one running batch', async () => {
  const user = 'batch2'
  const jobs = await prepared(user, 2)
  await store.upsertJobs(user, [listing(9)])
  const unprepared = (await store.listJobs(user)).find(j => j.key === 'k9')
  await assert.rejects(batch.startApplyBatch(user, [{ id: unprepared.id }], { autoStart: false }), /can't be applied to now|Prepare/)
  await assert.rejects(batch.startApplyBatch('someone-else', [{ id: jobs[0].id }], { autoStart: false }), /Job not found/)
  await assert.rejects(batch.startApplyBatch(user, [{ id: jobs[0].id }, { id: jobs[0].id }], { autoStart: false }), /once per batch/)
  await assert.rejects(batch.startApplyBatch(user, [], { autoStart: false }), /at least one/)
  await assert.rejects(batch.startApplyBatch(user, Array.from({ length: 26 }, (_, i) => ({ id: `x${i}` })), { autoStart: false }), /at most 25/)
  assert.equal(await batch.getApplyBatch(user), null, 'refused requests queue nothing')

  await batch.startApplyBatch(user, [{ id: jobs[0].id }], { autoStart: false })
  await assert.rejects(batch.startApplyBatch(user, [{ id: jobs[1].id }], { autoStart: false }), /already running/)
})

test('a job whose Submit was pressed needs its own confirmation, valid only for that press', async () => {
  const user = 'batch3'
  const pressed = '2026-10-01T10:00:00.000Z'
  const jobs = await prepared(user, 3, i => i === 0 ? { submitPressedAt: pressed, status: 'needs_user' } : {})
  await assert.rejects(batch.startApplyBatch(user, jobs.map(j => ({ id: j.id })), { autoStart: false }), /Submit was already pressed for Engineer 1/)
  // confirmResubmit on a job that was never pressed is not stored
  const started = await batch.startApplyBatch(user, jobs.map((j, i) => ({ id: j.id, confirmResubmit: i !== 2 })), { autoStart: false })
  assert.deepEqual(started.items.map(i => i.confirmResubmit), [true, false, false])
  // Job 2's Submit is pressed after the user confirmed (e.g. a retry elsewhere): not covered
  await store.updateJob(user, jobs[1].id, { submitPressedAt: '2026-10-02T10:00:00.000Z' })
  const { approve, calls } = fakeApprove(user)
  await batch.runApplyBatch(user, { approve })
  assert.deepEqual(calls.map(c => [c.id, c.confirmResubmit]), [[jobs[0].id, true], [jobs[2].id, false]])
  const items = (await batch.getApplyBatch(user)).items
  assert.equal(items[1].state, 'skipped')
  assert.match(items[1].message, /after you confirmed/)
})

test('materials changed after confirmation are skipped, not submitted', async () => {
  const user = 'batch4'
  const jobs = await prepared(user, 2)
  await batch.startApplyBatch(user, jobs.map(j => ({ id: j.id })), { autoStart: false })
  await store.updateJob(user, jobs[0].id, { coverLetter: 'A different letter the user never reviewed' })
  const { approve, calls } = fakeApprove(user)
  await batch.runApplyBatch(user, { approve })
  assert.deepEqual(calls.map(c => c.id), [jobs[1].id])
  const [first] = (await batch.getApplyBatch(user)).items
  assert.equal(first.state, 'skipped')
  assert.match(first.message, /changed after you confirmed/)
})

test('cancel stops before the next application; the one in progress finishes', async () => {
  const user = 'batch5'
  const jobs = await prepared(user, 3)
  await batch.startApplyBatch(user, jobs.map(j => ({ id: j.id })), { autoStart: false })
  const { approve: inner, calls } = fakeApprove(user)
  const approve = async (...args) => {
    if (calls.length === 0) await batch.cancelApplyBatch(user) // user cancels while job 1 is being applied
    return inner(...args)
  }
  await batch.runApplyBatch(user, { approve })
  assert.deepEqual(calls.map(c => c.id), [jobs[0].id])
  const b = await batch.getApplyBatch(user)
  assert.equal(b.state, 'cancelled')
  assert.deepEqual(b.items.map(i => i.state), ['submitted', 'cancelled', 'cancelled'])
  // A new batch can start once the old one is cancelled
  await batch.startApplyBatch(user, [{ id: jobs[1].id }], { autoStart: false })
})

test('refusals from approveJob are recorded per job and the batch continues', async () => {
  const user = 'batch6'
  const jobs = await prepared(user, 2)
  await batch.startApplyBatch(user, jobs.map(j => ({ id: j.id })), { autoStart: false })
  const { approve } = fakeApprove(user, id => id === jobs[0].id ? new Error('This application is already being submitted') : 'submitted')
  await batch.runApplyBatch(user, { approve })
  const items = (await batch.getApplyBatch(user)).items
  assert.deepEqual(items.map(i => i.state), ['skipped', 'submitted'])
  assert.match(items[0].message, /already being submitted/)
})

test('after a crash the interrupted application is handed to the user, never re-run, and the rest continue', async () => {
  const user = 'batch7'
  const jobs = await prepared(user, 3)
  await batch.startApplyBatch(user, jobs.map(j => ({ id: j.id })), { autoStart: false })
  // Simulate a worker in a process that died while applying to job 1
  await store.updateJobState(user, 'apply-batch', null, b => ({
    ...b, worker: { process: 'dead-process', pid: 2 ** 22 + 12345, host: hostname(), heartbeatAt: new Date().toISOString() },
    items: b.items.map((i, n) => n === 0 ? { ...i, state: 'running' } : i),
  }))
  const { approve, calls } = fakeApprove(user)
  await batch.runApplyBatch(user, { approve })
  assert.deepEqual(calls.map(c => c.id), [jobs[1].id, jobs[2].id])
  const items = (await batch.getApplyBatch(user)).items
  assert.equal(items[0].state, 'needs_user')
  assert.match(items[0].message, /Interrupted/)
})

test('a batch held by a live worker is not taken over', async () => {
  const user = 'batch8'
  const jobs = await prepared(user, 1)
  await batch.startApplyBatch(user, [{ id: jobs[0].id }], { autoStart: false })
  // Another live process on this machine (the test runner's parent) owns it
  await store.updateJobState(user, 'apply-batch', null, b => ({ ...b, worker: { process: 'other', pid: process.ppid, host: hostname(), heartbeatAt: new Date().toISOString() } }))
  const { approve, calls } = fakeApprove(user)
  await batch.runApplyBatch(user, { approve })
  assert.equal(calls.length, 0)
  assert.equal((await batch.getApplyBatch(user)).items[0].state, 'queued')
})

// ── API route ────────────────────────────────────────────────────────────────

const ts = require('typescript')
function load(file, dependencies) {
  const filename = join(__dirname, file)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(dirname(filename))
  loaded.require = request => Object.hasOwn(dependencies, request) ? dependencies[request] : module.require(request)
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename)
  return loaded.exports
}
class Response {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200 }
  static json(body, init) { return new Response(body, init) }
}
const routeCalls = []
const route = load('../app/api/jobs/route.ts', {
  'next/server': { NextResponse: Response },
  '@/lib/access': { requirePermission: async () => ({ id: 'u1', username: 'route-user' }) },
  '@/lib/job-hunter': {},
  '@/lib/job-hunter/intake': {},
  '@/lib/job-hunter/sources': { keyedSources: () => ({}) },
  '@/lib/job-hunter/autopilot': {},
  '@/lib/job-hunter/batch': {
    startApplyBatch: async (username, items) => { routeCalls.push({ action: 'start', username, items }); return { id: 'b1', items } },
    cancelApplyBatch: async username => { routeCalls.push({ action: 'cancel', username }); return null },
    getApplyBatch: async () => null, runApplyBatch: async () => {},
  },
  '@/lib/job-hunter/pipeline': {
    startFollowUpReminders: () => {},
    updatePipeline: async (username, id, patch) => { routeCalls.push({ action: 'pipeline', username, id, patch }); return { id } },
  },
  '@/lib/hosted': require('../lib/hosted.ts'),
  '@/lib/providers': { runWithAIUser: (_id, fn) => fn() },
})
const post = body => route.POST({ json: async () => body })

test('batch-apply queues only the signed-in user\'s confirmed items, with strict confirmations', async () => {
  routeCalls.length = 0
  const r = await post({ action: 'batch-apply', items: [{ id: 'a', confirmResubmit: 'yes' }, { id: 'b', confirmResubmit: true }], username: 'victim' })
  assert.equal(r.status, 200)
  assert.deepEqual(routeCalls, [{ action: 'start', username: 'route-user', items: [{ id: 'a', confirmResubmit: false }, { id: 'b', confirmResubmit: true }] }])
  assert.equal((await post({ action: 'batch-apply' })).status, 400)
  assert.equal((await post({ action: 'batch-cancel' })).status, 200)
  assert.equal(routeCalls.at(-1).username, 'route-user')
})

test('pipeline updates are scoped to the signed-in user and pass only the pipeline fields', async () => {
  routeCalls.length = 0
  const r = await post({ action: 'pipeline', id: 'j1', stage: 'interview', followUpInDays: 7, notes: 'n', status: 'submitted', username: 'victim' })
  assert.equal(r.status, 200)
  assert.deepEqual(routeCalls, [{ action: 'pipeline', username: 'route-user', id: 'j1', patch: { stage: 'interview', followUpAt: undefined, followUpInDays: 7, notes: 'n' } }])
  assert.equal((await post({ action: 'pipeline', stage: 'offer' })).status, 400)
})

test('hosted mode refuses batch applications (fail-closed, like single approvals)', async () => {
  const before = process.env.GHOSTFORGE_MODE
  process.env.GHOSTFORGE_MODE = 'hosted'
  routeCalls.length = 0
  try {
    for (const action of ['batch-apply', 'batch-cancel', 'approve']) {
      const r = await post({ action, items: [{ id: 'a' }] })
      assert.notEqual(r.status, 200, action)
    }
    assert.equal(routeCalls.length, 0)
  } finally {
    if (before === undefined) delete process.env.GHOSTFORGE_MODE
    else process.env.GHOSTFORGE_MODE = before
  }
})
