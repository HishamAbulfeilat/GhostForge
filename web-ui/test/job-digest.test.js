const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-digest-'))
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
const dg = require('../lib/job-hunter/digest.ts')
const searched = []

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
    if (host === 'remotive.com') searched.push(new URL(String(url)).searchParams.get('search'))
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
  await new Promise(resolve => setTimeout(resolve, 300))
  globalThis.fetch = realFetch
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Fake model: Senior roles score 90, the rest 60 (both High) */
const fakeAi = async ({ system, prompt }) => {
  if (/job evaluation/i.test(system || '')) {
    const rows = String(prompt).match(/^\[\d+\].*$/gm) || []
    return JSON.stringify(rows.map((row, i) => ({ i, fit: 'High', score: /Senior/.test(row) ? 90 : 60, reasons: 'match' })))
  }
  throw new Error('a digest must never write application materials')
}

async function setupUser(user, extra = {}) {
  await jh.importCv(user, 'cv.txt', Buffer.from('Jane Example\nSenior Frontend Engineer\nReact TypeScript'), null)
  await jh.saveProfile(user, {
    preferences: { titles: ['designer'], locations: ['Remote'], remote: 'remote', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] },
    ...extra,
  })
}

test('the digest is off by default and runs only when due', async () => {
  const p = await jh.getProfile('nobody')
  assert.equal(p.digest.enabled, false)
  assert.deepEqual(p.savedSearches, [])
  assert.equal((await dg.runDigest('nobody', { generate: fakeAi })).ran, false)
  const now = Date.parse('2026-10-08T12:00:00Z')
  const on = { enabled: true, intervalHours: 24, minScore: 70 }
  assert.equal(dg.isDigestDue(on, now), true)
  assert.equal(dg.isDigestDue({ ...on, lastRunAt: '2026-10-08T00:00:00Z' }, now), false)
  assert.equal(dg.isDigestDue({ ...on, lastRunAt: '2026-10-07T11:00:00Z' }, now), true)
  assert.equal(dg.isDigestDue({ ...on, enabled: false }, now), false)
})

test('saved searches are run, new High-fit jobs are announced once, and nothing is prepared or submitted', async () => {
  const user = 'digest-user'
  await setupUser(user, {
    savedSearches: [
      { id: 'a', name: 'Frontend remote', titles: ['frontend'], locations: ['Remote'], remote: 'remote', companies: [], enabled: true },
      { id: 'b', name: 'Paused', titles: ['backend'], locations: [], remote: 'any', companies: [], enabled: false },
    ],
    digest: { enabled: true, intervalHours: 24, minScore: 75 },
  })
  searched.length = 0
  sources.clearSourceCache()
  const first = await dg.runDigest(user, { generate: fakeAi })
  assert.equal(first.ran, true)
  assert.equal(first.searches, 1)
  assert.deepEqual(searched, ['frontend'], 'only the enabled saved search runs; the main search is not used')
  // Only the 90-scoring Senior role clears the digest minimum of 75
  assert.deepEqual(first.newJobs.map(j => [j.title, j.score, j.search]), [['Senior Frontend Engineer', 90, 'Frontend remote']])
  assert.equal(first.notification, 'unavailable', 'no push subscription in tests: still recorded in the app')
  const jobs = await jh.listJobs(user)
  assert.ok(jobs.length >= 2)
  assert.ok(jobs.every(j => j.status === 'found' && !j.tailoredResume), 'the digest never prepares or applies')
  const p = await jh.getProfile(user)
  assert.equal(p.digest.lastDigest.jobs.length, 1)
  assert.match(p.digest.lastResult, /1 new High-fit job/)
  assert.equal(p.autopilot.enabled, false)

  // A second run finds the same jobs: nothing new to announce, and the last digest stays visible
  const second = await dg.runDigest(user, { force: true, generate: fakeAi })
  assert.equal(second.ran, true)
  assert.equal(second.newJobs.length, 0)
  assert.equal(second.notification, 'none')
  const after = await jh.getProfile(user)
  assert.match(after.digest.lastResult, /no new High-fit jobs/)
  assert.equal(after.digest.lastDigest.jobs[0].title, 'Senior Frontend Engineer')
})

test('without saved searches the digest uses the main search, and dismissed or already-applied jobs are never announced', async () => {
  const user = 'digest-main'
  await setupUser(user, { digest: { enabled: true, minScore: 50 } })
  await jh.saveProfile(user, { preferences: { titles: ['frontend'] } })
  sources.clearSourceCache()
  await jh.runSearch(user, { generate: fakeAi, autoPrepare: 0 })
  const [one, two] = await jh.listJobs(user)
  await jh.updateJob(user, one.id, { status: 'dismissed' })
  await jh.updateJob(user, two.id, { status: 'submitted' })
  const r = await dg.runDigest(user, { generate: fakeAi })
  assert.equal(r.ran, true)
  assert.equal(r.searches, 1)
  const ids = r.newJobs.map(j => j.id)
  assert.ok(ids.length > 0)
  assert.ok(!ids.includes(one.id) && !ids.includes(two.id))
  assert.equal(dg.digestWorthy({ ...one, status: 'found', fit: 'High', score: 90, verification: { status: 'flagged', flags: [] } }, 50), false, 'possible scams are never announced')
  assert.equal(dg.digestWorthy({ ...one, status: 'found', fit: 'High', score: 90, verification: { status: 'closed', flags: [] } }, 50), false)
  assert.equal(dg.digestWorthy({ ...one, status: 'found', fit: 'Medium', score: 90 }, 50), false)
})

test('a digest without a CV or any search records why and is not retried every tick', async () => {
  const user = 'digest-empty'
  await jh.saveProfile(user, { digest: { enabled: true } })
  const now = Date.parse('2026-10-08T12:00:00Z')
  const r = await dg.runDigest(user, { now, generate: fakeAi })
  assert.equal(r.ran, false)
  assert.match(r.reason, /CV/)
  const p = await jh.getProfile(user)
  assert.equal(dg.isDigestDue(p.digest, now + 60_000), false)
})

test('saved searches from the API are bounded and cleaned', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ titles: [`role ${i}`] }))
  assert.equal(dg.cleanSavedSearches(many).length, 10)
  const [s, t] = dg.cleanSavedSearches([
    { id: 'x', name: '', titles: 'Frontend, React', locations: ['Berlin'], remote: 'nope', companies: ['ashby:openai', 'bogus:acme', '../etc', 'stripe'], enabled: false },
    { id: 'x', titles: ['Backend'] },
    { titles: [] },
    'junk',
  ])
  assert.deepEqual(s.titles, ['Frontend', 'React'])
  assert.equal(s.name, 'Frontend, React')
  assert.equal(s.remote, 'any')
  assert.deepEqual(s.companies, ['ashby:openai', 'stripe'])
  assert.equal(s.enabled, false)
  assert.notEqual(t.id, s.id, 'ids stay unique')
  assert.equal(t.enabled, true)
  assert.equal(dg.cleanSavedSearches(undefined).length, 0)
})
