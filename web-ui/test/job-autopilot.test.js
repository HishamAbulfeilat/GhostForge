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
  { title: 'Senior Frontend Engineer', company_name: 'Acme', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/acme/1', salary: '', description: 'React TypeScript', publication_date: '2026-09-01' },
  { title: 'Frontend Engineer', company_name: 'Beta', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/beta/2', salary: '', description: 'React', publication_date: '2026-09-01' },
  { title: 'Frontend Lead', company_name: 'Gamma', candidate_required_location: 'Worldwide', url: 'https://www.linkedin.com/jobs/view/3', salary: '', description: 'React', publication_date: '2026-09-01' },
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
  assert.deepEqual(calls.map(c => c.opts), [{ headless: true, by: 'autopilot' }, { headless: true, by: 'autopilot' }])
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
