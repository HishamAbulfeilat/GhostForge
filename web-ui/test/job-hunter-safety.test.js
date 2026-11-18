// Job Hunter "acts for the user" safety: consent/legal fields are never filled,
// signatures are never typed, work-eligibility answers only cover the
// applicant's own country, Submit is pressed at most once, and the computer-use
// fallback never accepts terms or submits. The agent runs against a small
// jsdom-backed stand-in for a Playwright page, so no browser is needed.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { JSDOM } = require('jsdom')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-jh-safety-'))
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

const writer = require('../lib/job-hunter/writer.ts')
const { runFormAgent, consentMessage } = require('../lib/job-hunter/agent.ts')

test.after(() => {
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const profile = {
  cv: { text: 'Jane Example\nSenior Engineer | Acme KK | 2021 - Present', fileName: 'cv.pdf', filePath: '/tmp/cv.pdf', uploadedAt: '' },
  applicant: {
    firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+81 90 0000 0000', city: 'Tokyo', country: 'Japan',
    linkedin: '', github: '', portfolio: '', workAuthorized: 'yes', needsSponsorship: 'no', howHeard: 'Job board',
  },
  preferences: { titles: [], locations: [], remote: 'any', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] },
  customAnswers: {},
  updatedAt: '',
}
const job = (extra = {}) => ({ id: 'j1', title: 'Engineer', company: 'Beta', location: '', description: '', coverLetter: '', ...extra })

// ── writer: signatures, consent and legal answers ───────────────────────────

test('signature fields are never answered with the applicant\'s name', () => {
  assert.equal(writer.FIELD_RULES.some(r => r.pattern.test('Electronic signature') || r.pattern.test('Signature')), false)
  for (const label of ['Electronic signature *', 'Signature', 'By typing your name below you certify the information is true', 'E-sign here'])
    assert.equal(writer.answerFor(label, profile, job()), '', label)
  assert.equal(writer.answerFor('Full name', profile, job()), 'Jane Example')
})

test('one consent/legal detector covers every wording, and leaves ordinary questions alone', () => {
  for (const label of [
    'I accept the privacy notice', 'I agree to the terms', 'Do you consent to us storing your data for future roles?',
    'I understand that false statements may lead to dismissal', 'I attest that the above is correct', 'I certify this application is true',
    'I acknowledge the data processing notice', 'Terms and conditions', 'GDPR consent', 'Declaration', 'I have read and understood the policy',
    'Please confirm the information provided is accurate', 'Electronic signature',
  ]) assert.equal(writer.isConsentOrLegal(label), true, label)
  for (const label of ['First name', 'Email address', 'Accepted file types: pdf, docx', 'What salary would you accept?', 'Years of experience with React', 'Do you have an AWS certification?'])
    assert.equal(writer.isConsentOrLegal(label), false, label)
  // A select or radio consent is caught just like a checkbox, and page text saying "by submitting you agree"
  assert.match(consentMessage(['Email', 'Do you consent to us storing your data for future roles?'], ''), /consent/i)
  assert.match(consentMessage(['Email'], 'By applying you agree to our privacy policy'), /terms or privacy consent/)
  assert.equal(consentMessage(['Email', 'Phone'], 'Apply for this role'), null)
})

test('saved answers are never reused for consent or legal labels', () => {
  const p = { ...profile, customAnswers: { 'I accept the privacy notice': 'Yes', 'Notice period': '1 month' } }
  assert.equal(writer.answerFor('I accept the privacy notice', p, job()), '')
  assert.equal(writer.answerFor('Notice period', p, job()), '1 month')
  assert.equal(writer.reusableAnswer('I accept the privacy notice'), false)
})

test('work authorization and sponsorship are answered only for the applicant\'s own country', () => {
  const a = (label, j = job()) => writer.answerFor(label, profile, j)
  assert.equal(a('Are you legally authorized to work in the United States?'), '')
  assert.equal(a('Are you legally authorized to work in Japan?'), 'Yes')
  assert.equal(a('Are you legally authorized to work in your country of residence?'), 'Yes')
  // "this country" / no country: decided by where the job is
  assert.equal(a('Are you legally authorized to work in this country?', job({ location: 'Tokyo, Japan' })), 'Yes')
  assert.equal(a('Are you legally authorized to work in this country?', job({ location: 'Remote' })), '')
  assert.equal(a('Will you now or in the future require visa sponsorship?', job({ location: 'New York, US' })), '')
  assert.equal(a('Will you now or in the future require visa sponsorship?', job({ location: 'Tokyo, Japan' })), 'No')
  assert.equal(a('Will you require sponsorship to work in Japan?'), 'No')
  assert.equal(a('Will you require sponsorship to work in the U.S.?'), '')
  // "visa" alone is not a sponsorship question
  assert.equal(a('Do you hold a valid UK visa?'), '')
  assert.equal(a('Visa status'), '')
  // US applicant, US question
  const us = { ...profile, applicant: { ...profile.applicant, country: 'USA', city: 'Austin' } }
  assert.equal(writer.answerFor('Are you authorized to work in the United States without sponsorship?', us, job()), 'Yes')
  // Every one of these is the user's to answer, never the AI's
  for (const l of ['Are you legally authorized to work in the United States?', 'Do you require visa sponsorship?', 'Have you previously worked for Beta?'])
    assert.equal(writer.needsUserAnswer(l), true, l)
})

test('"previously worked for X?" is handed back, and a per-job answer is not reused elsewhere', () => {
  assert.equal(writer.answerFor('Have you previously worked for Beta?', profile, job()), '')
  assert.equal(writer.answerFor('Are you a former employee of Beta?', profile, job()), '')
  // Even a saved profile answer for the generic wording is not reused across employers
  const p = { ...profile, customAnswers: { 'Have you previously worked for this company?': 'No' } }
  assert.equal(writer.answerFor('Have you previously worked for this company?', p, job()), '')
  assert.equal(writer.reusableAnswer('Have you previously worked for this company?'), false)
  // The user's answer for this one job is used for this job
  assert.equal(writer.answerFor('Have you previously worked for this company?', profile, job({ jobAnswers: { 'Have you previously worked for this company?': 'Yes' } })), 'Yes')
  // A question naming a country can be saved and reused (same label = same country)
  assert.equal(writer.reusableAnswer('Are you legally authorized to work in the United States?'), true)
  assert.equal(writer.reusableAnswer('Will you require visa sponsorship?'), false)
})

// ── the form agent, on a jsdom page ─────────────────────────────────────────

/** A minimal stand-in for the parts of a Playwright Page the agent uses. */
function fakePage(html, setup = () => {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://jobs.example.com/apply', pretendToBeVisual: true })
  const { window } = dom
  const doc = window.document
  const hidden = el => el && el.nodeType === 1 && (window.getComputedStyle(el).display === 'none' || el.hidden || hidden(el.parentElement))
  window.Element.prototype.getBoundingClientRect = function () {
    return hidden(this) ? { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } : { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }
  }
  // jsdom has no layout, so no innerText; textContent is close enough here
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent }, configurable: true })
  if (!window.CSS) window.CSS = {}
  window.CSS.escape ??= s => String(s).replace(/["\\]/g, '\\$&')
  doc.elementFromPoint = () => null
  const inPage = fn => {
    const saved = {}
    const globals = { document: doc, window, getComputedStyle: window.getComputedStyle.bind(window), CSS: window.CSS, scrollX: 0, scrollY: 0 }
    for (const k of Object.keys(globals)) {
      saved[k] = Object.getOwnPropertyDescriptor(globalThis, k)
      Object.defineProperty(globalThis, k, { value: globals[k], configurable: true, writable: true })
    }
    try { return fn() } finally {
      for (const k of Object.keys(globals)) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k])
        else delete globalThis[k]
      }
    }
  }
  const locator = (sel, pick) => {
    const all = () => {
      const els = [...doc.querySelectorAll(sel.replace(/:visible/g, ''))]
      return pick === undefined ? els : els.slice(pick, pick + 1)
    }
    const one = () => { const el = all()[0]; if (!el) throw new Error(`no element for ${sel}`); return el }
    const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }))
    return {
      count: async () => all().length,
      first: () => locator(sel, 0),
      nth: i => locator(sel, i),
      filter: () => locator(sel, pick),
      isVisible: async () => all().length > 0,
      click: async () => { one().click() },
      check: async () => { const el = one(); el.checked = true; fire(el, 'change') },
      fill: async v => { const el = one(); el.value = v; fire(el, 'input'); fire(el, 'change') },
      selectOption: async ({ label }) => {
        const el = one()
        const opt = [...el.options].find(o => o.text.trim() === label)
        if (!opt) throw new Error('no option')
        el.value = opt.value; fire(el, 'change')
      },
      setInputFiles: async () => { throw new Error('no files in the fake page') },
      inputValue: async () => one().value,
      evaluate: async fn => inPage(() => fn(one())),
    }
  }
  const state = { mouseClicks: 0, wheels: 0, typed: '', visionPrompts: [] }
  const page = {
    dom, doc, window, state,
    url: () => 'https://jobs.example.com/apply',
    on() {}, off() {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    evaluate: async (fn, arg) => inPage(() => fn(arg)),
    waitForFunction: async (fn, arg) => { if (!inPage(() => fn(arg))) throw new Error('timeout') },
    locator: sel => locator(sel),
    getByLabel: () => ({ filter: () => ({ count: async () => 0 }) }),
    screenshot: async () => Buffer.from('jpeg'),
    viewportSize: () => ({ width: 1280, height: 800 }),
    mouse: {
      click: async (x, y) => { state.mouseClicks++; doc.elementFromPoint(x, y)?.click() },
      wheel: async () => { state.wheels++; page.onWheel?.() },
    },
    keyboard: { type: async text => { state.typed += text } },
  }
  setup(page)
  return page
}

const ctx = (extra = {}) => ({ profile, job: job(), coverPath: '', generate: null, allowSubmit: true, maxSteps: 6, vision: null, ...extra })

test('agent presses Submit at most once when it does not recognise the confirmation', async () => {
  const page = fakePage(`<form>
    <label for="n">Full name *</label><input id="n" required>
    <label for="e">Email *</label><input id="e" type="email" required>
    <button type="button" id="go">Submit application</button>
  </form><div id="msg"></div>`)
  let presses = 0
  page.doc.getElementById('go').addEventListener('click', () => { presses++; page.doc.getElementById('msg').textContent = 'Nice, your application is on its way' })
  const out = await runFormAgent(page, ctx())
  assert.equal(presses, 1)
  assert.equal(out.status, 'needs_user')
  assert.match(out.message, /pressed once/)
  assert.match(out.message, /employer site/)
})

test('agent still reports a recognised confirmation as submitted', async () => {
  const page = fakePage(`<form>
    <label for="n">Full name *</label><input id="n" required>
    <label for="e">Email *</label><input id="e" type="email" required>
    <button type="button" id="go">Submit application</button>
  </form>`)
  page.doc.getElementById('go').addEventListener('click', () => { page.doc.body.innerHTML = '<h1>Thank you for applying!</h1>' })
  const out = await runFormAgent(page, ctx())
  assert.equal(out.status, 'submitted')
})

test('a consent question asked as a select or radio stops the run; it is never filled or sent to the AI', async () => {
  for (const consent of [
    `<label for="c">Do you consent to us storing your data for future roles? *</label>
     <select id="c" required><option value="">Select</option><option>Yes</option><option>No</option></select>`,
    `<fieldset><legend>I acknowledge the candidate privacy notice *</legend>
     <label><input type="radio" name="ack" value="yes" required>Yes</label><label><input type="radio" name="ack" value="no">No</label></fieldset>`,
  ]) {
    const page = fakePage(`<form><label for="e">Email *</label><input id="e" required>${consent}<button type="button" id="go">Submit application</button></form>`)
    let presses = 0, aiCalls = 0
    page.doc.getElementById('go').addEventListener('click', () => { presses++ })
    const out = await runFormAgent(page, ctx({ generate: async () => { aiCalls++; return JSON.stringify([{ i: 0, value: 'Yes' }, { i: 1, value: 'Yes' }]) } }))
    assert.equal(out.status, 'needs_user')
    assert.match(out.message, /consent/i)
    assert.equal(presses, 0)
    assert.equal(aiCalls, 0)
    assert.equal(page.doc.querySelector('select')?.value ?? '', '')
    assert.equal([...page.doc.querySelectorAll('input[type="radio"]')].some(r => r.checked), false)
  }
})

test('a signature text field and an "I accept" checkbox with a saved "Yes" stop the run unfilled', async () => {
  const sig = fakePage(`<form><label for="n">Full name *</label><input id="n" required>
    <label for="s">Electronic signature: by typing your name you certify the information is true *</label><input id="s" required>
    <button type="button" id="go">Submit application</button></form>`)
  let presses = 0
  sig.doc.getElementById('go').addEventListener('click', () => { presses++ })
  const out = await runFormAgent(sig, ctx())
  assert.equal(out.status, 'needs_user')
  assert.match(out.message, /signature/i)
  assert.equal(sig.doc.getElementById('s').value, '')
  assert.equal(presses, 0)

  const accept = fakePage(`<form><label for="e">Email *</label><input id="e" required>
    <label><input type="checkbox" id="pn" required>I accept the candidate privacy notice</label>
    <button type="button">Submit application</button></form>`)
  const p = { ...profile, customAnswers: { 'I accept the candidate privacy notice': 'Yes' } }
  const out2 = await runFormAgent(accept, ctx({ profile: p }))
  assert.equal(out2.status, 'needs_user')
  assert.equal(accept.doc.getElementById('pn').checked, false)
})

test('computer use is told to stop at terms, signatures and Submit, and is never let click them', async () => {
  // A stuck layout: no Next/Submit the DOM agent recognises, a custom "I agree" control and a div Submit
  const page = fakePage(`<form><label for="n">Full name</label><input id="n"></form>
    <div id="agree" role="button">I agree to the terms</div><div id="send" role="button" tabindex="0">Submit</div>`)
  let agreed = 0, sent = 0
  page.doc.getElementById('agree').addEventListener('click', () => { agreed++ })
  page.doc.getElementById('send').addEventListener('click', () => { sent++ })
  // The model "chooses" to click whatever sits at the point: first the terms, then Submit
  const targets = ['agree', 'send']
  page.doc.elementFromPoint = () => page.doc.getElementById(targets[0])
  const prompts = []
  const vision = async (_img, prompt) => { prompts.push(prompt); return JSON.stringify({ action: 'click', x: 10, y: 10, why: 'continue' }) }
  const out = await runFormAgent(page, ctx({ vision }))
  assert.equal(out.status, 'needs_user')
  assert.equal(agreed, 0)
  assert.match(prompts[0], /terms/i)
  assert.match(prompts[0], /signature/i)
  assert.match(prompts[0], /final Submit/)
  targets.shift()
  const out2 = await runFormAgent(page, ctx({ vision }))
  assert.equal(out2.status, 'needs_user')
  assert.equal(sent, 0)
  assert.equal(page.state.mouseClicks, 0)
})

test('the consent gate runs again after each computer-use action', async () => {
  const page = fakePage('<form><label for="n">Full name</label><input id="n"></form>')
  // Scrolling reveals a custom consent toggle that the DOM field scan cannot see
  page.onWheel = () => {
    const t = page.doc.createElement('div')
    t.setAttribute('role', 'checkbox'); t.setAttribute('aria-checked', 'false'); t.textContent = 'I agree to the terms of service'
    page.doc.body.appendChild(t)
  }
  let calls = 0
  const vision = async () => { calls++; return JSON.stringify({ action: 'scroll', why: 'look further' }) }
  const out = await runFormAgent(page, ctx({ vision }))
  assert.equal(out.status, 'needs_user')
  assert.match(out.message, /Terms, consent/)
  assert.equal(calls, 1)
})
