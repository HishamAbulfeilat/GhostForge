// The form agent against local pages that mimic the structure of common ATS
// application forms (Greenhouse, Lever, Ashby, Workday, SmartRecruiters,
// Workable, iCIMS, Taleo, BambooHR, Teamtailor, LinkedIn Easy Apply). Pages are
// served at realistic URLs through Playwright routing — nothing leaves this machine.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, existsSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-ats-'))
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
const store = require('../lib/job-hunter/store.ts')

const cvPath = join(fakeHome, 'Jane-Example-CV.pdf')
writeFileSync(cvPath, '%PDF-1.4 test CV')

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

let n = 0
async function ctxFor(extra = {}) {
  const user = `ats-${n++}`
  await store.saveProfile(user, {
    cv: { text: 'Jane Example\nSenior Frontend Engineer | Acme | 2021 - Present\nReact TypeScript', fileName: 'Jane-Example-CV.pdf', filePath: cvPath, uploadedAt: '' },
    applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+49 30 1234567', city: 'Berlin', country: 'Germany', workAuthorized: 'yes', needsSponsorship: 'no', linkedin: 'https://www.linkedin.com/in/jane' },
    ...extra,
  })
  const profile = await store.getProfile(user)
  return { profile, job: { id: 'j', title: 'Frontend Engineer', company: 'Acme', description: 'React', coverLetter: 'Dear team, …' }, coverPath: '', generate: async () => '[]', allowSubmit: true, maxSteps: 10 }
}

/** Serve `pages` (url → html) and run the agent from the first URL. */
async function runOn(pages, ctx) {
  const page = await browser.newPage()
  await page.route('**/*', route => {
    const url = route.request().url().replace(/#.*$/, '')
    const html = pages[url]
    return html ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : route.fulfill({ status: 404, body: 'not found' })
  })
  try {
    await page.goto(Object.keys(pages)[0])
    const outcome = await runFormAgent(page, ctx)
    const current = page.context().pages().at(-1)
    return { outcome, page: current, text: await current.evaluate(() => document.body.innerText) }
  } catch (e) {
    await page.close()
    throw e
  }
}

const THANKS = `document.body.innerHTML='<h1>Thank you for applying!</h1>'`

test('Greenhouse: hidden resume input, react-select dropdowns, native selects', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><html><body><form id="application-form">
    <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label><input id="first_name" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label><input id="last_name" aria-required="true"></div>
    <div class="field-wrapper"><label for="email">Email<span>*</span></label><input id="email" type="email" aria-required="true"></div>
    <div class="field-wrapper"><label for="phone">Phone</label><input id="phone" type="tel"></div>
    <div class="field-wrapper file-upload"><label for="resume">Resume/CV *</label><button type="button" onclick="document.getElementById('resume').click()">Attach</button><input type="file" id="resume" style="display:none" aria-required="true"></div>
    <div class="field-wrapper"><label id="q1-label" for="q1">Are you legally authorized to work in Germany? *</label>
      <div class="select__container"><div class="select__value-container"><div class="select__placeholder">Select...</div>
        <input id="q1" role="combobox" aria-labelledby="q1-label" aria-required="true" aria-expanded="false" autocomplete="off"></div>
        <div class="select__menu" role="listbox" style="display:none"></div><input type="hidden" name="q1" value=""></div></div>
    <div class="field-wrapper"><label for="hear">How did you hear about us?</label><select id="hear"><option value="">Select...</option><option>Job board</option><option>Referral</option></select></div>
    <button type="button" onclick="${THANKS}">Submit application</button>
  </form>
  <script>
    const input = document.getElementById('q1'), menu = document.querySelector('.select__menu')
    const show = () => {
      menu.innerHTML = ['Yes', 'No'].filter(o => o.toLowerCase().includes(input.value.toLowerCase())).map(o => '<div role="option" class="select__option">' + o + '</div>').join('')
      menu.style.display = 'block'
      menu.querySelectorAll('[role=option]').forEach(opt => opt.onclick = () => {
        document.querySelector('input[name=q1]').value = opt.textContent
        document.querySelector('.select__placeholder').outerHTML = '<div class="select__single-value">' + opt.textContent + '</div>'
        input.value = ''; menu.style.display = 'none'
      })
    }
    input.addEventListener('click', show); input.addEventListener('input', show)
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.style.display = 'none' })
  </script></body></html>`
  const { outcome, page } = await runOn({ 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.ok(outcome.filled.includes('Resume upload'))
    assert.ok(outcome.filled.some(l => /legally authorized/.test(l)), 'react-select answered')
  } finally { await page.close() }
})

test('Greenhouse: the custom dropdown keeps its chosen value and the form waits for approval', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><form>
    <div class="field"><label id="l" for="c">Will you require visa sponsorship? *</label>
    <div class="select__value-container"><div class="select__placeholder">Select...</div><input id="c" role="combobox" aria-labelledby="l" aria-required="true"></div>
    <div role="listbox" style="display:none"></div><input type="hidden" name="c"></div>
    <label for="fn">First name *</label><input id="fn" required>
    <button type="button" onclick="${THANKS}">Submit application</button></form>
    <script>
      const i = document.getElementById('c'), m = document.querySelector('[role=listbox]')
      i.onclick = () => { m.innerHTML = '<div role="option">Yes</div><div role="option">No</div>'; m.style.display = 'block'
        m.querySelectorAll('[role=option]').forEach(o => o.onclick = () => { document.querySelector('input[name=c]').value = o.textContent
          document.querySelector('.select__placeholder').outerHTML = '<div class="select__single-value">' + o.textContent + '</div>'; m.style.display = 'none' }) }
    </script></body>`
  const ctx = await ctxFor()
  const { outcome, page } = await runOn({ 'https://job-boards.greenhouse.io/acme/jobs/2': html }, { ...ctx, allowSubmit: false })
  try {
    assert.equal(outcome.status, 'needs_user')
    assert.match(outcome.message, /ready/i)
    assert.equal(await page.inputValue('input[name=c]'), 'No')
  } finally { await page.close() }
})

test('Lever: labels in sibling divs, ✱ required markers, full name, radio questions', async t => {
  if (!browser) return t.skip('no Chromium available')
  const q = (label, field) => `<li class="application-question"><div class="application-label">${label}<span class="required">✱</span></div><div class="application-field">${field}</div></li>`
  const html = `<!doctype html><body><form><ul>
    ${q('Resume/CV', '<input type="file" name="resume">')}
    ${q('Full name', '<input type="text" name="name">')}
    ${q('Email', '<input type="email" name="email">')}
    ${q('Phone', '<input type="text" name="phone">')}
    <li class="application-question custom-question"><div class="application-label"><div class="text">Are you comfortable working in a hybrid setting?<span class="required">✱</span></div></div>
      <div class="application-field"><ul><li><label><input type="radio" name="cards[0][field0]" value="Yes">Yes</label></li><li><label><input type="radio" name="cards[0][field0]" value="No">No</label></li></ul></div></li>
  </ul><button type="button" id="btn-submit" onclick="${THANKS}">Submit application</button></form></body>`
  const url = 'https://jobs.lever.co/acme/0b0c0d0e-0000-4000-8000-000000000000/apply'

  // Unknown required question: asked, with its real label, not submitted
  const asked = await runOn({ [url]: html }, await ctxFor())
  try {
    assert.equal(asked.outcome.status, 'needs_user', JSON.stringify(asked.outcome))
    assert.deepEqual(asked.outcome.questions.map(x => x.label), ['Are you comfortable working in a hybrid setting?'])
    assert.equal(await asked.page.inputValue('input[name=name]'), 'Jane Example')
  } finally { await asked.page.close() }

  // Answered once: submitted
  const done = await runOn({ [url]: html }, await ctxFor({ customAnswers: { 'Are you comfortable working in a hybrid setting?': 'Yes' } }))
  try {
    assert.equal(done.outcome.status, 'submitted', JSON.stringify(done.outcome))
    assert.ok(done.outcome.filled.includes('Resume upload'))
  } finally { await done.page.close() }
})

test('Ashby: location autocomplete combobox and a hidden upload input', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><div class="ashby-application-form">
    <div class="_fieldEntry"><label for="_systemfield_name">Name *</label><input id="_systemfield_name" required></div>
    <div class="_fieldEntry"><label for="_systemfield_email">Email *</label><input id="_systemfield_email" type="email" required></div>
    <div class="_fieldEntry"><label for="_systemfield_resume">Resume *</label><button type="button">Upload File</button><input id="_systemfield_resume" type="file" style="display:none" required></div>
    <div class="_fieldEntry"><label for="loc">Location *</label><input id="loc" role="combobox" aria-required="true" autocomplete="off"><div role="listbox" id="locs"></div></div>
    <button type="button" onclick="document.body.innerHTML='<h2>Thanks for applying to Acme!</h2>'">Submit Application</button></div>
    <script>
      const loc = document.getElementById('loc'), list = document.getElementById('locs')
      const cities = ['Berlin, Germany', 'Berlin, NH, United States', 'Bern, Switzerland']
      loc.addEventListener('input', () => {
        list.innerHTML = loc.value.length < 2 ? '' : cities.filter(c => c.toLowerCase().startsWith(loc.value.toLowerCase().slice(0, 4))).map(c => '<div role="option">' + c + '</div>').join('')
        list.querySelectorAll('[role=option]').forEach(o => o.onclick = () => { loc.value = o.textContent; list.innerHTML = '' })
      })
    </script></body>`
  const { outcome, page } = await runOn({ 'https://jobs.ashbyhq.com/acme/abc/application': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.ok(outcome.filled.includes('Location *') || outcome.filled.some(l => /Location/.test(l)))
  } finally { await page.close() }
})

test('Workday: "Apply Manually" leads to account creation, which comes back to the user untouched', async t => {
  if (!browser) return t.skip('no Chromium available')
  const job = `<!doctype html><body><h1>Frontend Engineer</h1><a role="button" href="#" data-automation-id="adventureButton"
    onclick="document.getElementById('m').style.display='block';return false">Apply</a>
    <div id="m" role="dialog" aria-modal="true" style="display:none"><button type="button">Autofill with Resume</button>
    <button type="button" onclick="location.href='https://acme.wd5.myworkdayjobs.com/en-US/External/job/apply/applyManually'">Apply Manually</button>
    <button type="button">Use My Last Application</button></div></body>`
  const account = `<!doctype html><body><h2>Create Account</h2><form>
    <label for="e">Email Address *</label><input id="e" type="email"><label for="p">Password *</label><input id="p" type="password">
    <label for="v">Verify New Password *</label><input id="v" type="password"><button type="button">Create Account</button></form></body>`
  const { outcome, page } = await runOn({
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/Frontend-Engineer_R1': job,
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/apply/applyManually': account,
  }, await ctxFor())
  try {
    assert.equal(outcome.status, 'needs_user')
    assert.match(outcome.message, /create an account/)
    assert.equal(await page.inputValue('#p'), '', 'never types a password')
  } finally { await page.close() }
})

test('Workday (signed in): multi-page form with listbox dropdowns, resume step and review', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><div id="app"></div><script>
    const listbox = (id, label, options) => '<div data-automation-id="formField-' + id + '"><label for="' + id + '">' + label + '<abbr title="required">*</abbr></label>'
      + '<button type="button" id="' + id + '" aria-haspopup="listbox" data-options="' + options.join('|') + '">Select One</button></div>'
    const steps = [
      '<h2>My Information</h2><div data-automation-id="formField-legalNameSection_firstName"><label for="fn">Given Name(s)*</label><input id="fn" aria-required="true"></div>'
        + '<div><label for="ln">Family Name*</label><input id="ln" aria-required="true"></div><div><label for="em">Email*</label><input id="em" aria-required="true"></div>'
        + '<div><label for="ph">Phone Number*</label><input id="ph" aria-required="true"></div>' + listbox('country', 'Country', ['Germany', 'United States of America']),
      '<h2>My Experience</h2><div data-automation-id="formField-resume"><label for="cv">Resume/CV*</label><input id="cv" type="file" data-automation-id="file-upload-input-ref" aria-required="true"></div>',
      '<h2>Application Questions</h2>' + listbox('auth', 'Are you legally authorized to work in the country for which you are applying?', ['Yes', 'No']),
      '<h2>Review</h2><p>Check your application.</p>',
    ]
    let step = 0
    const render = () => {
      const last = step === steps.length - 1
      document.getElementById('app').innerHTML = steps[step] + '<button type="button" id="go">' + (last ? 'Submit' : 'Save and Continue') + '</button>'
      document.querySelectorAll('[aria-haspopup=listbox]').forEach(b => b.onclick = () => {
        const ul = document.createElement('ul'); ul.setAttribute('role', 'listbox')
        ul.innerHTML = b.dataset.options.split('|').map(o => '<li role="option">' + o + '</li>').join('')
        ul.querySelectorAll('li').forEach(li => li.onclick = () => { b.textContent = li.textContent; ul.remove() })
        b.after(ul)
      })
      document.getElementById('go').onclick = () => {
        const empty = [...document.querySelectorAll('#app input:not([type=file])')].some(i => !i.value) || [...document.querySelectorAll('[aria-haspopup=listbox]')].some(b => b.textContent === 'Select One')
        if (empty) return
        if (last) document.body.innerHTML = '<h1>Application Submitted</h1>'
        else { step++; render() }
      }
    }
    render()
  </script></body>`
  const { outcome, page, text } = await runOn({ 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/apply': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.match(text, /Application Submitted/)
    assert.ok(outcome.filled.includes('Resume upload'))
    assert.ok(outcome.filled.some(l => /Country/.test(l)))
  } finally { await page.close() }
})

test('SmartRecruiters: "I\'m interested", then a form built from shadow-DOM web components', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><h1>Frontend Engineer</h1><button type="button" onclick="document.getElementById('f').style.display='block';this.remove()">I'm interested</button>
    <form id="f" style="display:none"><sr-field label="First name" required></sr-field><sr-field label="Last name" required></sr-field>
    <sr-field label="Email" type="email" required></sr-field><sr-field label="Resume" type="file" required></sr-field>
    <button type="button" onclick="document.body.innerHTML='<h1>Your application has been submitted</h1>'">Send application</button></form>
    <script>
      customElements.define('sr-field', class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: 'open' })
          root.innerHTML = '<label for="i">' + this.getAttribute('label') + '</label><input id="i" type="' + (this.getAttribute('type') || 'text') + '"' + (this.hasAttribute('required') ? ' required' : '') + '>'
        }
      })
    </script></body>`
  const { outcome, page } = await runOn({ 'https://jobs.smartrecruiters.com/Acme/123-frontend-engineer': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    for (const f of ['First name', 'Last name', 'Email', 'Resume upload']) assert.ok(outcome.filled.includes(f), f)
  } finally { await page.close() }
})

test('Workable: fills the form but leaves the privacy consent to the user', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><form data-ui="application-form">
    <div data-ui="firstname"><label for="firstname">First name*</label><input id="firstname" required></div>
    <div data-ui="lastname"><label for="lastname">Last name*</label><input id="lastname" required></div>
    <div data-ui="email"><label for="email">Email*</label><input id="email" required></div>
    <div data-ui="phone"><label for="phone">Phone</label><input id="phone"></div>
    <div data-ui="resume"><label for="resume">Resume*</label><input id="resume" type="file" required></div>
    <div data-ui="cover_letter"><label for="cl">Cover letter</label><textarea id="cl"></textarea></div>
    <div data-ui="gdpr"><input id="gdpr" type="checkbox" required><label for="gdpr">I agree to the processing of my data per the privacy policy*</label></div>
    <button type="button" data-ui="submit" onclick="${THANKS}">Submit application</button></form></body>`
  const { outcome, page } = await runOn({ 'https://apply.workable.com/acme/j/ABC123/apply/': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'needs_user', JSON.stringify(outcome))
    assert.match(outcome.message, /did not accept terms/)
    assert.equal(outcome.submitPressed, false)
    assert.equal(await page.isChecked('#gdpr'), false, 'consent never ticked by GhostForge')
    for (const f of ['First name', 'Resume upload', 'Cover letter']) assert.ok(outcome.filled.some(l => l.startsWith(f)), f)
  } finally { await page.close() }
})

test('iCIMS: a career page embedding the form in an iframe is followed to the form', async t => {
  if (!browser) return t.skip('no Chromium available')
  const frame = 'https://careers-acme.icims.com/jobs/1234/frontend-engineer/candidate?in_iframe=1'
  const form = `<!doctype html><body><form><div class="iCIMS_TableRow"><label for="fn">First Name *</label><input id="fn" required></div>
    <div class="iCIMS_TableRow"><label for="ln">Last Name *</label><input id="ln" required></div>
    <div class="iCIMS_TableRow"><label for="em">Email *</label><input id="em" required></div>
    <div class="iCIMS_TableRow"><label for="cv">Upload resume *</label><input id="cv" type="file" required></div>
    <input type="submit" value="Submit" onclick="event.preventDefault();${THANKS}"></form></body>`
  const { outcome, page } = await runOn({
    'https://www.acme-careers.example/jobs/1234': `<!doctype html><body><h1>Careers at Acme</h1><iframe id="icims_content_iframe" src="${frame}"></iframe></body>`,
    [frame]: form,
  }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.match(page.url(), /icims\.com/)
  } finally { await page.close() }
})

test('Taleo: a sign-in page is never filled; it comes back to the user', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><h1>Sign In</h1><form><label for="u">User Name</label><input id="u"><label for="p">Password</label><input id="p" type="password"><button type="button">Sign In</button>
    <a href="#">New user</a></form></body>`
  const { outcome, page } = await runOn({ 'https://acme.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=en': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'needs_user')
    assert.match(outcome.message, /sign-in|sign in/i)
    assert.equal(await page.inputValue('#u'), '')
  } finally { await page.close() }
})

test('BambooHR: "Apply for This Job" opens the form; native selects and consent', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><h1>Frontend Engineer</h1><button type="button" onclick="document.getElementById('f').hidden=false;this.remove()">Apply for This Job</button>
    <form id="f" hidden><div class="fab-FormField"><label for="firstName">First Name*</label><input id="firstName" required></div>
    <div class="fab-FormField"><label for="lastName">Last Name*</label><input id="lastName" required></div>
    <div class="fab-FormField"><label for="email">Email*</label><input id="email" required></div>
    <div class="fab-FormField"><label for="phone">Phone*</label><input id="phone" required></div>
    <div class="fab-FormField"><label for="country">Country*</label><select id="country" required><option value="">–Select–</option><option>France</option><option>Germany</option></select></div>
    <div class="fab-FormField"><label for="resume">Resume*</label><input id="resume" type="file" required></div>
    <button type="button" onclick="document.body.innerHTML='<h1>Your application was submitted successfully</h1>'">Submit Application</button></form></body>`
  const { outcome, page } = await runOn({ 'https://acme.bamboohr.com/careers/42': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.ok(outcome.filled.some(l => /Country/.test(l)))
  } finally { await page.close() }
})

test('Teamtailor: an upload button that creates its file input on click; terms stay with the user', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><form>
    <label for="first_name">First name *</label><input id="first_name" required>
    <label for="last_name">Last name *</label><input id="last_name" required>
    <label for="email">Email *</label><input id="email" type="email" required>
    <div class="upload"><span>CV</span><button type="button" onclick="const i=document.createElement('input');i.type='file';i.id='cvfile';i.style.display='none';this.after(i);i.click()">Upload CV</button></div>
    <input id="terms" type="checkbox" required><label for="terms">I accept the terms and privacy policy *</label>
    <button type="button" onclick="if(document.getElementById('cvfile')?.files.length)${THANKS}">Send application</button></form></body>`
  const { outcome, page } = await runOn({ 'https://acme.teamtailor.com/jobs/123-frontend-engineer/applications/new': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'needs_user', JSON.stringify(outcome))
    assert.ok(outcome.filled.includes('Resume upload'))
    assert.equal(await page.isChecked('#terms'), false, 'terms never ticked by GhostForge')
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Thank you/)
  } finally { await page.close() }
})

test('LinkedIn Easy Apply: dialog with Next / Review / Submit application', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><h1>Frontend Engineer</h1><button type="button" class="jobs-apply-button" onclick="document.getElementById('d').style.display='block'">Easy Apply</button>
    <div id="d" role="dialog" aria-modal="true" style="display:none"><div id="steps"></div></div>
    <script>
      const steps = [
        '<h3>Contact info</h3><label for="ph">Mobile phone number *</label><input id="ph" required><label for="em">Email address *</label><select id="em" required><option>Select an option</option><option>jane@example.com</option></select><button type="button" class="next">Next</button>',
        '<h3>Resume</h3><label for="r">Upload resume</label><input id="r" type="file"><button type="button" class="next">Review</button>',
        '<h3>Review your application</h3><button type="button" class="next">Submit application</button>',
      ]
      let s = 0
      const render = () => { document.getElementById('steps').innerHTML = steps[s]; document.querySelector('.next').onclick = () => { if (s === steps.length - 1) { document.getElementById('d').innerHTML = '<p>Your application was sent to Acme!</p>' } else { s++; render() } } }
      render()
    </script></body>`
  const { outcome, page } = await runOn({ 'https://www.linkedin.com/jobs/view/123': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.ok(outcome.filled.some(l => /Mobile phone/.test(l)))
  } finally { await page.close() }
})

test('a closed posting is reported as closed, not as a form to finish', async t => {
  if (!browser) return t.skip('no Chromium available')
  const { outcome, page } = await runOn({ 'https://jobs.lever.co/acme/gone': '<!doctype html><body><h1>Sorry, this job is no longer accepting applications.</h1></body>' }, await ctxFor())
  try {
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.closed, true)
  } finally { await page.close() }
})

// ── review regressions ───────────────────────────────────────────────────────

test('regression: page errors after Submit (navigation) end as "check it", never as a retryable failure', async t => {
  if (!browser) return t.skip('no Chromium available')
  const page = await browser.newPage()
  try {
    await page.setContent(`<form><label for="fn">First name *</label><input id="fn" required>
      <button type="button" onclick="window.__sent = true">Submit application</button></form>`)
    // Simulate a navigation tearing down the page context once Submit was pressed
    const evaluate = page.evaluate.bind(page)
    const destroyed = () => new Error('Execution context was destroyed, most likely because of a navigation')
    page.evaluate = async (fn, arg) => { if (await evaluate(() => window.__sent === true).catch(() => false)) throw destroyed(); return evaluate(fn, arg) }
    page.waitForFunction = async () => { throw destroyed() }
    const out = await runFormAgent(page, await ctxFor())
    assert.equal(out.status, 'needs_user', JSON.stringify(out))
    assert.equal(out.submitPressed, true)
    assert.match(out.message, /Submit was pressed/)
  } finally { await page.close() }
})

test('regression: Submit is never pressed a second time when no confirmation appears', async t => {
  if (!browser) return t.skip('no Chromium available')
  const page = await browser.newPage()
  try {
    // A slow site: the press is accepted but nothing on the page changes in time
    await page.setContent(`<form><label for="fn">First name *</label><input id="fn" required>
      <button type="button" onclick="window.__clicks = (window.__clicks || 0) + 1">Submit application</button></form>`)
    page.waitForFunction = async () => { throw new Error('timeout') }
    const out = await runFormAgent(page, await ctxFor())
    assert.equal(await page.evaluate(() => window.__clicks), 1, 'pressed exactly once')
    assert.equal(out.status, 'needs_user', JSON.stringify(out))
    assert.equal(out.submitPressed, true)
    assert.match(out.message, /did not press it again/)
  } finally { await page.close() }
})

test('a Submit the site rejected (a field cleared as invalid) is pressed again after the fix', async t => {
  if (!browser) return t.skip('no Chromium available')
  const page = await browser.newPage()
  try {
    await page.setContent(`<form><label for="fn">First name *</label><input id="fn" required>
      <button type="button" onclick="window.__clicks = (window.__clicks || 0) + 1; const f = document.getElementById('fn');
        if (window.__clicks === 1) { f.value = ''; f.setAttribute('aria-invalid', 'true') } else { ${THANKS} }">Submit application</button></form>`)
    const realWait = page.waitForFunction.bind(page)
    let waits = 0
    page.waitForFunction = async (...args) => { if (++waits === 1) throw new Error('timeout'); return realWait(...args) }
    const out = await runFormAgent(page, await ctxFor())
    assert.equal(out.status, 'submitted', JSON.stringify(out))
    assert.equal(await page.evaluate(() => window.__clicks), 2)
  } finally { await page.close() }
})

test('regression: a field sharing its wrapper with another control keeps the wrapper label', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><form>
    <div class="form-field"><label>Phone *</label><select aria-label="Dial code"><option>+1</option><option>+49</option></select><input type="tel"></div>
    <div class="form-field"><span class="label">Email *</span><input name="hp_email" style="display:none"><input type="email"></div>
    <button type="button" onclick="${THANKS}">Submit application</button></form></body>`
  const { outcome, page } = await runOn({ 'https://careers.acme.example/apply': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.ok(outcome.filled.includes('Phone *'), 'phone answered under its wrapper label')
    assert.ok(outcome.filled.includes('Email *'), 'a hidden honeypot sibling does not hide the label')
  } finally { await page.close() }
})

test('regression: the CV only goes into a resume upload, never a transcript slot or a cloud picker', async t => {
  if (!browser) return t.skip('no Chromium available')
  const make = (label, button, id) => `<div class="upload"><span>${label}</span><button type="button" onclick="window.__clicked=(window.__clicked||[]).concat('${id}');const i=document.createElement('input');i.type='file';i.id='${id}';i.style.display='none';this.after(i);i.click()">${button}</button></div>`
  const html = `<!doctype html><body><form><label for="fn">First name *</label><input id="fn" required>
    ${make('Transcript', 'Attach', 'transcript')}${make('Resume', 'Upload from Google Drive', 'drive')}
    <button type="button" onclick="${THANKS}">Submit application</button></form></body>`
  const { outcome, page } = await runOn({ 'https://careers.acme.example/apply2': html }, await ctxFor())
  try {
    assert.ok(!outcome.filled.includes('Resume upload'), JSON.stringify(outcome))
    assert.equal(await page.evaluate(() => window.__clicked || null), null, 'neither button was pressed')
  } finally { await page.close() }

  const ok = `<!doctype html><body><form><label for="fn">First name *</label><input id="fn" required>
    ${make('Transcript', 'Attach', 'transcript')}${make('Resume / CV', 'Attach', 'resume')}
    <button type="button" onclick="${THANKS}">Submit application</button></form></body>`
  const r = await runOn({ 'https://careers.acme.example/apply3': ok }, await ctxFor())
  try {
    assert.ok(r.outcome.filled.includes('Resume upload'), JSON.stringify(r.outcome))
    assert.deepEqual(await r.page.evaluate(() => window.__clicked || null), ['resume'])
  } finally { await r.page.close() }
})

test('regression: a closed-sounding sentence in the description is not a closed posting', async t => {
  if (!browser) return t.skip('no Chromium available')
  const html = `<!doctype html><body><h1>Frontend Engineer</h1><p>${'About us. '.repeat(60)}This role is not available for visa sponsorship. The position is closed to agencies.</p>
    <button type="button" onclick="document.getElementById('f').hidden=false;this.remove()">Apply now</button>
    <form id="f" hidden><label for="fn">First name *</label><input id="fn" required><button type="button" onclick="${THANKS}">Submit application</button></form></body>`
  const { outcome, page } = await runOn({ 'https://careers.acme.example/job/7': html }, await ctxFor())
  try {
    assert.equal(outcome.status, 'submitted', JSON.stringify(outcome))
    assert.ok(!outcome.closed)
  } finally { await page.close() }
})

// ── computer use and Submit ─────────────────────────────────────────────────

/** A fake vision model that clicks the centre of `selector` and reports `submit` */
function clicker(page, selector, submit) {
  const calls = []
  const vision = async () => {
    const box = await page.locator(selector).boundingBox()
    calls.push(selector)
    return box ? JSON.stringify({ action: 'click', x: box.x + box.width / 2, y: box.y + box.height / 2, submit, why: 'test' }) : '{"action":"stop"}'
  }
  return { vision, calls }
}

// The form's own control is a bare <div> the DOM agent can't read, so computer use acts.
// The click reveals a normal Submit button afterwards.
const VISION_FORM = (label, onclick) => `<form><label for="fn">First name *</label><input id="fn" required>
  <div id="custom" style="display:inline-block;padding:8px;border:1px solid" onclick="${onclick};document.getElementById('later').style.display='inline-block'">${label}</div>
  <button type="button" id="later" style="display:none" onclick="window.__clicks = (window.__clicks || 0) + 1">Submit application</button></form>`

test('regression: a computer-use click that may have sent the form blocks a later Submit press', async t => {
  if (!browser) return t.skip('no Chromium available')
  const page = await browser.newPage()
  try {
    await page.setContent(VISION_FORM('Send it', 'window.__custom = (window.__custom || 0) + 1'))
    page.waitForFunction = async () => { throw new Error('timeout') }
    const { vision, calls } = clicker(page, '#custom', false)
    const out = await runFormAgent(page, { ...(await ctxFor()), vision })
    assert.equal(calls.length, 1)
    assert.equal(await page.evaluate(() => window.__custom), 1, 'computer use pressed the custom control')
    assert.equal(await page.evaluate(() => window.__clicks || 0), 0, 'GhostForge did not press Submit afterwards')
    assert.equal(out.status, 'needs_user', JSON.stringify(out))
    assert.equal(out.submitPressed, true)
    assert.match(out.message, /did not press it again/)
  } finally { await page.close() }
})

test('computer use reporting a submit click counts as a pressed Submit even when the control text is neutral', async t => {
  if (!browser) return t.skip('no Chromium available')
  const page = await browser.newPage()
  try {
    await page.setContent(VISION_FORM('Continue', 'window.__custom = 1'))
    page.waitForFunction = async () => { throw new Error('timeout') }
    const { vision } = clicker(page, '#custom', true)
    const out = await runFormAgent(page, { ...(await ctxFor()), vision })
    assert.equal(await page.evaluate(() => window.__clicks || 0), 0)
    assert.equal(out.status, 'needs_user', JSON.stringify(out))
  } finally { await page.close() }
})

test('a computer-use click on a neutral control does not block the real Submit', async t => {
  if (!browser) return t.skip('no Chromium available')
  const page = await browser.newPage()
  try {
    await page.setContent(VISION_FORM('Show the rest of the form', 'window.__custom = 1').replace('window.__clicks = (window.__clicks || 0) + 1', `window.__clicks = 1; ${THANKS}`))
    const { vision } = clicker(page, '#custom', false)
    const out = await runFormAgent(page, { ...(await ctxFor()), vision })
    assert.equal(out.status, 'submitted', JSON.stringify(out))
    assert.equal(await page.evaluate(() => window.__clicks), 1)
  } finally { await page.close() }
})
