// The application form agent, run against local pages in a real headless browser:
// multi-step dialogs, LinkedIn-style placeholder selects, questions it must hand
// back to the user, and never pressing Submit unless it is allowed to.
// Also: reading a pasted job link (JobPosting JSON-LD / meta tags).
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-agent-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

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

const { runFormAgent } = require('../lib/job-hunter/agent.ts')
const { parsePosting } = require('../lib/job-hunter/intake.ts')
const store = require('../lib/job-hunter/store.ts')

let browser = null
test.before(async () => {
  const { chromium } = require('playwright-core')
  const candidates = [{}, ...(existsSync('/opt/pw-browsers/chromium') ? [{ executablePath: '/opt/pw-browsers/chromium' }] : [])]
  for (const c of candidates) {
    try { browser = await chromium.launch({ ...c, headless: true }); break } catch { /* next */ }
  }
})

test.after(async () => {
  await browser?.close()
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// Two-step "Easy Apply"-style dialog. Step 2 asks something only the user knows.
const FORM = `<!doctype html><html><body>
<a href="#elsewhere">Continue reading</a>
<div role="dialog" aria-modal="true">
  <section id="s1">
    <label for="fn">First name *</label><input id="fn" required>
    <label for="ln">Last name *</label><input id="ln" required>
    <label for="em">Email address *</label><input id="em" type="email" required>
    <label for="sp">Will you now or in the future require visa sponsorship? *</label>
    <select id="sp" required><option>Select an option</option><option>Yes</option><option>No</option></select>
    <button type="button" onclick="document.getElementById('s1').style.display='none';document.getElementById('s2').style.display='block'">Next</button>
  </section>
  <section id="s2" style="display:none">
    <label for="rust">How many years of experience do you have with Rust? *</label><input id="rust" type="number" required>
    <button type="button" id="submit" onclick="document.body.innerHTML='<h1>Thank you for applying!</h1>'">Submit application</button>
  </section>
</div></body></html>`

async function context(user, extra = {}) {
  await store.saveProfile(user, {
    applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+1 555 0100', city: 'Berlin', country: 'Germany', needsSponsorship: 'no' },
    ...extra,
  })
  const profile = await store.getProfile(user)
  const job = { id: 'j1', title: 'Rust Engineer', company: 'Acme', description: 'Rust services', coverLetter: '' }
  return { profile, job, coverPath: '', generate: async () => '[]', allowSubmit: false, maxSteps: 6 }
}

async function run(ctx) {
  const page = await browser.newPage()
  await page.setContent(FORM)
  try {
    const outcome = await runFormAgent(page, ctx)
    return { outcome, text: await page.evaluate(() => document.body.innerText) }
  } finally {
    await page.close()
  }
}

test('agent uploads the prepared CV and cover letter, and submits only after approval', async t => {
  if (!browser) return t.skip('no Chromium available')
  const { prepareApplicationFiles } = require('../lib/job-hunter/apply.ts')
  const ctx = await context('agent-upload')
  ctx.job = { ...ctx.job, tailoredResume: '# Jane Example\nReal experience', coverLetter: 'Dear Hiring Manager,\nRegards, Jane Example' }
  const files = await prepareApplicationFiles(ctx.job, ctx.profile, 'agent-upload')
  const page = await browser.newPage()
  try {
    await page.setContent(`<!doctype html><html><body><form>
      <label for="name">Full name *</label><input id="name" required>
      <label for="cv">Resume *</label><input id="cv" type="file" required accept=".docx">
      <label for="cover">Cover letter *</label><input id="cover" type="file" required>
      <button type="button" onclick="document.body.innerHTML='<h1>Thank you for applying!</h1>'">Submit application</button>
    </form></body></html>`)
    const held = await runFormAgent(page, { ...ctx, ...files, generate: null, allowSubmit: false })
    assert.equal(held.status, 'needs_user')
    assert.equal(await page.locator('#name').inputValue(), 'Jane Example')
    assert.equal(await page.locator('#cv').evaluate(el => el.files[0].name), 'tailored-cv.docx')
    assert.equal(await page.locator('#cover').evaluate(el => el.files[0].name), 'cover-letter.txt')
    const sent = await runFormAgent(page, { ...ctx, ...files, generate: null, allowSubmit: true })
    assert.equal(sent.status, 'submitted')
  } finally { await page.close() }
})

test('agent fills the first step, moves on, and hands unknown questions to the user', async t => {
  if (!browser) return t.skip('no Chromium available')
  const ctx = await context('agent-q')
  ctx.generate = async () => JSON.stringify([{ i: 0, value: 'ASK' }])
  const { outcome } = await run(ctx)
  assert.equal(outcome.status, 'needs_user')
  for (const f of ['First name', 'Last name', 'Email address']) assert.ok(outcome.filled.some(l => l.startsWith(f)), f)
  assert.ok(outcome.filled.some(l => /sponsorship/.test(l)), 'placeholder select counted as empty and answered')
  assert.equal(outcome.questions.length, 1)
  assert.match(outcome.questions[0].label, /years of experience do you have with Rust/)
  assert.equal(outcome.questions[0].type, 'number')
})

test('agent stops before Submit unless allowed, then submits when allowed', async t => {
  if (!browser) return t.skip('no Chromium available')
  const ctx = await context('agent-s', { customAnswers: { 'How many years of experience do you have with Rust?': '4' } })
  const held = await run(ctx)
  assert.equal(held.outcome.status, 'needs_user')
  assert.match(held.outcome.message, /ready/i)
  assert.doesNotMatch(held.text, /Thank you/)

  const sent = await run({ ...ctx, allowSubmit: true })
  assert.equal(sent.outcome.status, 'submitted')
  assert.match(sent.text, /Thank you for applying/)
})

test('agent uses grounded AI answers and reports them', async t => {
  if (!browser) return t.skip('no Chromium available')
  const ctx = await context('agent-ai')
  ctx.generate = async () => JSON.stringify([{ i: 0, value: '3' }])
  const { outcome } = await run({ ...ctx, allowSubmit: true })
  assert.equal(outcome.status, 'submitted')
  assert.deepEqual(outcome.aiAnswers.map(a => a.value), ['3'])
})

test('agent never answers sensitive questions from the AI and stops at captchas', async t => {
  if (!browser) return t.skip('no Chromium available')
  const ctx = await context('agent-sens')
  ctx.generate = async () => JSON.stringify([{ i: 0, value: 'No' }])
  const page = await browser.newPage()
  try {
    await page.setContent(`<form><label for="c">Have you ever been convicted of a felony? *</label>
      <select id="c" required><option value="">Select</option><option>Yes</option><option>No</option></select>
      <button type="button">Submit</button></form>`)
    const out = await runFormAgent(page, { ...ctx, allowSubmit: true })
    assert.equal(out.status, 'needs_user')
    assert.match(out.questions[0].label, /convicted/)

    await page.setContent('<form><input aria-label="Email"><div class="g-recaptcha" data-sitekey="x"></div><button>Submit</button></form>')
    const cap = await runFormAgent(page, { ...ctx, allowSubmit: true })
    assert.equal(cap.status, 'needs_user')
    assert.match(cap.message, /captcha/i)
  } finally {
    await page.close()
  }
})

test('parsePosting reads JobPosting JSON-LD, then falls back to meta tags', () => {
  const ld = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Platform Engineer', datePosted: '2026-09-30',
    description: '<p>Build <b>things</b></p>', hiringOrganization: { '@type': 'Organization', name: 'Acme' },
    jobLocation: { '@type': 'Place', address: { addressLocality: 'Berlin', addressCountry: 'DE' } },
    baseSalary: { currency: 'EUR', value: { minValue: 70000, maxValue: 90000 } },
  })}</script></head></html>`
  const p = parsePosting(ld, 'https://careers.acme.com/1')
  assert.equal(p.title, 'Platform Engineer')
  assert.equal(p.company, 'Acme')
  assert.equal(p.location, 'Berlin, DE')
  assert.equal(p.salary, 'EUR 70000-90000')
  assert.match(p.description, /Build things/)
  assert.equal(p.applyUrl, 'https://careers.acme.com/1')

  const graph = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["JobPosting"],"title":"QA Lead","jobLocationType":"TELECOMMUTE"}]}</script>`
  const g = parsePosting(graph, 'https://x.example/2')
  assert.equal(g.title, 'QA Lead')
  assert.equal(g.remote, true)
  assert.equal(g.location, 'Remote')

  const meta = '<meta property="og:title" content="Data Analyst at Beta"><meta name="description" content="Analyse data">'
  const m = parsePosting(meta, 'https://x.example/3')
  assert.equal(m.title, 'Data Analyst at Beta')
  assert.equal(m.description, 'Analyse data')
  assert.equal(parsePosting('<html></html>', 'https://x.example/4'), null)
})

test('a job description saying "thank you for your interest" is not a submission', async t => {
  if (!browser) return t.skip('no Chromium available')
  const { isNewConfirmation } = require('../lib/job-hunter/agent.ts')
  assert.equal(isNewConfirmation('Thank you for your interest in Acme.', 'Thank you for your interest in Acme. Fill in the form.'), false)
  assert.equal(isNewConfirmation('Thank you for your interest in Acme.', 'Thank you for applying!'), true)
  assert.equal(isNewConfirmation('', 'Your application has been submitted'), true)

  const ctx = await context('agent-ty', { customAnswers: { 'How many years of experience do you have with Rust?': '4' } })
  const page = await browser.newPage()
  try {
    await page.setContent(`<p>About Acme… Thank you for your interest in joining Acme!</p>${FORM}`)
    const held = await runFormAgent(page, ctx) // not allowed to submit
    assert.equal(held.status, 'needs_user')
    assert.match(held.message, /ready/i)
  } finally {
    await page.close()
  }
})

test('a job page\'s "Apply now" opens the form instead of being taken for Submit', async t => {
  if (!browser) return t.skip('no Chromium available')
  const ctx = await context('agent-landing', { customAnswers: { 'How many years of experience do you have with Rust?': '4' } })
  const page = await browser.newPage()
  try {
    await page.setContent(`<header><input aria-label="Search jobs" type="text"></header>
      <footer><form><input type="email" aria-label="Newsletter email"></form></footer>
      <button type="button" onclick="document.getElementById('app').style.display='block';this.remove()">Apply now</button>
      <div id="app" style="display:none">${FORM}</div>`)
    // Not allowed to submit: it must still open and fill the form, not stop at "Apply now" claiming all is filled
    const out = await runFormAgent(page, ctx)
    assert.equal(out.status, 'needs_user')
    assert.ok(out.filled.some(l => /First name/.test(l)), JSON.stringify(out))
    assert.equal(await page.isVisible('#app'), true)
  } finally {
    await page.close()
  }
})

test('hidden radios and off-screen honeypots are not treated as questions', async t => {
  if (!browser) return t.skip('no Chromium available')
  const ctx = await context('agent-hidden')
  const page = await browser.newPage()
  try {
    await page.setContent(`<form>
      <label for="fn">First name *</label><input id="fn" required>
      <input type="checkbox" id="hp" name="agree_hp" style="position:absolute;left:-9999px" required><label for="hp" style="position:absolute;left:-9999px">I agree</label>
      <fieldset style="display:none"><legend>Willing to relocate? *</legend>
        <label><input type="radio" name="reloc" value="yes" required> Yes</label><label><input type="radio" name="reloc" value="no"> No</label></fieldset>
      <fieldset><legend>Remote OK? *</legend>
        <label><input type="radio" name="remote" value="yes" required style="opacity:0;width:0;height:0"> Yes</label>
        <label><input type="radio" name="remote" value="no" style="opacity:0;width:0;height:0"> No</label></fieldset>
      <button type="button">Submit application</button></form>`)
    const out = await runFormAgent(page, { ...ctx, generate: async () => JSON.stringify([{ i: 0, value: 'ASK' }]) })
    assert.equal(out.status, 'needs_user')
    assert.deepEqual(out.questions.map(q => q.label), ['Remote OK?'], 'styled radio asked; hidden step not asked')
    assert.equal(await page.isChecked('#hp'), false, 'off-screen honeypot left alone')
  } finally {
    await page.close()
  }
})
