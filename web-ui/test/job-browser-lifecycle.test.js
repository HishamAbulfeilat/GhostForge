const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

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
const apply = require('../lib/job-hunter/apply.ts')
const store = require('../lib/job-hunter/store.ts')
test.after(() => {
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
      pages: () => [{
        url: () => 'about:blank',
        goto: async url => { visited.push(url); throw new Error('Synthetic navigation failure') },
      }],
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
      body: '<h1>Application</h1><div id="captcha">Complete captcha to continue</div>',
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
    assert.equal(browser.pages()[0].url(), job.applyUrl)
    assert.equal(browser.pages().length, 1, 'startup blank tabs are closed only after the application loads')
    const second = await apply.applyToJob({ ...job, applyUrl: 'https://example.com/application?job=2' }, profile, 'retained', { headless: false, allowSubmit: false })
    assert.equal(second.status, 'needs_user')
    assert.equal(launches, 1)
    assert.deepEqual(browser.pages().map(page => page.url()), [job.applyUrl, 'https://example.com/application?job=2'])
    await apply.withProfile('retained', true, async context => {
      const page = await context.newPage()
      await page.goto('https://example.com/check')
    })
    assert.equal(browser.pages().length, 2, 'temporary operations must not close retained application tabs')
  } finally { await browser?.close() }
})
