// One autopilot pass per user at a time, and the daily limit re-checked before
// every submit. "Run now", the scheduler tick and `jobs autopilot run` (CLI, its
// own process) must never together submit more than the daily limit.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir, hostname } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-autopilot-lock-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'
delete process.env.JSEARCH_API_KEY
delete process.env.RAPIDAPI_KEY

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + ext, context) } catch { /* next */ }
        }
      }
      throw err
    }
  },
})

const jh = require('../lib/job-hunter/index.ts')
const ap = require('../lib/job-hunter/autopilot.ts')
const store = require('../lib/job-hunter/store.ts')

// Two Lever listings: both auto-submittable in safe mode
const LISTINGS = [
  { title: 'Senior Frontend Engineer', company_name: 'Acme', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/acme/1', salary: '', description: 'React TypeScript', publication_date: '2026-09-01' },
  { title: 'Frontend Engineer', company_name: 'Beta', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/beta/2', salary: '', description: 'React', publication_date: '2026-09-01' },
]

const realFetch = globalThis.fetch
test.before(() => {
  globalThis.fetch = async url => {
    const host = new URL(String(url)).hostname
    const body = host === 'remotive.com' ? { jobs: LISTINGS }
      : host === 'remoteok.com' ? [{ legal: 'notice' }]
      : host === 'www.arbeitnow.com' ? { data: [] }
      : host === 'www.themuse.com' ? { results: [] }
      : null
    if (!body) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
})

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 300))
  globalThis.fetch = realFetch
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const fakeAi = async ({ system, prompt }) => {
  if (/job evaluation/i.test(system || '')) {
    const n = (String(prompt).match(/^\[\d+\]/gm) || []).length
    return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, fit: 'High', score: 90, reasons: 'strong match' })))
  }
  return /cover letters/.test(system || '') ? 'Dear Hiring Manager,\nRegards,\nJane Example' : '# Jane Example'
}

/** Fake form filler: records calls; `during` runs inside each call before it "submits". */
function recorder(during = async () => {}) {
  const calls = []
  const approve = async (username, id, opts) => {
    calls.push({ id, opts })
    await during(calls.length, username)
    const job = await jh.updateJob(username, id, { status: 'submitted' }, 'test submit')
    return { job, message: 'ok', missing: [] }
  }
  return { calls, approve }
}

async function setupUser(user, autopilot) {
  await jh.importCv(user, 'cv.txt', Buffer.from('Jane Example\njane@example.com | +81 90 1234 5678\nSenior Frontend Engineer | Acme | 2021 - Present\nReact TypeScript'), null)
  await jh.saveProfile(user, {
    preferences: { titles: ['frontend'], locations: ['Remote'], remote: 'remote', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] },
    applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+81 90 1234 5678', city: 'Tokyo', country: 'Japan' },
    autopilot,
  })
}

const lockFile = user => join(store.userDir(user), 'autopilot.lock')
function writeLock(user, info) {
  mkdirSync(store.userDir(user), { recursive: true })
  const at = new Date().toISOString()
  writeFileSync(lockFile(user), JSON.stringify({ pid: process.ppid, host: hostname(), startedAt: at, heartbeatAt: at, token: 'other-process', ...info }))
}

test('a second "Run now" while a pass is running does not start, so the daily limit holds', async () => {
  const user = 'overlap'
  await setupUser(user, { enabled: true, intervalHours: 1, dailyLimit: 1, minScore: 75 })
  let release
  const gate = new Promise(resolve => { release = resolve })
  let entered
  const inside = new Promise(resolve => { entered = resolve })
  const { calls, approve } = recorder(async () => { entered(); await gate })

  const first = ap.runAutopilot(user, { force: true, generate: fakeAi, approve })
  await inside // the first pass is now submitting its one application
  assert.equal(ap.autopilotRunning(user), true)
  // The second pass (another click, or the scheduler) must not run alongside it
  const second = ap.runAutopilot(user, { force: true, generate: fakeAi, approve })
  const early = await Promise.race([second, new Promise(resolve => setTimeout(() => resolve('still running'), 3000))])
  release()
  const [r1, r2] = await Promise.all([first, second])
  assert.notEqual(early, 'still running', 'the second pass returned at once')
  assert.equal(r1.submitted, 1)
  assert.equal(r2.ran, false)
  assert.match(r2.reason, /already in progress/)
  assert.equal(calls.length, 1, 'only one application in total for a limit of 1')
  assert.equal(ap.submittedToday((await jh.getProfile(user)).autopilot), 1)
  assert.equal(ap.autopilotRunning(user), false)
  assert.equal(existsSync(lockFile(user)), false, 'the lock file is removed after the pass')
})

test('the limit is re-read before each submit: a lower limit or autopilot turned off mid-run stops the pass', async () => {
  // The user lowers the daily limit to 1 while the first application is being sent
  const lowered = 'lowered'
  await setupUser(lowered, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  const a = recorder(async (n, u) => { if (n === 1) await jh.saveProfile(u, { autopilot: { dailyLimit: 1 } }) })
  const r = await ap.runAutopilot(lowered, { force: true, generate: fakeAi, approve: a.approve })
  assert.equal(a.calls.length, 1)
  assert.equal(r.submitted, 1)
  assert.equal(r.remainingToday, 0)

  // Another process counted submissions meanwhile (each submit is counted at once)
  const counted = 'counted'
  await setupUser(counted, { enabled: true, intervalHours: 1, dailyLimit: 2, minScore: 75 })
  const b = recorder(async (n, u) => {
    if (n === 1) await jh.saveProfile(u, { autopilot: { submittedByDay: { [ap.dayKey()]: 1 } } })
  })
  await ap.runAutopilot(counted, { force: true, generate: fakeAi, approve: b.approve })
  assert.equal(b.calls.length, 1, '1 from elsewhere + 1 here = the limit of 2')
  assert.equal(ap.submittedToday((await jh.getProfile(counted)).autopilot), 2)

  // Turned off mid-run: nothing more is submitted
  const off = 'turned-off'
  await setupUser(off, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  const c = recorder(async (n, u) => { if (n === 1) await jh.saveProfile(u, { autopilot: { enabled: false } }) })
  await ap.runAutopilot(off, { force: true, generate: fakeAi, approve: c.approve })
  assert.equal(c.calls.length, 1)
  const p = await jh.getProfile(off)
  assert.equal(p.autopilot.enabled, false)
  assert.match(p.autopilot.lastResult, /turned off/)
})

test('a lock file from another live process (e.g. the CLI) is respected', async () => {
  const user = 'cli-running'
  await setupUser(user, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  writeLock(user, { pid: process.ppid }) // the parent process is alive
  const { calls, approve } = recorder()
  const r = await ap.runAutopilot(user, { force: true, generate: fakeAi, approve })
  assert.equal(r.ran, false)
  assert.match(r.reason, /already in progress/)
  assert.equal(calls.length, 0)
  assert.equal(existsSync(lockFile(user)), true, 'another process\'s lock is left alone')
  rmSync(lockFile(user))
})

test('a stale lock (process gone, or not refreshed for too long) is taken over', async () => {
  const dead = spawnSync(process.execPath, ['-e', '0']).pid
  const gone = 'lock-gone'
  await setupUser(gone, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  writeLock(gone, { pid: dead })
  const a = recorder()
  const r = await ap.runAutopilot(gone, { force: true, generate: fakeAi, approve: a.approve })
  assert.equal(r.ran, true)
  assert.equal(a.calls.length, 2)
  assert.equal(existsSync(lockFile(gone)), false)

  // Alive, but last refreshed 3 hours ago (hung, or a process on another machine)
  const old = 'lock-old'
  await setupUser(old, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  const long = new Date(Date.now() - 3 * 3_600_000).toISOString()
  writeLock(old, { pid: process.ppid, host: 'another-machine', startedAt: long, heartbeatAt: long })
  const b = recorder()
  assert.equal((await ap.runAutopilot(old, { force: true, generate: fakeAi, approve: b.approve })).ran, true)
  assert.equal(b.calls.length, 2)

  // Another machine's recent lock: its pid can't be checked here, so it is respected
  const remote = 'lock-remote'
  await setupUser(remote, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  writeLock(remote, { pid: 999999, host: 'another-machine' })
  const c = recorder()
  assert.equal((await ap.runAutopilot(remote, { force: true, generate: fakeAi, approve: c.approve })).ran, false)
  assert.equal(c.calls.length, 0)
})

test('the lock never bypasses the off switch: a pass for a user with autopilot off takes no lock', async () => {
  const user = 'lock-off'
  await setupUser(user, { enabled: false, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  const { calls, approve } = recorder()
  const r = await ap.runAutopilot(user, { force: true, generate: fakeAi, approve })
  assert.equal(r.ran, false)
  assert.match(r.reason, /Autopilot is off/)
  assert.equal(calls.length, 0)
  assert.equal(existsSync(lockFile(user)), false)
})
