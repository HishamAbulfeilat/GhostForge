const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')
const { EventEmitter } = require('node:events')

const home = mkdtempSync(join(tmpdir(), 'gf-job-browser-'))
process.env.HOME = home
process.env.USERPROFILE = home
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
// The application URL guard resolves hostnames; keep the test off real DNS.
const dns = require('node:dns/promises')
const realLookup = dns.lookup
dns.lookup = async (host, opts) => host === 'example.com' ? (opts?.all ? [{ address: '93.184.215.14', family: 4 }] : { address: '93.184.215.14', family: 4 }) : realLookup(host, opts)
Module.syncBuiltinESMExports()
const apply = require('../lib/job-hunter/apply.ts')
const store = require('../lib/job-hunter/store.ts')
const live = require('../lib/job-hunter/live.ts')
test.after(() => {
  dns.lookup = realLookup
  Module.syncBuiltinESMExports()
  hooks.deregister()
  rmSync(home, { recursive: true, force: true })
})

test('application destinations preserve query/hash and fall back to the posting URL', () => {
  assert.equal(apply.formUrl({ ats: 'lever', applyUrl: 'https://jobs.lever.co/acme/id?source=board#details', url: '' }), 'https://jobs.lever.co/acme/id/apply?source=board#details')
  assert.equal(apply.formUrl({ ats: 'lever', applyUrl: '', url: 'https://jobs.lever.co/acme/id/apply?source=board' }), 'https://jobs.lever.co/acme/id/apply?source=board')
  assert.equal(apply.formUrl({ ats: 'ashby', applyUrl: '', url: 'https://jobs.ashbyhq.com/acme/id?source=board' }), 'https://jobs.ashbyhq.com/acme/id/application?source=board')
  assert.equal(apply.formUrl({ ats: 'lever', applyUrl: 'https://example.com/redirect?next=lever', url: '' }), 'https://example.com/redirect?next=lever')
  assert.throws(() => apply.formUrl({ ats: 'other', applyUrl: '', url: '' }))
})

test('an occupied browser profile reports the real cause and never tries another browser on it', async t => {
  let launches = 0
  t.mock.method(chromium, 'launchPersistentContext', async () => {
    launches++
    throw new Error('browserType.launchPersistentContext: Opening in existing browser session.')
  })
  await assert.rejects(apply.launchProfile('occupied', false), /profile is already open.*Close that Job Hunter window/)
  assert.equal(launches, 1)
})

test('approve navigation uses the job URL and waits for profile shutdown before the next application', async t => {
  const visited = []
  let closing = false
  let closed = 0
  t.mock.method(chromium, 'launchPersistentContext', async () => {
    assert.equal(closing, false, 'a new launch must not race the old profile shutdown')
    return {
      pages: () => [Object.assign(new EventEmitter(), {
        url: () => 'about:blank',
        goto: async url => { visited.push(url); throw new Error('Synthetic navigation failure') },
      })],
      close: async () => {
        closing = true
        await new Promise(resolve => setTimeout(resolve, 100))
        closed++
        closing = false
      },
    }
  })
  const profile = await store.getProfile('close-race')
  const job = { id: 'test', ats: 'other', applyUrl: '', url: 'https://example.com/careers/frontend?ref=jobs' }
  const results = await Promise.all([
    apply.applyToJob(job, profile, 'close-race', { headless: true }),
    apply.applyToJob(job, profile, 'close-race', { headless: true }),
  ])
  assert.ok(results.every(result => result.status === 'failed'))
  assert.deepEqual(visited, [job.url, job.url])
  assert.equal(closed, 2)
})

test('a real persistent browser reaches the application and reuses a retained window in new tabs', async t => {
  const launch = chromium.launchPersistentContext.bind(chromium)
  let launches = 0
  let browser
  t.mock.method(chromium, 'launchPersistentContext', async (dir, options) => {
    launches++
    browser = await launch(dir, { ...options, channel: undefined, executablePath: chromium.executablePath(), headless: true })
    await browser.route('https://example.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: route.request().url().includes('/popup')
        ? '<h1>Job</h1><a target="_blank" href="https://example.com/login">Apply now</a>'
        : route.request().url().includes('/login')
        ? '<h1>Sign in</h1><input type="password" value="test-secret"><button>Sign in</button>'
        : '<h1>Application</h1><div id="captcha">Complete captcha to continue</div>',
    }))
    // Restore extra tabs left by a previous browser session.
    await browser.newPage()
    await browser.newPage()
    return browser
  })
  const profile = await store.getProfile('retained')
  const job = { id: 'test', title: 'Frontend', company: 'Example', ats: 'other', applyUrl: 'https://example.com/application?job=1', url: '' }
  try {
    const first = await apply.applyToJob(job, profile, 'retained', { headless: false, allowSubmit: false })
    assert.equal(first.status, 'needs_user')
    const activity = await live.applicationPreview('retained', job.id, false)
    assert.equal(activity.activity.phase, 'captcha')
    assert.equal(activity.available, true)
    assert.equal(activity.image, null, 'status-only requests do not capture screenshots')
    assert.equal(activity.origin, 'https://example.com')
    const preview = await live.applicationPreview('retained', job.id, true)
    assert.match(preview.image, /^data:image\/jpeg;base64,/)
    assert.equal((await live.applicationPreview('different-user', job.id, true)).available, false)
    assert.equal(browser.pages()[0].url(), job.applyUrl)
    assert.equal(browser.pages().length, 1, 'startup blank tabs are closed only after the application loads')
    const second = await apply.applyToJob({ ...job, applyUrl: 'https://example.com/application?job=2' }, profile, 'retained', { headless: false, allowSubmit: false })
    assert.equal(second.status, 'needs_user')
    assert.equal(launches, 1)
    assert.deepEqual(browser.pages().map(page => page.url()), [job.applyUrl, 'https://example.com/application?job=2'])
    const loginJob = { ...job, id: 'login-job', applyUrl: 'https://example.com/popup' }
    const login = await apply.applyToJob(loginJob, profile, 'retained', { headless: false, allowSubmit: false })
    assert.equal(login.status, 'needs_user')
    const loginPreview = await live.applicationPreview('retained', loginJob.id, false)
    assert.equal(loginPreview.activity.phase, 'login')
    assert.equal(browser.pages()[3].url(), 'https://example.com/login', 'application preview follows its login popup')
    assert.equal(browser.pages()[2].listenerCount('popup'), 0, 'operation cleans up its popup listeners')
    const capture = browser.pages()[3].screenshot.bind(browser.pages()[3])
    let maskSelector = ''
    t.mock.method(browser.pages()[3], 'screenshot', async options => {
      maskSelector = options.mask[0].toString()
      return capture(options)
    })
    await live.applicationPreview('retained', loginJob.id, true)
    assert.match(maskSelector, /input, textarea/)
    assert.match(maskSelector, /select/)
    assert.match(maskSelector, /contenteditable.*false/)
    await apply.withProfile('retained', true, async context => {
      const page = await context.newPage()
      await page.goto('https://example.com/check')
    })
    assert.equal(browser.pages().length, 4, 'temporary operations must not close retained application tabs')
  } finally { await browser?.close() }
  assert.equal((await live.applicationPreview('retained', job.id, true)).available, false)
})

test('live activity distinguishes login, questions, captcha and submission outcomes', () => {
  assert.equal(live.applicationPhase('Waiting for AI to suggest answers'), 'waiting_ai')
  assert.equal(live.applicationPhase('example.com wants you to sign in or create an account first.', 'needs_user'), 'login')
  assert.equal(live.applicationPhase('3 question(s) need your answer.', 'needs_user'), 'questions')
  assert.equal(live.applicationPhase('Captcha required', 'needs_user'), 'captcha')
  assert.equal(live.applicationPhase('Submit pressed but confirmation missing', 'needs_user'), 'blocked')
  assert.equal(live.applicationPhase('Submitted', 'submitted'), 'submitted')
  assert.equal(live.applicationPhase('Opening browser failed', 'failed'), 'failed')
})

test('preview endpoint authorizes job ownership and disables caching', () => {
  const source = require('node:fs').readFileSync(join(__dirname, '../app/api/jobs/[id]/live/route.ts'), 'utf8')
  assert.ok(source.indexOf('requirePermission') < source.indexOf('applicationPreview(user.username'))
  assert.match(source, /getJob\(user\.username, id\)/)
  assert.match(source, /private, no-store/)
  assert.match(source, /Vary.*Cookie/)
})
