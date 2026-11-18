// Applications cut off mid-apply (server restart, crash, redeploy) must not
// stay "submitting" forever: they go back to the user as "needs_user" with a
// note to check the employer site, are never resubmitted automatically, and
// the user can dismiss them, retry them or mark them as applied.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname } = require('node:path')
const ts = require('typescript')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-job-interrupted-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (error) {
      if (specifier.startsWith('.')) {
        for (const suffix of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + suffix, context) } catch { /* next suffix */ }
        }
      }
      throw error
    }
  },
})

const store = require('../lib/job-hunter/store.ts')
const live = require('../lib/job-hunter/live.ts')

/** Load a TS module with some of its imports replaced (the rest resolve next to the file). */
function load(file, dependencies) {
  const filename = join(__dirname, file)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(dirname(filename))
  const near = Module.createRequire(filename)
  loaded.require = request => Object.hasOwn(dependencies, request) ? dependencies[request] : near(request)
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename)
  return loaded.exports
}

const applyCalls = []
let applyImpl = async () => ({ status: 'needs_user', message: 'Captcha required', filled: [], missing: [] })
const jh = load('../lib/job-hunter/index.ts', {
  './store': store,
  './live': live,
  './apply': { applyToJob: async (job, profile, username, opts) => { applyCalls.push({ job, username, opts }); return applyImpl(job, profile, username, opts) } },
  './notifications': { notifyJob: async () => 'unavailable' },
})

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 200)) // fire-and-forget audit writes
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const MIN = 60_000
const iso = ms => new Date(ms).toISOString()
const deadPid = 2 ** 22 + 12345 // above Linux pid_max: never a live process
let seq = 0

async function seedUser(extra = {}) {
  const username = `user-${++seq}`
  await store.saveProfile(username, {
    cv: { text: 'Jane Example\nEngineer', fileName: 'cv.txt', filePath: '', uploadedAt: '' },
    applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+1 555 0100' },
    preferences: { titles: ['Engineer'] },
    ...extra,
  })
  return username
}

async function seedJob(username, patch, key = `k${++seq}`) {
  const { jobs } = await store.upsertJobs(username, [{
    key, source: 'test', title: 'Engineer', company: 'Acme', location: '', remote: true, salary: '',
    url: 'https://jobs.lever.co/acme/1', applyUrl: '', ats: 'lever', description: '', postedAt: '',
    fit: 'High', score: 95, reasons: '',
  }])
  const job = jobs.find(j => j.key === key)
  return store.updateJob(username, job.id, { tailoredResume: 'CV', coverLetter: 'Letter', ...patch })
}

// ── deciding whether a "submitting" job is still running ───────────────────

test('a run is interrupted only when no process is still filling the form', async () => {
  const username = await seedUser()
  const now = Date.now()
  const job = (patch) => ({ id: 'j1', status: 'submitting', updatedAt: iso(now - MIN), createdAt: iso(now - 60 * MIN), ...patch })
  const alive = pid => pid === 4242 || pid === process.pid
  const here = store.applicationRunner()

  assert.equal(store.isInterruptedRun(username, job({ status: 'needs_user' }), now, alive), false, 'only submitting jobs')
  assert.equal(store.isInterruptedRun(username, job({ runner: here }), now, alive), true, 'started here, no longer running here')
  assert.equal(store.isInterruptedRun(username, job({ runner: { ...here, instance: 'earlier-process' } }), now, alive), true,
    'same pid but an earlier process (container restart)')
  assert.equal(store.isInterruptedRun(username, job({ runner: { pid: 4242, instance: 'cli', startedAt: '' } }), now, alive), false,
    'another live process (the CLI) is still applying')
  assert.equal(store.isInterruptedRun(username, job({ runner: { pid: deadPid, instance: 'old', startedAt: '' } }), now, alive), true,
    'the process that started it has exited')
  assert.equal(store.isInterruptedRun(username, job({ runner: { pid: 4242, instance: 'cli', startedAt: '' }, updatedAt: iso(now - 30 * MIN) }), now, alive), true,
    'a live process that has written nothing for a long time is treated as gone')
  assert.equal(store.isInterruptedRun(username, job({}), now, alive), false, 'old records without a runner wait until they go quiet')
  assert.equal(store.isInterruptedRun(username, job({ updatedAt: iso(now - 30 * MIN) }), now, alive), true)
  assert.equal(store.isInterruptedRun(username, job({ updatedAt: 'garbage' }), now, alive), true)

  // An operation running in this process is never interrupted, whatever the record says.
  let release
  const running = store.withJobOperation(username, 'j1', () => new Promise(resolve => { release = resolve }))
  assert.equal(store.isInterruptedRun(username, job({ runner: here, updatedAt: iso(now - 60 * MIN) }), now, alive), false)
  release()
  await running
})

// ── recovery ────────────────────────────────────────────────────────────────

test('recovery hands interrupted jobs back to the user and leaves live runs and other jobs alone', async () => {
  const username = await seedUser()
  const crashed = await seedJob(username, {
    status: 'submitting', runner: { pid: deadPid, instance: 'old', startedAt: '' },
    questions: [{ label: 'Notice period', type: 'text', options: [] }],
  })
  const cli = await seedJob(username, { status: 'submitting', runner: { pid: process.ppid, instance: 'cli', startedAt: '' } })
  const ready = await seedJob(username, { status: 'ready' })

  const recovered = await store.recoverInterruptedJobs(username)
  assert.deepEqual(recovered.map(j => j.id), [crashed.id])

  const after = await store.getJob(username, crashed.id)
  assert.equal(after.status, 'needs_user')
  assert.ok(after.interruptedAt)
  assert.equal(after.runner, undefined)
  assert.equal(after.questions, undefined, 'stale questions would return the job to the autopilot queue once answered')
  assert.match(after.log.at(-1).msg, /Interrupted.*may or may not have been submitted.*Check the employer site/)
  assert.equal(after.activity.phase, 'blocked')
  assert.equal((await store.getJob(username, cli.id)).status, 'submitting', 'the CLI process is alive and still applying')
  assert.equal((await store.getJob(username, ready.id)).status, 'ready')
  assert.deepEqual(await store.recoverInterruptedJobs(username), [], 'nothing left to recover')
})

test('startup recovery covers every user and records which jobs were interrupted', async () => {
  const a = await seedUser()
  const b = await seedUser()
  const ja = await seedJob(a, { status: 'submitting', runner: store.applicationRunner() })
  const jb = await seedJob(b, { status: 'submitting', runner: { pid: deadPid, instance: 'old', startedAt: '' } })
  const recovered = await store.recoverAllInterruptedJobs()
  assert.deepEqual(recovered.find(r => r.username === a)?.jobIds, [ja.id])
  assert.deepEqual(recovered.find(r => r.username === b)?.jobIds, [jb.id])
  assert.equal((await store.getJob(a, ja.id)).status, 'needs_user')
})

test('the server recovers on start (even with autopilot off) and the jobs list recovers before it is read', () => {
  const autopilot = readFileSync(join(__dirname, '../lib/job-hunter/autopilot.ts'), 'utf8')
  const start = autopilot.slice(autopilot.indexOf('export function startAutopilotScheduler'))
  assert.ok(start.indexOf('recoverInterruptedOnStart()') > 0)
  assert.ok(start.indexOf('recoverInterruptedOnStart()') < start.indexOf("GF_JOB_AUTOPILOT === '0'"), 'GF_JOB_AUTOPILOT=0 turns off the schedule, not recovery')
})

test('GET /api/jobs recovers interrupted jobs before listing them; mark-applied is an action', async () => {
  const calls = []
  class Response {
    constructor(body, init = {}) { this.body = body; this.status = init.status || 200 }
    static json(body, init) { return new Response(body, init) }
  }
  const route = load('../app/api/jobs/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/access': { requirePermission: async () => ({ username: 'owner' }) },
    '@/lib/job-hunter': {
      recoverInterruptedJobs: async username => { calls.push(['recover', username]); return [] },
      listJobs: async username => { calls.push(['list', username]); return [{ id: 'j1', status: 'needs_user', updatedAt: '' }] },
      getProfile: async () => store.getProfile('owner'),
      missingApplicantFields: () => [],
      markApplied: async (username, id) => { calls.push(['mark-applied', username, id]); return { id, status: 'submitted' } },
    },
    '@/lib/job-hunter/intake': {},
    '@/lib/job-hunter/sources': { jsearchKey: () => '' },
    '@/lib/job-hunter/autopilot': { runAutopilot: async () => ({}), submittedToday: () => 0 },
  })
  const res = await route.GET({})
  assert.equal(res.status, 200)
  assert.deepEqual(calls.slice(0, 2), [['recover', 'owner'], ['list', 'owner']])
  const marked = await route.POST({ json: async () => ({ action: 'mark-applied', id: 'j1' }) })
  assert.equal(marked.body.job.status, 'submitted')
  assert.deepEqual(calls.at(-1), ['mark-applied', 'owner', 'j1'])
})

// ── what the user can do with an interrupted job ────────────────────────────

test('approving records the running process, and an interrupted run is recovered, not resubmitted', async () => {
  const username = await seedUser()
  const job = await seedJob(username, { status: 'ready' })
  let seen
  applyImpl = async () => {
    seen = await store.getJob(username, job.id)
    // The approval is still running in this process: recovery must not touch it.
    assert.deepEqual(await store.recoverInterruptedJobs(username), [])
    return { status: 'needs_user', message: 'Captcha required', filled: [], missing: [] }
  }
  const result = await jh.approveJob(username, job.id)
  assert.equal(seen.status, 'submitting')
  assert.equal(seen.runner.pid, process.pid)
  assert.equal(result.job.status, 'needs_user')
  assert.equal(result.job.runner, undefined, 'a finished run clears its runner')

  // Simulate a crash mid-apply in this process: status left "submitting", no operation running.
  await store.updateJob(username, job.id, { status: 'submitting', runner: store.applicationRunner() })
  await assert.rejects(jh.approveJob(username, job.id), /submitting/)
  applyCalls.length = 0
  const [recovered] = await jh.recoverInterruptedJobs(username)
  assert.equal(recovered.id, job.id)
  assert.equal(applyCalls.length, 0, 'recovery never applies again')

  // The user may retry it on purpose; that clears the interruption note.
  applyImpl = async () => ({ status: 'needs_user', message: 'Captcha required', filled: [], missing: [] })
  const retried = await jh.approveJob(username, job.id)
  assert.equal(applyCalls.length, 1)
  assert.equal(retried.job.interruptedAt, undefined)
})

test('autopilot never picks up an interrupted application', async t => {
  const username = await seedUser({ autopilot: { enabled: true, mode: 'safe', minScore: 50, dailyLimit: 5 } })
  const job = await seedJob(username, { status: 'submitting', runner: { pid: deadPid, instance: 'old', startedAt: '' } })
  await store.recoverInterruptedJobs(username)
  t.mock.method(globalThis, 'fetch', async () => new Response('not found', { status: 404 }))
  const ap = load('../lib/job-hunter/autopilot.ts', { './index': jh, './store': store })
  const approved = []
  const report = await ap.runAutopilot(username, { force: true, generate: null, approve: async (u, id) => { approved.push(id); throw new Error('unexpected') } })
  assert.equal(report.ran, true)
  assert.deepEqual(approved, [])
  assert.equal((await store.getJob(username, job.id)).status, 'needs_user')
})

test('the user can mark an interrupted application as applied or dismiss it', async () => {
  const username = await seedUser()
  const one = await seedJob(username, { status: 'submitting', runner: { pid: deadPid, instance: 'old', startedAt: '' } })
  const two = await seedJob(username, { status: 'submitting', runner: { pid: deadPid, instance: 'old', startedAt: '' } })
  await store.recoverInterruptedJobs(username)

  const marked = await jh.markApplied(username, one.id)
  assert.equal(marked.status, 'submitted')
  assert.equal(marked.interruptedAt, undefined)
  assert.match(marked.log.at(-1).msg, /marked this application as submitted/)
  await assert.rejects(jh.markApplied(username, one.id), /only an application waiting for you/)
  const ready = await seedJob(username, { status: 'ready' })
  await assert.rejects(jh.markApplied(username, ready.id), /only an application waiting for you/)

  const dismissed = await jh.dismissJob(username, two.id)
  assert.equal(dismissed.status, 'dismissed')
  assert.equal(dismissed.interruptedAt, undefined)
})

test('the review page explains an interrupted application and offers Mark as applied', () => {
  const page = readFileSync(join(__dirname, '../app/jobs/page.tsx'), 'utf8')
  assert.match(page, /job\.interruptedAt && job\.status === 'needs_user'/)
  assert.match(page, /may or may not\s+have been submitted/)
  assert.match(page, /act\('mark-applied', job\.id\)/)
  assert.match(page, /Mark as applied/)
})
