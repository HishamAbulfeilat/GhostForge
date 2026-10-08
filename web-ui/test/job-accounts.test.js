const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname } = require('node:path')
const ts = require('typescript')
const { chromium } = require('playwright-core')

const home = mkdtempSync(join(tmpdir(), 'gf-job-accounts-'))
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
const live = require('../lib/job-hunter/live.ts')
const store = require('../lib/job-hunter/store.ts')
const apply = require('../lib/job-hunter/apply.ts')
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
const notices = []
const accounts = load('../lib/job-hunter/accounts.ts', {
  './live': live, './store': store,
  './notifications': { notifyJob: async (username, id, payload) => { notices.push({ username, id, ...payload }); return 'unavailable' } },
  './apply': { withProfileLock: apply.withProfileLock, resolvesPublicly: async origin => origin === 'https://example.com' },
})
const password = 'Test-only-password!42'
const details = mode => accounts.accountRequest({ mode, origin: 'https://example.com', consent: true, email: 'jane@example.com', password })
let browser
test.before(async () => { browser = await chromium.launch({ headless: true }) })
test.after(async () => {
  await browser?.close()
  hooks.deregister()
  rmSync(home, { recursive: true, force: true })
})

const loginForm = `<form method="post" action="/session" onsubmit="event.preventDefault();window.submitted=(window.submitted||0)+1;document.cookie='test_session=1;SameSite=Lax';document.body.innerHTML='<h1>Verify your email</h1>'">
  <label>Email<input type="email" name="email"></label>
  <label>Password<input type="password"></label>
  <button>Sign in</button></form><a href="/signup">Create account</a>`
const signupForm = `<form method="post" action="/register" onsubmit="event.preventDefault();window.submitted=1">
  <label>First name<input name="firstName"></label><label>Last name<input name="lastName"></label>
  <label>Email<input type="email"></label><label>Password<input type="password"></label>
  <label>Confirm password<input type="password"></label>
  <label><input type="checkbox" name="terms">I accept terms</label><button>Create account</button></form>`
let sequence = 0
async function fixture(html = loginForm) {
  const username = `user-${++sequence}`
  const page = await browser.newPage()
  await page.context().route('https://example.com/**', route => route.fulfill({
    contentType: 'text/html', body: route.request().url().endsWith('/signup') ? signupForm : html,
  }))
  await page.goto('https://example.com/login')
  await store.saveProfile(username, { applicant: { firstName: 'Jane', lastName: 'Example' } })
  const { jobs } = await store.upsertJobs(username, [{ key: 'j1', title: 'Engineer', company: 'Acme', ats: 'other' }])
  const id = jobs[0].id
  await store.updateJob(username, id, { status: 'needs_user' })
  live.updateApplicationActivity(username, id, 'Sign in to continue', 'needs_user')
  live.trackApplicationPage(username, id, page)
  return { username, id, page }
}

test('account request requires explicit exact HTTPS origin consent and bounds credentials', () => {
  assert.equal(details('login').mode, 'login')
  for (const change of [
    { consent: false }, { mode: 'submit-signup' }, { origin: 'http://example.com' },
    { origin: 'https://example.com/path' }, { origin: 'https://other:secret@example.com' },
    { password: 'x'.repeat(513) }, { email: 'invalid' },
  ]) assert.throws(() => accounts.accountRequest({ ...details('login'), ...change }))
})

test('approved sign-in clicks only the login form and never claims successful authentication or applying', async () => {
  const { username, id, page } = await fixture()
  const request = details('login')
  try {
    const result = await accounts.assistAccount(username, id, request)
    assert.equal(await page.evaluate(() => window.submitted), 1)
    assert.match(result.message, /verification/)
    assert.equal(result.job.status, 'needs_user')
    assert.equal(request.password, undefined)
    assert.ok((await page.context().cookies()).some(cookie => cookie.name === 'test_session' && cookie.value === '1'))
    assert.ok(!JSON.stringify(await store.getJob(username, id)).includes(password))
    assert.ok(!JSON.stringify(await store.getProfile(username)).includes(password))
  } finally { await page.close() }
})

test('signup opens and fills confirmed details without accepting terms or creating an account', async () => {
  const { username, id, page } = await fixture()
  try {
    await accounts.assistAccount(username, id, details('open-signup'))
    assert.equal(page.url(), 'https://example.com/signup')
    const result = await accounts.assistAccount(username, id, details('fill-signup'))
    assert.equal(await page.locator('[name="firstName"]').inputValue(), 'Jane')
    assert.equal(await page.locator('[name="lastName"]').inputValue(), 'Example')
    assert.equal(await page.locator('input[type="email"]').inputValue(), 'jane@example.com')
    assert.deepEqual(await page.locator('input[type="password"]').evaluateAll(elements => elements.map(el => el.value)), [password, password])
    assert.equal(await page.locator('[name="terms"]').isChecked(), false)
    assert.equal(await page.evaluate(() => window.submitted || 0), 0)
    assert.match(result.message, /creation is not yet confirmed/)
  } finally { await page.close() }
})

test('signup assistance refuses to treat a login form as registration and rejects cross-site signup links', async () => {
  for (const html of [loginForm, loginForm.replace('href="/signup"', 'href="https://other.example/signup"')]) {
    const { username, id, page } = await fixture(html)
    try {
      await assert.rejects(accounts.assistAccount(username, id, details('fill-signup')), /signup form/)
      assert.equal(await page.locator('input[type="password"]').inputValue(), '')
      if (html.includes('other.example')) {
        await assert.rejects(accounts.assistAccount(username, id, details('open-signup')), /another website/)
        assert.equal(page.url(), 'https://example.com/login')
      }
    } finally { await page.close() }
  }
})

test('preview follows user-opened account popups after the application agent has paused', async () => {
  const { username, id, page } = await fixture(loginForm.replace('href="/signup"', 'target="_blank" href="/signup"'))
  try {
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Create account' }).click()
    const popup = await popupPromise
    await popup.waitForLoadState()
    assert.equal(live.applicationPage(username, id), popup)
    assert.equal(page.listenerCount('popup'), 0, 'tracking moves to the active application popup')
    await accounts.assistAccount(username, id, details('fill-signup'))
    assert.equal(await popup.locator('input[type="email"]').inputValue(), 'jane@example.com')
    await popup.close()
    assert.equal(live.applicationPage(username, id), undefined)
  } finally { await page.close() }
})

test('refuses changed origins, cross-site form targets, GET forms and captchas before filling a password', async () => {
  for (const [html, origin, expected] of [
    [loginForm, 'https://wrong.example', /website changed/],
    [loginForm.replace('action="/session"', 'action="https://other.example/session"'), 'https://example.com', /cross-site/],
    [loginForm.replace('method="post"', 'method="get"'), 'https://example.com', /unsupported/],
    [loginForm.replace('<button>', '<button formaction="https://other.example/session">'), 'https://example.com', /another website/],
  ]) {
    const { username, id, page } = await fixture(html)
    try {
      await assert.rejects(accounts.assistAccount(username, id, { ...details('login'), origin }), expected)
      assert.equal(await page.locator('input[type="password"]').inputValue(), '')
      assert.equal(await page.evaluate(() => window.submitted || 0), 0)
    } finally { await page.close() }
  }
})

const automaticSignup = signupForm
  .replace('<label><input type="checkbox" name="terms">I accept terms</label>', '')
  .replace('name="firstName"', 'name="firstName" required')
  .replace('name="lastName"', 'name="lastName" required')
  .replace("window.submitted=1", "window.submitted=(window.submitted||0)+1;document.body.innerHTML='<h1>Account successfully created</h1>'")

test('automatic registration submits once, fills known names and confirms only a new account success message', async () => {
  const { username, id, page } = await fixture(automaticSignup)
  try {
    const request = details('register')
    const result = await accounts.assistAccount(username, id, request)
    assert.equal(await page.evaluate(() => window.submitted), 1)
    assert.equal(result.accountCreated, true)
    assert.equal(result.job.status, 'needs_user', 'registering does not pretend the job application was submitted')
    assert.match(result.message, /creation confirmed/)
    assert.equal(request.password, undefined)
    assert.equal(result.notification, 'unavailable', 'push is never falsely reported as delivered')
    assert.equal(notices.at(-1).username, username)
    assert.match(notices.at(-1).title, /Account created/)
    assert.ok(!JSON.stringify(notices).includes(password))
  } finally { await page.close() }
})

test('automatic registration stops and persists notifications for explicit/implicit terms, MFA and captcha', async () => {
  for (const [html, phase] of [
    [signupForm, 'terms'],
    [automaticSignup + '<p>By registering you agree to our privacy policy</p>', 'terms'],
    [automaticSignup + '<div id="captcha"></div>', 'captcha'],
    [automaticSignup + '<input autocomplete="one-time-code">', 'login'],
  ]) {
    const { username, id, page } = await fixture(html)
    try {
      const result = await accounts.assistAccount(username, id, details('register'))
      assert.equal(await page.evaluate(() => window.submitted || 0), 0)
      assert.equal(result.accountCreated, false)
      assert.equal(result.job.activity.phase, phase)
      assert.equal(notices.at(-1).id, id)
      assert.equal(await page.locator('input[type="password"]').first().inputValue(), '')
    } finally { await page.close() }
  }
})

test('registration checks required unknown fields and pauses on post-submit verification instead of reporting success', async () => {
  const unknown = automaticSignup.replace('<button>', '<input aria-label="Unknown required field" required><button>')
  const verification = automaticSignup.replace('Account successfully created', 'Verify your email')
  for (const html of [unknown, verification]) {
    const { username, id, page } = await fixture(html)
    try {
      const result = await accounts.assistAccount(username, id, details('register'))
      assert.equal(result.accountCreated, false)
      assert.match(result.message, /Required account fields|verification/)
      assert.equal(await page.evaluate(() => window.submitted || 0), html === unknown ? 0 : 1)
      assert.equal(result.job.status, 'needs_user')
    } finally { await page.close() }
  }
})

test('automatic registration can open the same-origin signup link and pause on its terms without submitting', async () => {
  const { username, id, page } = await fixture()
  try {
    const result = await accounts.assistAccount(username, id, details('register'))
    assert.equal(page.url(), 'https://example.com/signup')
    assert.equal(result.job.activity.phase, 'terms')
    assert.equal(await page.evaluate(() => window.submitted || 0), 0)
  } finally { await page.close() }
})

test('notification helper reports actual delivery and never leaks push failures', async () => {
  let outcome = { delivered: 1, failed: 0 }
  let sent
  const { notifyJob } = load('../lib/job-hunter/notifications.ts', {
    '../push': { sendToUser: async (username, payload) => { sent = { username, ...payload }; if (outcome instanceof Error) throw outcome; return outcome } },
  })
  const payload = { title: 'Needs you', body: 'Review terms' }
  assert.equal(await notifyJob('owner', 'job1', payload), 'sent')
  assert.equal(sent.username, 'owner')
  assert.equal(sent.tag, 'job-hunter:job1')
  assert.equal(sent.url, '/jobs')
  outcome = { delivered: 0, failed: 0 }
  assert.equal(await notifyJob('owner', 'job1', payload), 'unavailable')
  outcome = { delivered: 0, failed: 1 }
  assert.equal(await notifyJob('owner', 'job1', payload), 'failed')
  outcome = new Error('private push endpoint')
  assert.equal(await notifyJob('owner', 'job1', payload), 'failed')
})

test('account assistance is owner scoped, refuses running applications and leaves LinkedIn manual', async () => {
  const { username, id, page } = await fixture()
  try {
    await assert.rejects(accounts.assistAccount('other-user', id, details('login')), /waiting for you/)
    await store.updateJob(username, id, { status: 'submitting' })
    await assert.rejects(accounts.assistAccount(username, id, details('login')), /waiting for you/)
    await store.updateJob(username, id, { status: 'needs_user', ats: 'linkedin' })
    await assert.rejects(accounts.assistAccount(username, id, details('login')), /LinkedIn.*manually/)
    assert.equal(await page.locator('input[type="password"]').inputValue(), '')
  } finally { await page.close() }
})

class Response {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers }
  static json(body, init) { return new Response(body, init) }
}
const state = { allowed: true, owns: true, rate: true, calls: 0, error: null }
const route = load('../app/api/jobs/[id]/account/route.ts', {
  'next/server': { NextResponse: Response },
  '@/lib/hosted': require('../lib/hosted.ts'),
  '@/lib/access': { requirePermission: async () => state.allowed ? { username: 'owner' } : new Response({ error: 'Unauthorized' }, { status: 401 }) },
  '@/lib/job-hunter/store': { getJob: async (username, id) => { assert.equal(username, 'owner'); assert.equal(id, 'j1'); return state.owns ? { id } : null } },
  '@/lib/ratelimit': { checkRateLimit: () => ({ allowed: state.rate }) },
  '@/lib/agent-team-api': require('../lib/agent-team-api.ts'),
  '@/lib/job-hunter/accounts': {
    AccountAssistanceError: accounts.AccountAssistanceError, accountRequest: accounts.accountRequest,
    assistAccount: async (_username, _id, input) => {
      state.calls++
      if (state.error) throw state.error
      return { message: 'Sign-in requested', sentPassword: Boolean(input.password) }
    },
  },
})
const post = (origin = 'http://localhost', app = 'http://localhost', body = JSON.stringify(details('login'))) =>
  route.POST({ nextUrl: new URL(app), headers: new Headers({ origin }), body: new Request(app, { method: 'POST', body }).body }, { params: Promise.resolve({ id: 'j1' }) })

test('account endpoint enforces permission, same-origin, secure transport, ownership, consent and rate limit', async () => {
  state.calls = 0
  state.allowed = false
  assert.equal((await post()).status, 401)
  state.allowed = true
  assert.equal((await post('https://attacker.example')).status, 403)
  assert.equal((await post('http://192.168.1.2', 'http://192.168.1.2')).status, 403)
  state.owns = false
  assert.equal((await post()).status, 404)
  state.owns = true
  state.rate = false
  assert.equal((await post()).status, 429)
  state.rate = true
  assert.equal((await post(undefined, undefined, JSON.stringify({ ...details('login'), consent: false }))).status, 400)
  assert.equal((await post(undefined, undefined, 'x'.repeat(8193))).status, 413)
  assert.equal(state.calls, 0)
  const result = await post()
  assert.equal(result.status, 200)
  assert.match(result.headers['Cache-Control'], /no-store/)
})

test('account endpoint never exposes browser errors containing credentials', async () => {
  state.error = new Error(`Browser fill failed for ${password}`)
  try {
    const result = await post()
    assert.equal(result.status, 409)
    assert.ok(!JSON.stringify(result.body).includes(password))
    state.error = new accounts.AccountAssistanceError('The application website changed.')
    assert.match((await post()).body.error, /website changed/)
  } finally { state.error = null }
})
