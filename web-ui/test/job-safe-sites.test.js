// Autopilot "Safe sites" (Lever, Greenhouse, Ashby): Submit is pressed only while
// the form itself is on one of those sites. A listing that redirects to a company
// careers site, or an "Apply on company site" popup, is handed back instead.
// The agent runs against a small jsdom-backed stand-in for a Playwright page.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { JSDOM } = require('jsdom')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-safe-sites-'))
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

const { runFormAgent, submitSiteMessage } = require('../lib/job-hunter/agent.ts')
const { AUTO_SUBMIT_ATS } = require('../lib/job-hunter/apply.ts')

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
const SAFE = [...AUTO_SUBMIT_ATS]
const ctx = (extra = {}) => ({
  profile, job: { id: 'j1', title: 'Engineer', company: 'Beta', location: '', description: '', coverLetter: '', ats: 'greenhouse' },
  coverPath: '', generate: null, allowSubmit: true, maxSteps: 6, vision: null, ...extra,
})

/** A minimal stand-in for the parts of a Playwright Page the agent uses, at `url`. */
function fakePage(html, url) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, pretendToBeVisual: true })
  const { window } = dom
  const doc = window.document
  const hidden = el => el && el.nodeType === 1 && (window.getComputedStyle(el).display === 'none' || el.hidden || hidden(el.parentElement))
  window.Element.prototype.getBoundingClientRect = function () {
    return hidden(this) ? { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } : { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }
  }
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
  const listeners = {}
  const page = {
    dom, doc, window, listeners,
    url: () => page.currentUrl,
    currentUrl: url,
    on(event, fn) { listeners[event] = fn },
    off(event) { delete listeners[event] },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    evaluate: async (fn, arg) => inPage(() => fn(arg)),
    waitForFunction: async (fn, arg) => { if (!inPage(() => fn(arg))) throw new Error('timeout') },
    locator: sel => locator(sel),
    getByLabel: () => ({ filter: () => ({ count: async () => 0 }) }),
    screenshot: async () => Buffer.from('jpeg'),
    viewportSize: () => ({ width: 1280, height: 800 }),
    mouse: { click: async () => {}, wheel: async () => {} },
    keyboard: { type: async () => {} },
  }
  return page
}

const FORM = `<form>
  <label for="n">Full name *</label><input id="n" required>
  <label for="e">Email *</label><input id="e" type="email" required>
  <button type="button" id="go">Submit application</button>
</form>`

/** A form page whose Submit shows a confirmation; counts presses. */
function formPage(url) {
  const page = fakePage(FORM, url)
  page.presses = 0
  page.doc.getElementById('go').addEventListener('click', () => { page.presses++; page.doc.body.innerHTML = '<h1>Thank you for applying!</h1>' })
  return page
}

test('safe mode submits when the form really is on Greenhouse', async () => {
  const page = formPage('https://boards.greenhouse.io/beta/jobs/1')
  const out = await runFormAgent(page, ctx({ submitAts: SAFE }))
  assert.equal(out.status, 'submitted')
  assert.equal(page.presses, 1)
})

test('safe mode never presses Submit when a "Greenhouse" listing landed on the company careers site', async () => {
  // The listing said Greenhouse; the redirect ended on the company's own site
  const page = formPage('https://careers.beta-corp.com/apply/1')
  const out = await runFormAgent(page, ctx({ submitAts: SAFE }))
  assert.equal(out.status, 'needs_user')
  assert.equal(page.presses, 0)
  assert.match(out.message, /careers\.beta-corp\.com/)
  assert.match(out.message, /has not been submitted/)
  // The form was still filled in for the user to finish
  assert.equal(page.doc.getElementById('n').value, 'Jane Example')

  // Without the safe-sites list (Any site mode, or the user's own approval) the same page is submitted
  const any = formPage('https://careers.beta-corp.com/apply/1')
  assert.equal((await runFormAgent(any, ctx())).status, 'submitted')
})

test('safe mode hands back when "Apply on company site" opens the form on another host in a popup', async () => {
  const listing = fakePage('<h1>Engineer at Beta</h1><button type="button" id="ext">Apply on company site</button>', 'https://jobs.lever.co/beta/1')
  const popup = formPage('https://jobs.beta-corp.com/form')
  listing.doc.getElementById('ext').addEventListener('click', () => listing.listeners.popup?.(popup))
  const out = await runFormAgent(listing, ctx({ submitAts: SAFE }))
  assert.equal(out.status, 'needs_user')
  assert.equal(popup.presses, 0)
  assert.match(out.message, /jobs\.beta-corp\.com/)

  // A popup that stays on an allowed ATS is fine
  const listing2 = fakePage('<h1>Engineer at Beta</h1><button type="button" id="ext">Apply on company site</button>', 'https://www.beta-corp.com/jobs/1')
  const ats = formPage('https://jobs.ashbyhq.com/beta/1/application')
  listing2.doc.getElementById('ext').addEventListener('click', () => listing2.listeners.popup?.(ats))
  const out2 = await runFormAgent(listing2, ctx({ submitAts: SAFE }))
  assert.equal(out2.status, 'submitted')
  assert.equal(ats.presses, 1)
})

test('the page address is read right before Submit, after any redirect during the form', async () => {
  // Step 1 is on Lever; pressing Next moves the form to another host
  const page = fakePage(`<form>
    <label for="n">Full name *</label><input id="n" required>
    <button type="button" id="next">Next</button></form>`, 'https://jobs.lever.co/beta/1/apply')
  page.presses = 0
  page.doc.getElementById('next').addEventListener('click', () => {
    page.currentUrl = 'https://apply.beta-corp.com/step2'
    page.doc.body.innerHTML = FORM
    page.doc.getElementById('go').addEventListener('click', () => { page.presses++ })
  })
  const out = await runFormAgent(page, ctx({ submitAts: SAFE }))
  assert.equal(out.status, 'needs_user')
  assert.equal(page.presses, 0)
  assert.match(out.message, /apply\.beta-corp\.com/)
})

test('submitSiteMessage: allowed ATS hosts only, look-alike hosts refused', () => {
  assert.equal(submitSiteMessage('https://boards.greenhouse.io/x/jobs/1', SAFE), null)
  assert.equal(submitSiteMessage('https://jobs.lever.co/x/1/apply', SAFE), null)
  assert.equal(submitSiteMessage('https://jobs.ashbyhq.com/x/1', SAFE), null)
  assert.equal(submitSiteMessage('https://anything.example.com/', undefined), null)
  for (const url of ['https://greenhouse.io.evil.com/apply', 'https://lever.co-careers.com/', 'https://x.myworkdayjobs.com/apply', 'about:blank', 'not a url'])
    assert.match(submitSiteMessage(url, SAFE), /has not been submitted/, url)
})
