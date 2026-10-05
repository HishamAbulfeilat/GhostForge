// Job Hunter "real jobs only": the new public sources, cross-source de-duplication,
// the stale/invalid/scam screen, and the lazy live check of a posting.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-verify-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'
for (const k of ['JSEARCH_API_KEY', 'RAPIDAPI_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'ADZUNA_COUNTRY', 'USAJOBS_API_KEY', 'USAJOBS_EMAIL', 'REED_API_KEY']) delete process.env[k]

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

const sources = require('../lib/job-hunter/sources.ts')
const verify = require('../lib/job-hunter/verify.ts')
const store = require('../lib/job-hunter/store.ts')

const DAY = 86_400_000
const NOW = Date.parse('2026-10-05T12:00:00Z')
const iso = daysAgo => new Date(NOW - daysAgo * DAY).toISOString()

const realFetch = globalThis.fetch
test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 300))
  globalThis.fetch = realFetch
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const listing = (over = {}) => ({
  key: 'k', source: 'Remotive', title: 'Frontend Engineer', company: 'Acme', location: 'Remote', remote: true, salary: '',
  url: 'https://remotive.com/jobs/1', applyUrl: 'https://remotive.com/jobs/1', ats: 'other',
  description: 'Build React apps with TypeScript.', postedAt: iso(3), trust: 'board', ...over,
})

// ── screening ────────────────────────────────────────────────────────────────

test('stale postings are dropped (30 days by default, configurable); undated ones are kept', () => {
  assert.equal(verify.screenListing(listing({ postedAt: iso(40) }), { now: NOW }).drop, 'stale')
  assert.equal(verify.screenListing(listing({ postedAt: iso(40) }), { now: NOW, maxAgeDays: 60 }).drop, null)
  assert.equal(verify.screenListing(listing({ postedAt: iso(10) }), { now: NOW, maxAgeDays: 7 }).drop, 'stale')
  assert.equal(verify.screenListing(listing({ postedAt: '' }), { now: NOW }).drop, null)
  assert.equal(verify.screenListing(listing({ postedAt: 'not a date' }), { now: NOW }).drop, null)
})

test('listings without a usable public apply link are dropped', () => {
  for (const url of ['', 'javascript:alert(1)', 'http://localhost:3000/x', 'http://192.168.1.10/apply', 'mailto:hr@acme.com']) {
    assert.equal(verify.screenListing(listing({ url, applyUrl: url }), { now: NOW }).drop, 'invalid', url)
  }
  assert.equal(verify.screenListing(listing({ company: ' ' }), { now: NOW }).drop, 'invalid')
})

test('scam signals: strong evidence drops, some evidence flags, disclaimers do not count', () => {
  const screen = description => verify.screenListing(listing({ description }), { now: NOW })

  const scam = screen('No experience needed! Earn $5,000 per week. Pay a small registration fee and contact us on Telegram @hiring_now.')
  assert.equal(scam.drop, 'scam')

  const fee = screen('Great role. Successful candidates pay a training fee of $200 before starting.')
  assert.equal(fee.drop, null)
  assert.equal(fee.verification.status, 'flagged')
  assert.match(fee.verification.flags.join(), /money/)

  assert.equal(screen('Interviews will be conducted via WhatsApp.').verification.status, 'flagged')
  assert.equal(screen('Salary paid in USDT every Friday.').verification.status, 'flagged')

  // Anti-scam disclaimers and ordinary mentions of the apps are not signals
  assert.equal(screen('We will never ask you to pay an application fee. Beware of scams.').verification.status, 'unverified')
  assert.equal(screen('You will build our WhatsApp Business API and Telegram bot integrations.').verification.status, 'unverified')
  assert.equal(screen('We cover relocation and visa fees.').verification.status, 'unverified')
})

test('salary sanity is currency-aware', () => {
  assert.equal(verify.screenListing(listing({ salary: '$2500k-$3000k' }), { now: NOW }).verification.status, 'flagged')
  assert.equal(verify.screenListing(listing({ salary: 'JPY 8000000-12000000' }), { now: NOW }).verification.status, 'unverified')
  assert.equal(verify.screenListing(listing({ salary: '$120k-$150k' }), { now: NOW }).verification.status, 'unverified')
})

test('weak signals are noted but do not flag on their own; chat-app apply links do', () => {
  const gmail = verify.screenListing(listing({ description: 'Send your CV to acme.jobs@gmail.com' }), { now: NOW })
  assert.equal(gmail.verification.status, 'unverified')
  assert.match(gmail.verification.flags.join(), /personal email/)

  const board = verify.screenListing(listing({ company: 'Google', applyUrl: 'https://jobs.lever.co/randomco/0b0c0d0e-0000-4000-8000-000000000000', ats: 'lever' }), { now: NOW })
  assert.match(board.verification.flags.join(), /"randomco"'s job board, not Google's/)
  assert.equal(verify.boardMatchesCompany('acme', 'Acme Corp'), true)
  assert.equal(verify.boardMatchesCompany('acmecorp', 'ACME Corporation'), true)
  assert.equal(verify.boardMatchesCompany('randomco', 'Google'), false)

  const chat = verify.screenListing(listing({ applyUrl: 'https://t.me/hiring_bot' }), { now: NOW })
  assert.equal(chat.verification.status, 'flagged')
  const unnamed = verify.screenListing(listing({ company: 'Confidential', applyUrl: 'https://bit.ly/x' }), { now: NOW })
  assert.equal(unnamed.verification.status, 'flagged', 'two weak signals together')
})

test('listings from a company\'s own ATS API are verified at once', () => {
  const s = verify.screenListing(listing({ trust: 'official', ats: 'greenhouse', applyUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1' }), { now: NOW })
  assert.equal(s.verification.status, 'verified')
  assert.ok(s.verification.checkedAt)
})

test('screenListings reports what was removed', () => {
  const { kept, dropped } = verify.screenListings([
    listing(), listing({ postedAt: iso(90) }), listing({ applyUrl: 'ftp://x', url: '' }),
    listing({ description: 'Earn $3,000 per day, no experience required. Pay the onboarding fee via bitcoin.' }),
    listing({ description: 'Pay a $50 application fee.' }),
  ], { now: NOW })
  assert.equal(kept.length, 2)
  assert.deepEqual(dropped, { stale: 1, invalid: 1, scam: 1, flagged: 1 })
})

// ── de-duplication ───────────────────────────────────────────────────────────

test('one job listed on several boards is kept once, preferring the company\'s own ATS', () => {
  const jobs = sources.dedupeListings([
    listing({ source: 'Remotive', company: 'Acme Inc.', title: 'Sr. Frontend Engineer', location: 'Remote' }),
    listing({ source: 'Greenhouse (acme)', company: 'ACME', title: 'Senior Frontend Engineer', location: 'Remote - Worldwide', trust: 'official' }),
    listing({ source: 'HN Who is hiring', company: 'Acme', title: 'Senior Frontend Engineer', location: '', trust: 'community' }),
    listing({ source: 'Remotive', company: 'Acme', title: 'Backend Engineer' }),
  ])
  assert.equal(jobs.length, 2)
  assert.equal(jobs.find(j => /frontend/i.test(j.title)).source, 'Greenhouse (acme)')
  assert.equal(store.dedupeKey({ company: 'Beta GmbH', title: 'Jr Developer', location: 'Berlin, Germany' }), store.dedupeKey({ company: 'beta', title: 'Junior Developer', location: 'Berlin, Germany (Hybrid)' }))
})

test('regression: different cities sharing a first word are different jobs', () => {
  const key = location => store.dedupeKey({ company: 'Acme', title: 'Engineer', location })
  assert.notEqual(key('New York, NY'), key('New Delhi, India'))
  assert.notEqual(key('San Francisco, CA'), key('San Jose, CA'))
  assert.equal(sources.dedupeListings([listing({ location: 'New York, NY' }), listing({ location: 'New Delhi, India' })]).length, 2)
})

test('the same job from another board is not added twice to a user\'s list', async () => {
  const user = 'dupes'
  const a = await store.upsertJobs(user, [{ ...listing({ key: 'remotive|1' }), fit: 'High', score: 90, reasons: '' }])
  assert.equal(a.added, 1)
  const b = await store.upsertJobs(user, [{ ...listing({ key: 'arbeitnow|1', source: 'Arbeitnow', company: 'Acme Inc' }), fit: 'High', score: 90, reasons: '' }])
  assert.equal(b.added, 0)
  assert.equal((await store.listJobs(user)).length, 1)
  // Two postings from the SAME source are distinct jobs, even if they look alike
  const c = await store.upsertJobs(user, [{ ...listing({ key: 'remotive|2' }), fit: 'High', score: 90, reasons: '' }])
  assert.equal(c.added, 1)
})

// ── live check ───────────────────────────────────────────────────────────────

const fetcherFor = map => {
  const calls = []
  const fn = async url => {
    calls.push(url)
    const hit = Object.entries(map).find(([k]) => url.startsWith(k))
    if (!hit) throw new Error('offline')
    return { url, body: '', ...hit[1] }
  }
  fn.calls = calls
  return fn
}

test('live check: 404/410 and "no longer accepting" are closed; bot walls are unknown', async () => {
  const job = { url: 'https://careers.acme.com/jobs/1', applyUrl: 'https://careers.acme.com/jobs/1', ats: 'other' }
  assert.equal((await verify.checkLive(job, fetcherFor({ 'https://careers.acme.com': { status: 404 } }))).live, 'gone')
  assert.equal((await verify.checkLive(job, fetcherFor({ 'https://careers.acme.com': { status: 410 } }))).live, 'gone')
  assert.equal((await verify.checkLive(job, fetcherFor({ 'https://careers.acme.com': { status: 200, body: '<h1>This job is no longer accepting applications</h1>' } }))).live, 'gone')
  assert.equal((await verify.checkLive(job, fetcherFor({ 'https://careers.acme.com': { status: 200, body: '<h1>Engineer</h1><script>var t="job not found"</script>' } }))).live, 'live', 'script text ignored')
  assert.equal((await verify.checkLive(job, fetcherFor({ 'https://careers.acme.com': { status: 403 } }))).live, 'unknown')
  assert.equal((await verify.checkLive(job, fetcherFor({}))).live, 'unknown', 'network errors are inconclusive')
  // Without an injected fetcher, tests never touch the network
  assert.equal((await verify.checkLive(job)).live, 'unknown')
})

test('live check uses Greenhouse and Lever public APIs, and never fetches LinkedIn', async () => {
  const gh = fetcherFor({ 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/42': { status: 404 } })
  assert.equal((await verify.checkLive({ ats: 'greenhouse', url: 'https://boards.greenhouse.io/acme/jobs/42', applyUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=42' }, gh)).live, 'gone')
  assert.deepEqual(gh.calls, ['https://boards-api.greenhouse.io/v1/boards/acme/jobs/42'])

  const id = '0b0c0d0e-0000-4000-8000-000000000000'
  const lever = fetcherFor({ 'https://api.lever.co/v0/postings/acme/': { status: 200, body: '{"text":"Engineer"}' } })
  assert.equal((await verify.checkLive({ ats: 'lever', url: `https://jobs.lever.co/acme/${id}`, applyUrl: `https://jobs.lever.co/acme/${id}/apply` }, lever)).live, 'live')
  assert.deepEqual(lever.calls, [`https://api.lever.co/v0/postings/acme/${id}`])

  const redirected = async () => ({ status: 200, body: '<h1>Acme jobs</h1>', url: 'https://careers.acme.com/jobs?error=true' })
  assert.equal((await verify.checkLive({ ats: 'other', url: 'https://careers.acme.com/jobs/9', applyUrl: '' }, redirected)).live, 'gone')

  const li = fetcherFor({})
  assert.equal((await verify.checkLive({ ats: 'linkedin', url: 'https://www.linkedin.com/jobs/view/1', applyUrl: '' }, li)).live, 'unknown')
  assert.equal(li.calls.length, 0)
})

test('a live-check result updates the verification status', () => {
  const unknown = { live: 'unknown', note: 'the site answered 403' }
  assert.equal(verify.withLiveResult({ ats: 'other', trust: 'board' }, unknown).status, 'unverified')
  assert.equal(verify.withLiveResult({ ats: 'workday', trust: 'board' }, unknown).status, 'verified', 'known ATS: the form agent sees the page')
  assert.equal(verify.withLiveResult({ ats: 'other', trust: 'board' }, { live: 'live', note: 'ok' }).status, 'verified')
  assert.equal(verify.withLiveResult({ ats: 'other', verification: { status: 'flagged', flags: ['fee'] } }, { live: 'live', note: 'ok' }).status, 'flagged', 'a live scam is still a scam')
  assert.equal(verify.withLiveResult({ ats: 'lever', verification: { status: 'verified', flags: [] } }, { live: 'gone', note: '404' }).status, 'closed')
})

test('ensureVerified checks a job at most once a day and records the result', async () => {
  const user = 'live'
  await store.upsertJobs(user, [{ ...listing({ key: 'live|1', url: 'https://careers.acme.com/1', applyUrl: 'https://careers.acme.com/1' }), fit: 'High', score: 90, reasons: '' }])
  const [job] = await store.listJobs(user)
  const f = fetcherFor({ 'https://careers.acme.com': { status: 200, body: '<h1>Engineer</h1>' } })
  const first = await verify.ensureVerified(user, job.id, { fetcher: f, now: NOW })
  assert.equal(first.verification.status, 'verified')
  await verify.ensureVerified(user, job.id, { fetcher: f, now: NOW + 3_600_000 })
  assert.equal(f.calls.length, 1, 'cached for a day')
  const gone = fetcherFor({ 'https://careers.acme.com': { status: 404 } })
  const later = await verify.ensureVerified(user, job.id, { fetcher: gone, now: NOW + 2 * DAY })
  assert.equal(later.verification.status, 'closed')
  assert.match(later.log.at(-1).msg, /closed/)
})

// ── sources ──────────────────────────────────────────────────────────────────

test('company entries: plain slugs probe every ATS; "ats:slug" pins one', () => {
  assert.deepEqual(sources.parseCompany('ashby:OpenAI').map(c => [c.ats, c.slug, c.pinned]), [['ashby', 'openai', true]])
  assert.equal(sources.parseCompany('stripe').length, sources.BOARD_ATS.length)
  assert.deepEqual(sources.parseCompany('nope:acme'), [])
  assert.deepEqual(sources.parseCompany('../etc'), [])
})

test('RSS and HN "Who is hiring" comments parse into listings', () => {
  const items = sources.parseRss(`<rss><channel><item><title><![CDATA[Acme: Senior Rust Engineer]]></title><region>Anywhere in the World</region>
    <link>https://weworkremotely.com/remote-jobs/acme-rust</link><pubDate>Mon, 28 Sep 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>Rust</p>]]></description></item></channel></rss>`)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Acme: Senior Rust Engineer')
  assert.equal(items[0].region, 'Anywhere in the World')

  const hn = sources.parseHnComment({
    objectID: '123', created_at: iso(2),
    comment_text: 'Acme Robotics | Senior Frontend Engineer | Berlin or REMOTE (EU) | Full-time | <a href="https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;1">https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;1</a><p>We build robots.',
  }, 'frontend')
  assert.equal(hn.company, 'Acme Robotics')
  assert.equal(hn.title, 'Senior Frontend Engineer')
  assert.equal(hn.remote, true)
  assert.equal(hn.applyUrl, 'https://jobs.lever.co/acme/1')
  assert.equal(hn.ats, 'lever')
  assert.equal(hn.trust, 'community')
  assert.equal(sources.parseHnComment({ objectID: '1', comment_text: 'Just a reply to someone' }, 'frontend'), null)
})

test('detectAts knows the common ATS hosts', () => {
  const cases = {
    'https://apply.workable.com/acme/j/ABC123/': 'workable',
    'https://jobs.smartrecruiters.com/Acme/123-engineer': 'smartrecruiters',
    'https://acme.recruitee.com/o/engineer': 'recruitee',
    'https://careers-acme.icims.com/jobs/1/job': 'icims',
    'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=1': 'taleo',
    'https://acme.bamboohr.com/careers/12': 'bamboohr',
    'https://acme.teamtailor.com/jobs/1-engineer': 'teamtailor',
    'https://workable.com.evil.example/x': 'other',
  }
  for (const [url, ats] of Object.entries(cases)) assert.equal(sources.detectAts(url), ats, url)
})

test('searchSources reads the new boards, probes company ATSes quietly and only calls keyed APIs with a key', async () => {
  sources.clearSourceCache()
  const seen = []
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async url => {
    const u = new URL(String(url))
    seen.push(u.hostname + u.pathname)
    switch (u.hostname) {
      case 'remotive.com': return json({ jobs: [] })
      case 'remoteok.com': return json([{ legal: 'notice' }])
      case 'jobicy.com': return json({ jobs: [{ url: 'https://jobicy.com/jobs/1', jobTitle: 'Frontend Developer', companyName: 'Jobi', jobGeo: 'Anywhere', jobDescription: 'React', pubDate: '2026-10-01 10:00:00', annualSalaryMin: 90000, annualSalaryMax: 120000, salaryCurrency: 'USD' }] })
      case 'himalayas.app': return json({ jobs: [{ title: 'Frontend Engineer', companyName: 'Hima', locationRestrictions: ['Germany'], pubDate: Math.floor(NOW / 1000), applicationLink: 'https://hima.example/apply', guid: 'https://himalayas.app/companies/hima/jobs/1', description: 'React' }] })
      case 'weworkremotely.com': return new Response('<rss><item><title>WWR Co: Frontend Engineer</title><link>https://weworkremotely.com/remote-jobs/1</link><region>Anywhere</region><pubDate>Thu, 01 Oct 2026 00:00:00 +0000</pubDate><description>React</description></item></rss>', { status: 200 })
      case 'hn.algolia.com':
        return u.pathname.endsWith('search_by_date')
          ? json({ hits: [{ objectID: '900', title: 'Ask HN: Who is hiring? (October 2026)' }] })
          : json({ hits: [{ objectID: '901', parent_id: 900, created_at: iso(1), comment_text: 'HNCo | Frontend Engineer | REMOTE | https://hnco.example/jobs' }] })
      case 'api.ashbyhq.com': return json({ jobs: [{ id: 'a1', title: 'Frontend Engineer', location: 'Remote', isRemote: true, jobUrl: 'https://jobs.ashbyhq.com/acme/a1', applyUrl: 'https://jobs.ashbyhq.com/acme/a1/application', descriptionPlain: 'React', publishedAt: iso(2) }] })
      default: return new Response('not found', { status: 404 })
    }
  }
  try {
    const prefs = { titles: ['frontend'], locations: ['Remote'], remote: 'remote', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: ['acme', 'workable:ghost'] }
    const { jobs, report } = await sources.searchSources(prefs, ['frontend'])
    const bySource = Object.fromEntries(jobs.map(j => [j.source, j]))
    for (const s of ['Jobicy', 'Himalayas', 'We Work Remotely', 'HN Who is hiring', 'Ashby (acme)']) assert.ok(bySource[s], `${s} listing`)
    // Matched by a plain name: could be another company with the same board name
    assert.equal(bySource['Ashby (acme)'].trust, 'board')
    assert.equal(bySource['Ashby (acme)'].boardUnconfirmed, true)
    assert.match(report.find(r => r.source === 'Ashby acme').note, /"ashby:acme"/)
    assert.equal(bySource['We Work Remotely'].company, 'WWR Co')
    assert.equal(bySource.Jobicy.salary, 'USD 90000-120000')
    // "acme" was probed on every ATS; only Ashby answered, and the misses are not errors
    assert.ok(seen.some(s => s.startsWith('api.lever.co/v0/postings/acme')))
    assert.ok(!report.some(r => /Lever acme|Greenhouse acme/.test(r.source)))
    // A pinned board that fails is reported (404s are expected misses and stay quiet)
    assert.ok(!report.some(r => r.error && /Workable ghost/.test(r.source)))
    assert.ok(!seen.some(s => /adzuna|usajobs|reed\.co\.uk|jsearch/.test(s)), 'no keyed source without a key')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('keyed sources: Adzuna picks its country from your location and is called only with both keys', async () => {
  // Per location; no silent fallback to the UK
  assert.equal(sources.adzunaCountry('Berlin, Germany'), 'de')
  assert.equal(sources.adzunaCountry('Austin, United States'), 'us')
  assert.equal(sources.adzunaCountry('Tokyo'), null)
  process.env.ADZUNA_COUNTRY = 'GB'
  assert.equal(sources.adzunaCountry('Berlin, Germany'), 'de', 'the location wins')
  assert.equal(sources.adzunaCountry('Tokyo'), 'gb', 'a configured default is used only when set')
  delete process.env.ADZUNA_COUNTRY

  sources.clearSourceCache()
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    if (String(url).includes('api.adzuna.com')) {
      return new Response(JSON.stringify({ results: [{ title: 'Frontend Engineer', company: { display_name: 'Adz' }, location: { display_name: 'Berlin' }, redirect_url: 'https://www.adzuna.de/land/ad/1', description: 'React', created: iso(1) }] }), { status: 200 })
    }
    return new Response('[]', { status: 404 })
  }
  process.env.ADZUNA_APP_ID = 'test-id'
  process.env.ADZUNA_APP_KEY = 'test-key'
  try {
    assert.equal(sources.keyedSources().adzuna, true)
    const prefs = { titles: ['frontend'], locations: ['Berlin, Germany', 'Austin, United States', 'Tokyo'], remote: 'any', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] }
    const { jobs, report } = await sources.searchSources(prefs, ['frontend'])
    const adz = urls.filter(u => u.includes('api.adzuna.com'))
    assert.ok(adz.some(u => u.startsWith('https://api.adzuna.com/v1/api/jobs/de/search/1?') && u.includes('where=Berlin')))
    assert.ok(adz.some(u => u.startsWith('https://api.adzuna.com/v1/api/jobs/us/search/1?') && u.includes('where=Austin')))
    assert.ok(!adz.some(u => u.includes('where=Tokyo')), 'no country for Tokyo: skipped, not sent to the UK')
    assert.ok(jobs.some(j => j.source === 'Adzuna' && j.company === 'Adz'))
    assert.ok(!JSON.stringify(report).includes('test-key'), 'keys never appear in the report')
  } finally {
    delete process.env.ADZUNA_APP_ID
    delete process.env.ADZUNA_APP_KEY
    globalThis.fetch = realFetch
  }
})

// ── review regressions ───────────────────────────────────────────────────────

test('regression: a pinned board is official; unconfirmed boards are not, and probe outages are shown', async () => {
  sources.clearSourceCache()
  const json = body => new Response(JSON.stringify(body), { status: 200 })
  globalThis.fetch = async url => {
    const u = new URL(String(url))
    if (u.hostname === 'api.ashbyhq.com') return json({ jobs: [{ id: 'a1', title: 'Frontend Engineer', location: 'Remote', isRemote: true, jobUrl: 'https://jobs.ashbyhq.com/acme/a1', descriptionPlain: 'React', publishedAt: iso(400) }] })
    if (u.hostname === 'api.lever.co') return new Response('busy', { status: 503 })
    return new Response('[]', { status: 404 })
  }
  try {
    const prefs = { titles: ['frontend'], locations: ['Remote'], remote: 'remote', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: ['ashby:acme', 'globex'] }
    const { jobs, report } = await sources.searchSources(prefs, ['frontend'])
    const pinned = jobs.find(j => j.source === 'Ashby (acme)')
    assert.equal(pinned.trust, 'official')
    assert.ok(!pinned.boardUnconfirmed)
    assert.ok(report.some(r => r.source === 'Lever globex' && /503/.test(r.error)), 'a probe outage (not a 404) is surfaced')
    // Evergreen: a 400-day-old posting read from the company's ATS API is not dropped as stale
    assert.equal(verify.screenListing(pinned, { now: NOW }).drop, null)
    assert.equal(verify.screenListing({ ...pinned, trust: 'board', boardUnconfirmed: true }, { now: NOW }).drop, null)
    assert.equal(verify.screenListing({ ...pinned, trust: 'board', fromBoardApi: false }, { now: NOW }).drop, 'stale')
    assert.equal(verify.screenListing({ ...pinned, trust: 'board', boardUnconfirmed: true }, { now: NOW }).verification.status, 'unverified')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('regression: "k" is thousands only as a standalone suffix; non-major currencies are not judged', () => {
  assert.equal(verify.salaryTop('600000 kr'), 600000)
  assert.equal(verify.salaryTop('90000 Kč'), 90000)
  assert.equal(verify.salaryTop('60000 KES'), 60000)
  assert.equal(verify.salaryTop('$120k-$150k'), 150000)
  assert.equal(verify.salaryTop('80K EUR'), 80000)
  for (const salary of ['600000 kr', '90000 Kč', '60000 KES', '1500000 SEK', 'INR 2500000', 'JPY 8000000']) {
    assert.equal(verify.screenListing(listing({ salary }), { now: NOW }).verification.status, 'unverified', salary)
  }
  for (const salary of ['$2,500,000', 'EUR 3000000', '2500000']) {
    assert.equal(verify.screenListing(listing({ salary }), { now: NOW }).verification.status, 'flagged', salary)
  }
  const match = require('../lib/job-hunter/match.ts')
  const prefs = { dealbreakers: [], minSalary: 500000 }
  assert.equal(match.dealbreaker({ title: 'x', company: 'y', description: '', salary: '600000 kr' }, prefs), null, '"kr" is not ×1000 in the salary floor either')
})

test('regression: description wording does not mark a posting closed; ATS APIs are structured', async () => {
  const page = body => async url => ({ status: 200, url, body })
  const job = { url: 'https://careers.acme.com/jobs/1', applyUrl: '', ats: 'other' }
  const desc = '<html><head><title>Frontend Engineer at Acme</title></head><body><h1>Frontend Engineer</h1>' + '<p>Lorem ipsum. '.repeat(60) + 'This role is not available for visa sponsorship. Applications are closed on public holidays. The position is closed to agencies.</p></body></html>'
  assert.equal((await verify.checkLive(job, page(desc))).live, 'live')
  assert.equal((await verify.checkLive(job, page('<h1>This job is no longer available</h1><p>See other roles</p>'))).live, 'gone')
  // Greenhouse API answered: the posting exists, whatever its description says
  const gh = { ats: 'greenhouse', url: 'https://boards.greenhouse.io/acme/jobs/42', applyUrl: '' }
  assert.equal((await verify.checkLive(gh, page('{"content":"This position is closed to candidates needing sponsorship. No longer accepting applications from agencies."}'))).live, 'live')
})

test('regression: a "closed" reading is re-checked after a day', async () => {
  const user = 'reopen'
  await store.upsertJobs(user, [{ ...listing({ key: 'reopen|1', url: 'https://careers.acme.com/9', applyUrl: 'https://careers.acme.com/9' }), fit: 'High', score: 90, reasons: '' }])
  const [job] = await store.listJobs(user)
  const closed = await verify.ensureVerified(user, job.id, { fetcher: async url => ({ status: 404, body: '', url }), now: NOW })
  assert.equal(closed.verification.status, 'closed')
  const live = async url => ({ status: 200, body: '<h1>Engineer</h1>', url })
  assert.equal((await verify.ensureVerified(user, job.id, { fetcher: live, now: NOW + 3_600_000 })).verification.status, 'closed', 'held for a day')
  assert.equal((await verify.ensureVerified(user, job.id, { fetcher: live, now: NOW + 2 * DAY })).verification.status, 'verified', 'then checked again')
})

test('regression: claimJob is a compare-and-set, so only one approval starts', async () => {
  const user = 'claim'
  await store.upsertJobs(user, [{ ...listing({ key: 'claim|1' }), fit: 'High', score: 90, reasons: '' }])
  const [job] = await store.listJobs(user)
  await store.updateJob(user, job.id, { status: 'ready' })
  const results = await Promise.all([1, 2, 3].map(() => store.claimJob(user, job.id, ['ready', 'needs_user', 'failed'], { status: 'submitting' })))
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal((await store.getJob(user, job.id)).status, 'submitting')
})
