const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-autopilot-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'
delete process.env.JSEARCH_API_KEY
delete process.env.RAPIDAPI_KEY
// Listings older than 30 days are dropped as stale, so fixtures are dated relative to today
const RECENT = new Date(Date.now() - 2 * 86_400_000).toISOString()

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

// Three listings: two on Lever (auto-submittable), one on LinkedIn (never auto-submitted)
const LISTINGS = [
  { title: 'Senior Frontend Engineer', company_name: 'Acme', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/acme/1', salary: '', description: 'React TypeScript', publication_date: RECENT },
  { title: 'Frontend Engineer', company_name: 'Beta', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/beta/2', salary: '', description: 'React', publication_date: RECENT },
  { title: 'Frontend Lead', company_name: 'Gamma', candidate_required_location: 'Worldwide', url: 'https://www.linkedin.com/jobs/view/3', salary: '', description: 'React', publication_date: RECENT },
]

// Swapped in by tests that need other listings (clear the source cache when changing it)
let extraListings = null
const sources = require('../lib/job-hunter/sources.ts')

const realFetch = globalThis.fetch
test.before(() => {
  globalThis.fetch = async url => {
    const host = new URL(String(url)).hostname
    const body = host === 'remotive.com' ? { jobs: extraListings || LISTINGS }
      : host === 'remoteok.com' ? [{ legal: 'notice' }]
      : host === 'www.arbeitnow.com' ? { data: [] }
      : host === 'www.themuse.com' ? { results: [] }
      : null
    if (!body) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
})

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 300)) // let fire-and-forget audit writes finish
  globalThis.fetch = realFetch
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Fake model: every job scores High 90; writing tasks return plain text */
const fakeAi = async ({ system, prompt }) => {
  if (/job evaluation/i.test(system || '')) {
    const n = (String(prompt).match(/^\[\d+\]/gm) || []).length
    return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, fit: 'High', score: 90, reasons: 'strong match' })))
  }
  return /cover letters/.test(system || '') ? 'Dear Hiring Manager,\nRegards,\nJane Example' : '# Jane Example'
}

/** Fake form filler: records calls instead of opening a browser */
function recorder() {
  const calls = []
  const approve = async (username, id, opts) => {
    calls.push({ id, opts })
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

test('AI writing outage leaves drafts ready for manual approval, never auto-submitted', async () => {
  const user = 'ai-outage'
  await setupUser(user, { enabled: true, dailyLimit: 5, mode: 'full', minScore: 75 })
  const { calls, approve } = recorder()
  const generate = async opts => {
    if (/job evaluation/i.test(opts.system || '')) return fakeAi(opts)
    throw new Error('No AI model answered')
  }
  const report = await ap.runAutopilot(user, { force: true, generate, approve })
  assert.equal(report.ran, true)
  assert.equal(report.prepared, 2)
  assert.equal(report.submitted, 0)
  assert.equal(calls.length, 0)
  const drafts = (await jh.listJobs(user)).filter(j => j.status === 'ready')
  assert.equal(drafts.length, 2)
  assert.ok(drafts.every(j => j.preparationWarning && j.tailoredResume && j.coverLetter))
  assert.match((await jh.getProfile(user)).autopilot.lastResult, /draft\(s\) need your approval/)
})

test('the per-user model choice is saved, and null follows Settings', async () => {
  const user = 'modeluser'
  assert.equal((await jh.getProfile(user)).model, null)
  await jh.saveProfile(user, { model: { provider: 'groq', model: 'llama-3.3-70b-versatile' } })
  assert.deepEqual((await jh.getProfile(user)).model, { provider: 'groq', model: 'llama-3.3-70b-versatile' })
  await jh.saveProfile(user, { applicant: { city: 'Osaka' } }) // unrelated saves keep the choice
  assert.equal((await jh.getProfile(user)).model.provider, 'groq')
  await jh.saveProfile(user, { model: null })
  assert.equal((await jh.getProfile(user)).model, null)
  assert.equal(typeof jh.generatorFor({ provider: 'ollama', model: 'qwen3:8b' }), 'function')
})

test('autopilot is off by default and does nothing until enabled', async () => {
  const user = 'offuser'
  const p = await jh.getProfile(user)
  assert.equal(p.autopilot.enabled, false)
  const r = await ap.runAutopilot(user, { generate: fakeAi })
  assert.equal(r.ran, false)
  assert.match(r.reason, /off/)
})

test('autopilot refuses to submit without the required application details', async () => {
  const user = 'nodetails'
  await jh.saveProfile(user, { autopilot: { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 } })
  const { approve, calls } = recorder()
  const r = await ap.runAutopilot(user, { generate: fakeAi, approve })
  assert.equal(r.ran, false)
  assert.match(r.reason, /Waiting for your CV/)
  assert.equal(calls.length, 0)
})

test('autopilot searches, prepares and submits only auto-submittable jobs, headlessly', async () => {
  const user = 'pilot'
  await setupUser(user, { enabled: true, intervalHours: 12, dailyLimit: 5, minScore: 75 })
  const { approve, calls } = recorder()
  const r = await ap.runAutopilot(user, { generate: fakeAi, approve })
  assert.equal(r.ran, true)
  assert.equal(r.submitted, 2, 'both Lever jobs')
  assert.deepEqual(calls.map(c => c.opts), [{ headless: true, by: 'autopilot', allowSubmit: true }, { headless: true, by: 'autopilot', allowSubmit: true }])
  const jobs = await jh.listJobs(user)
  const linkedin = jobs.find(j => j.ats === 'linkedin')
  assert.notEqual(linkedin.status, 'submitted', 'LinkedIn is never auto-submitted')
  const p = await jh.getProfile(user)
  assert.equal(ap.submittedToday(p.autopilot), 2)
  assert.ok(p.autopilot.lastRunAt)
  assert.match(p.autopilot.lastResult, /submitted 2/)
})

test('autopilot respects the daily limit and the minimum score', async () => {
  const user = 'limited'
  await setupUser(user, { enabled: true, intervalHours: 1, dailyLimit: 1, minScore: 75 })
  const first = recorder()
  const r1 = await ap.runAutopilot(user, { generate: fakeAi, approve: first.approve })
  assert.equal(r1.submitted, 1)

  // Same day, forced again: the limit is used up
  const second = recorder()
  const r2 = await ap.runAutopilot(user, { force: true, generate: fakeAi, approve: second.approve })
  assert.equal(second.calls.length, 0)
  assert.equal(r2.submitted, 0)

  // A minimum above every score submits nothing
  const strict = 'strict'
  await setupUser(strict, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 95 })
  const third = recorder()
  const r3 = await ap.runAutopilot(strict, { generate: fakeAi, approve: third.approve })
  assert.equal(third.calls.length, 0)
  assert.equal(r3.submitted, 0)
})

test('autopilot schedule: due only when enabled and the interval has passed', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  const base = { enabled: true, intervalHours: 12, dailyLimit: 5, minScore: 75 }
  assert.equal(ap.isDue({ ...base }, now), true)
  assert.equal(ap.isDue({ ...base, lastRunAt: '2026-09-28T06:00:00Z' }, now), false)
  assert.equal(ap.isDue({ ...base, lastRunAt: '2026-09-27T23:00:00Z' }, now), true)
  assert.equal(ap.isDue({ ...base, enabled: false }, now), false)
})

test('LinkedIn Easy Apply needs the opt-in, a connected sign-in and full mode, and has its own daily cap', async () => {
  const base = { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 }

  // Opted in but not signed in to LinkedIn: LinkedIn jobs are left alone
  const notConnected = 'li-off'
  await setupUser(notConnected, { ...base, mode: 'full', linkedinEasyApply: true, linkedinDailyLimit: 3 })
  const a = recorder()
  await ap.runAutopilot(notConnected, { generate: fakeAi, approve: a.approve, linkedinGapMs: 0 })
  const ids = new Map((await jh.listJobs(notConnected)).map(j => [j.id, j.ats]))
  assert.ok(a.calls.every(c => ids.get(c.id) !== 'linkedin'))

  // Opted in and signed in: LinkedIn is applied to, within its own limit
  const user = 'li-on'
  await setupUser(user, { ...base, mode: 'full', linkedinEasyApply: true, linkedinDailyLimit: 1 })
  await jh.saveProfile(user, { linkedin: { connectedAt: new Date().toISOString(), checkedAt: new Date().toISOString() } })
  const b = recorder()
  const r = await ap.runAutopilot(user, { generate: fakeAi, approve: b.approve, linkedinGapMs: 0 })
  const atsById = new Map((await jh.listJobs(user)).map(j => [j.id, j.ats]))
  assert.equal(b.calls.filter(c => atsById.get(c.id) === 'linkedin').length, 1)
  assert.equal(r.submitted, 3, 'two Lever jobs and one LinkedIn job')
  const p = await jh.getProfile(user)
  assert.equal(Object.values(p.autopilot.linkedinByDay).reduce((x, y) => x + y, 0), 1)

  // Safe mode never auto-submits LinkedIn, even when connected and opted in
  const safe = 'li-safe'
  await setupUser(safe, { ...base, mode: 'safe', linkedinEasyApply: true, linkedinDailyLimit: 3 })
  await jh.saveProfile(safe, { linkedin: { connectedAt: new Date().toISOString(), checkedAt: new Date().toISOString() } })
  const c = recorder()
  await ap.runAutopilot(safe, { generate: fakeAi, approve: c.approve, linkedinGapMs: 0 })
  const safeAts = new Map((await jh.listJobs(safe)).map(j => [j.id, j.ats]))
  assert.ok(c.calls.every(call => safeAts.get(call.id) !== 'linkedin'))
})

test('answering a job\'s questions saves them for every later application and readies the job', async () => {
  const user = 'answers'
  await setupUser(user, { enabled: false, intervalHours: 12, dailyLimit: 5, minScore: 75 })
  await jh.runSearch(user, { generate: fakeAi, autoPrepare: 0 })
  const [job] = await jh.listJobs(user)
  await jh.updateJob(user, job.id, { status: 'needs_user', questions: [{ label: 'Years with React *', type: 'number', options: [] }, { label: 'Notice period', type: 'text', options: [] }] }, 'test')

  const partial = await jh.answerQuestions(user, job.id, { 'Years with React *': '5' })
  assert.equal(partial.status, 'needs_user')
  assert.deepEqual(partial.questions.map(q => q.label), ['Notice period'])
  assert.equal((await jh.getProfile(user)).customAnswers['Years with React'], '5')

  const done = await jh.answerQuestions(user, job.id, { 'Notice period': '1 month' })
  assert.equal(done.questions, undefined)
  assert.equal(done.status, 'ready')
  await assert.rejects(jh.answerQuestions(user, job.id, { 'Notice period': '   ' }), /at least one/)
  await assert.rejects(jh.answerQuestions(user, 'missing', { a: 'b' }), /not found/)
})

test('autopilot applies only to verified, open postings, retries a failed one once and reports problems', async () => {
  const user = 'verified-only'
  const listing = (title, company, url, description = 'React') => ({ title, company_name: company, candidate_required_location: 'Worldwide', url, salary: '', description, publication_date: RECENT })
  extraListings = [
    listing('Frontend Engineer', 'Alpha', 'https://careers.alpha.example/1'),           // live → applied (fails once, then succeeds)
    listing('Frontend Developer', 'Bravo', 'https://careers.bravo.example/2'),          // bot wall → unverified → left alone
    listing('Frontend Lead', 'Charlie', 'https://jobs.lever.co/charlie/3'),             // 404 → closed
    listing('Frontend Intern', 'Delta', 'https://careers.delta.example/4', 'React. New hires pay a training fee of $300.'), // scam signal
    listing('Senior Frontend Engineer', 'Echo', 'https://careers.echo.example/5'),     // live, always fails
  ]
  sources.clearSourceCache()
  const fetcher = async url => {
    const host = new URL(url).hostname
    const status = { 'careers.alpha.example': 200, 'careers.echo.example': 200, 'careers.bravo.example': 403, 'jobs.lever.co': 404 }[host] ?? 500
    return { status, body: '<h1>Frontend role</h1>', url }
  }
  const calls = []
  const approve = async (username, id) => {
    const j = await jh.getJob(username, id)
    calls.push(j.company)
    const attempts = (j.attempts || 0) + 1
    const ok = j.company === 'Alpha' && attempts > 1
    const job = await jh.updateJob(username, id, { status: ok ? 'submitted' : 'failed', attempts }, 'test')
    return { job, message: ok ? 'ok' : 'The site timed out', missing: [] }
  }
  try {
    await setupUser(user, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75, mode: 'full' })
    const r1 = await ap.runAutopilot(user, { generate: fakeAi, approve, fetcher })
    assert.deepEqual(calls.sort(), ['Alpha', 'Echo'])
    assert.equal(r1.failed, 2)
    assert.ok(r1.unverified >= 1, 'Bravo could not be verified')
    assert.match((await jh.getProfile(user)).autopilot.lastResult, /Problem: .*timed out/)

    const jobs = await jh.listJobs(user)
    const by = name => jobs.find(j => j.company === name)
    assert.equal(by('Bravo').verification.status, 'unverified')
    assert.equal(by('Charlie').verification.status, 'closed')
    assert.equal(by('Delta').verification.status, 'flagged')
    assert.equal(by('Delta').fit, 'Skip')

    calls.length = 0
    const r2 = await ap.runAutopilot(user, { force: true, generate: fakeAi, approve, fetcher })
    assert.deepEqual(calls.sort(), ['Alpha', 'Echo'], 'each failed job gets one more try')
    assert.equal(r2.submitted, 1)

    calls.length = 0
    await ap.runAutopilot(user, { force: true, generate: fakeAi, approve, fetcher })
    assert.deepEqual(calls, [], 'no third attempt, and the submitted job is done')
  } finally {
    extraListings = null
    sources.clearSourceCache()
  }
})

test('an application cut off by a restart is handed back to the user, not resubmitted', async () => {
  const user = 'interrupted'
  await setupUser(user, { enabled: false, intervalHours: 12, dailyLimit: 5, minScore: 75 })
  await jh.runSearch(user, { generate: fakeAi, autoPrepare: 0 })
  const [job] = await jh.listJobs(user)
  await jh.updateJob(user, job.id, { status: 'submitting' }, 'test')
  assert.equal(await jh.recoverInterrupted(user, Date.now() + 5 * 60_000), 0, 'a recent one may still be running')
  assert.equal(await jh.recoverInterrupted(user, Date.now() + 31 * 60_000), 1)
  const after = await jh.getJob(user, job.id)
  assert.equal(after.status, 'needs_user')
  assert.match(after.log.at(-1).msg, /interrupted/)
})

test('regression: a failed run after Submit was pressed is handed to the user and never auto-retried', async () => {
  // The outcome mapping used by approveJob
  assert.deepEqual(jh.settleResult({ status: 'failed', message: 'x' }), { status: 'failed', message: 'x' })
  const settled = jh.settleResult({ status: 'failed', message: 'Execution context was destroyed', submitPressed: true })
  assert.equal(settled.status, 'needs_user')
  assert.match(settled.message, /Submit was pressed/)
  assert.equal(jh.settleResult({ status: 'submitted', message: 'ok', submitPressed: true }).status, 'submitted')

  // Autopilot: a job whose Submit was pressed is not attempted again, even after a failure
  const user = 'pressed'
  await setupUser(user, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  const calls = []
  const approve = async (username, id) => {
    calls.push(id)
    const job = await jh.updateJob(username, id, { status: 'failed', attempts: 1, submitPressedAt: new Date().toISOString() }, 'test')
    return { job, message: 'context destroyed', missing: [] }
  }
  await ap.runAutopilot(user, { generate: fakeAi, approve })
  const first = calls.length
  assert.ok(first > 0)
  await ap.runAutopilot(user, { force: true, generate: fakeAi, approve })
  assert.equal(calls.length, first, 'no second submission')
})

test('regression: one autopilot pass per user at a time, and the scheduler state is shared on globalThis', async () => {
  const user = 'overlap'
  await setupUser(user, { enabled: true, intervalHours: 1, dailyLimit: 5, minScore: 75 })
  let release
  const gate = new Promise(r => { release = r })
  const approve = async (username, id) => {
    await gate
    const job = await jh.updateJob(username, id, { status: 'submitted' }, 'test')
    return { job, message: 'ok', missing: [] }
  }
  const a = ap.runAutopilot(user, { generate: fakeAi, approve })
  await new Promise(r => setTimeout(r, 200))
  const b = await ap.runAutopilot(user, { force: true, generate: fakeAi, approve })
  assert.equal(b.ran, false)
  assert.match(b.reason, /already running/)
  release()
  assert.equal((await a).ran, true)
  assert.ok(globalThis.__gfJobAutopilot && globalThis.__gfJobAutopilot.users instanceof Set)
  assert.ok(globalThis.__gfJobLocks instanceof Map, 'store write locks are shared too')
})
