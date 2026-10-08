const test = require('node:test')
const assert = require('node:assert/strict')
const { renderPage } = require('./a11y-harness.js')

const profile = {
  cv: { fileName: 'cv.txt', uploadedAt: '', preview: 'Jane Example', length: 100 },
  applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+1 555 0100', city: 'Berlin', country: 'Germany', linkedin: '', github: '', portfolio: '', workAuthorized: 'yes', needsSponsorship: 'no', howHeard: '' },
  preferences: { titles: ['Engineer'], locations: ['Remote'], remote: 'remote', minSalary: null, mustHaves: [], niceToHaves: [], companies: [], dealbreakers: [] },
  customAnswers: {},
}
const baseJob = { id: 'job1', key: 'job1', title: 'Engineer', company: 'Acme', source: 'test', location: 'Remote', remote: true, fit: 'High', score: 90, reasons: 'Match', status: 'found', ats: 'lever', description: 'Engineering', url: 'https://example.com/job', applyUrl: 'https://example.com/apply', salary: '', postedAt: '', log: [], createdAt: '', updatedAt: '' }
const text = el => el.textContent.trim()

function routes(state, approveStatus = 'submitted') {
  return {
    '/api/jobs/job1/live': { activity: null, available: false, image: null },
    '/api/jobs/profile': { profile },
    '/api/models': { providers: [], local: {}, customModels: [] },
    '/api/jobs': (_url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body)
        state.actions.push(body.action)
        ;(state.bodies ||= []).push(body)
        if (body.action === 'prepare') {
          state.job = { ...state.job, status: 'ready', tailoredResume: 'Jane Example original CV', coverLetter: 'Dear Hiring Manager,', answers: [{ label: 'Email', value: 'jane@example.com' }], preparationWarning: 'AI writing was unavailable. This draft uses your original CV and a basic cover letter. Review it before approving.' }
        } else if (body.action === 'approve') {
          state.job = { ...state.job, status: approveStatus, activity: { phase: approveStatus === 'submitted' ? 'submitted' : approveStatus === 'failed' ? 'failed' : 'captcha', message: 'Application result', updatedAt: '' } }
        }
        return { job: state.job, ...(body.action === 'approve' ? { message: approveStatus === 'submitted' ? 'Submitted to Acme' : approveStatus === 'failed' ? 'No Chrome or Edge found' : 'A captcha needs your attention' } : {}) }
      }
      return { jobs: [state.job], sources: { linkedInViaJSearch: false }, model: null, autopilot: { enabled: false, intervalHours: 12, dailyLimit: 5, minScore: 75, mode: 'safe', linkedinEasyApply: false, linkedinDailyLimit: 5, laptopControl: false, submittedToday: 0 }, linkedin: { connected: false, connectedAt: null } }
    },
  }
}

test('Prepare opens the honest draft review; approval moves a confirmed job to Applied', async () => {
  const state = { job: { ...baseJob }, actions: [] }
  const endpoints = routes(state)
  endpoints['/api/jobs/job1/live'] = { activity: { phase: 'filling', message: 'Filling earlier step', updatedAt: '' }, available: false, image: null }
  const page = await renderPage('jobs/page.tsx', endpoints)
  try {
    await page.click(el => text(el).startsWith('All matches'))
    await page.click(el => text(el) === 'Prepare')
    assert.deepEqual(state.actions, ['prepare'])
    assert.match(page.document.body.textContent, /AI writing was unavailable/)
    assert.match(page.document.body.textContent, /Original CV/)
    assert.ok([...page.document.querySelectorAll('button')].some(el => text(el) === 'Retry AI tailoring'))
    assert.ok([...page.document.querySelectorAll('button')].some(el => text(el) === 'Approve & apply' && !el.disabled))
    await page.click(el => text(el) === '\u2190 Back to jobs')
    const waiting = page.document.querySelector('[role="tab"][aria-selected="true"]')
    assert.match(waiting.textContent, /Waiting for you.*1/)
    await page.click(el => text(el) === 'Review & approve')
    await page.click(el => text(el) === 'Show browser preview')
    assert.match(page.document.querySelector('[aria-label="Application monitor"]').textContent, /Filling earlier step/)
    await page.click(el => text(el) === 'Approve & apply')
    assert.deepEqual(state.actions, ['prepare', 'approve'])
    assert.match(page.document.body.textContent, /Submitted to Acme/)
    assert.match(page.document.querySelector('[aria-label="Application monitor"]').textContent, /Submission confirmed/)
    await page.click(el => text(el) === '\u2190 Back to jobs')
    const applied = page.document.querySelector('[role="tab"][aria-selected="true"]')
    assert.match(applied.textContent, /Applied.*1/)
  } finally { await page.unmount() }
})

test('application monitor shows login blockers and requires opt-in before loading screenshots', async () => {
  const state = { job: { ...baseJob, status: 'needs_user', tailoredResume: 'CV', coverLetter: 'Letter', activity: { phase: 'login', message: 'Sign in to continue', updatedAt: '' } }, actions: [] }
  const endpoints = routes(state)
  endpoints['/api/jobs/job1/live'] = url => ({
    activity: state.job.activity, available: true,
    image: String(url).includes('preview=1') ? 'data:image/jpeg;base64,test' : null, origin: 'https://example.com',
  })
  const page = await renderPage('jobs/page.tsx', endpoints)
  try {
    await page.click(el => text(el) === 'Finish application')
    const monitor = page.document.querySelector('[aria-label="Application monitor"]')
    assert.match(monitor.textContent, /Waiting for login/)
    assert.match(monitor.textContent, /never stores your password/)
    assert.equal(monitor.querySelector('img'), null)
    await page.click(el => text(el) === 'Show browser preview')
    assert.ok(monitor.querySelector('img'))
    await page.click(el => text(el) === 'Hide browser preview')
    assert.equal(monitor.querySelector('img'), null)
    assert.deepEqual(state.actions, [], 'preview does not authorize applying or login')
  } finally { await page.unmount() }
})

test('monitor polls progress immediately while approval is still running', async () => {
  const state = { job: { ...baseJob, status: 'ready', tailoredResume: 'CV', coverLetter: 'Letter' }, actions: [] }
  const endpoints = routes(state)
  const jobsHandler = endpoints['/api/jobs']
  let finish
  endpoints['/api/jobs'] = (url, init) => {
    if (init?.method === 'POST' && JSON.parse(init.body).action === 'approve') {
      return new Promise(resolve => { finish = () => resolve(jobsHandler(url, init)) })
    }
    return jobsHandler(url, init)
  }
  endpoints['/api/jobs/job1/live'] = { activity: { phase: 'waiting_ai', message: 'Waiting for AI answers', updatedAt: '' }, available: true, image: null }
  const page = await renderPage('jobs/page.tsx', endpoints)
  try {
    await page.click(el => text(el) === 'Review & approve')
    await page.click(el => text(el) === 'Approve & apply')
    const monitor = page.document.querySelector('[aria-label="Application monitor"]')
    assert.match(monitor.textContent, /Waiting for AI answers/)
    assert.equal(monitor.querySelector('img'), null)
    await require('react').act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 0)) })
    await page.settle()
    assert.match(monitor.textContent, /Submission confirmed/)
  } finally { await page.unmount() }
})

test('account assistance requires origin consent, clears passwords and never approves an application', async () => {
  const state = { job: { ...baseJob, status: 'needs_user', tailoredResume: 'CV', coverLetter: 'Letter', activity: { phase: 'login', message: 'Sign in', updatedAt: '' } }, actions: [] }
  const endpoints = routes(state)
  const requests = []
  endpoints['/api/jobs/job1/live'] = { activity: state.job.activity, available: true, origin: 'https://example.com', image: null }
  endpoints['/api/jobs/job1/account'] = (_url, init) => {
    requests.push(JSON.parse(init.body))
    return requests.length === 1
      ? { message: 'Signup fields filled. Complete terms and verification in the browser.' }
      : { message: 'Terms require your review; registration paused.', notification: 'unavailable' }
  }
  const page = await renderPage('jobs/page.tsx', endpoints)
  const change = async (input, value) => {
    await require('react').act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value)
      input.dispatchEvent(new page.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
    await page.settle()
  }
  try {
    await page.click(el => text(el) === 'Finish application')
    const details = page.document.querySelector('[aria-label="Application monitor"] details')
    assert.ok(details)
    assert.match(details.textContent, /https:\/\/example.com/)
    const button = details.querySelector('button[type="submit"]')
    assert.equal(button.disabled, true)
    await change(details.querySelector('select'), 'fill-signup')
    await change(details.querySelector('input[type="email"]'), 'jane@example.com')
    await change(details.querySelector('input[type="password"]'), 'Test-only-secret!42')
    await page.click(el => el === details.querySelector('input[type="checkbox"]'))
    assert.equal(button.disabled, false)
    await require('react').act(async () => details.querySelector('form').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true })))
    await page.settle()
    assert.deepEqual(requests, [{ mode: 'fill-signup', origin: 'https://example.com', consent: true, email: 'jane@example.com', password: 'Test-only-secret!42' }])
    assert.equal(details.querySelector('input[type="password"]').value, '')
    assert.match(details.textContent, /Complete terms and verification/)
    await change(details.querySelector('select'), 'register')
    assert.equal(button.disabled, true, 'each registration requires fresh consent')
    await change(details.querySelector('input[type="password"]'), 'Test-only-secret!42')
    await page.click(el => el === details.querySelector('input[type="checkbox"]'))
    assert.match(details.textContent, /including submitting registration once/)
    assert.equal(button.textContent, 'Approve automatic registration')
    await require('react').act(async () => details.querySelector('form').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true })))
    await page.settle()
    assert.equal(requests[1].mode, 'register')
    assert.match(details.querySelector('[role="alert"]').textContent, /Terms require your review/)
    assert.match(details.textContent, /Phone push is not configured/)
    assert.equal(button.disabled, true)
    assert.equal(details.querySelector('input[type="password"]').value, '')
    assert.deepEqual(state.actions, [])
  } finally { await page.unmount() }
})

test('approval reports failures and human blockers, never as Applied', async () => {
  for (const status of ['failed', 'needs_user']) {
    const state = { job: { ...baseJob, status: 'ready', tailoredResume: 'CV', coverLetter: 'Letter' }, actions: [] }
    const page = await renderPage('jobs/page.tsx', routes(state, status))
    try {
      await page.click(el => text(el) === 'Review & approve')
      await page.click(el => text(el) === 'Approve & apply')
      if (status === 'failed') {
        assert.match(page.document.querySelector('[role="alert"]').textContent, /No Chrome or Edge/)
      } else {
        assert.match(page.document.body.textContent, /captcha needs your attention/)
      }
      await page.click(el => text(el) === '\u2190 Back to jobs')
      assert.match(page.document.querySelector('[role="tab"][aria-selected="true"]').textContent, /Waiting for you.*1/)
      assert.ok([...page.document.querySelectorAll('[role="tab"]')].some(el => /Applied.*0/.test(el.textContent)))
    } finally { await page.unmount() }
  }
})

test('a job whose Submit was already pressed needs an explicit check before applying again', async () => {
  const state = { job: { ...baseJob, status: 'needs_user', tailoredResume: 'CV', coverLetter: 'Letter', submitPressedAt: '2026-10-01T12:00:00Z' }, actions: [] }
  const page = await renderPage('jobs/page.tsx', routes(state, 'needs_user'))
  try {
    await page.click(el => el.getAttribute('role') === 'tab' && /Waiting for you/.test(text(el)))
    await page.click(el => el.tagName === 'BUTTON' && text(el).includes('Engineer') && text(el).includes('Acme'))
    assert.match(page.document.body.textContent, /Submit was already pressed for this application on 2026-10-01/)
    const button = () => [...page.document.querySelectorAll('button')].find(el => text(el) === 'Open & fill again')
    assert.equal(button().disabled, true, 'applying again is blocked until the user confirms')
    await page.click(el => el.type === 'checkbox' && /it was not sent/.test(el.parentElement.textContent))
    assert.equal(button().disabled, false)
    await page.click(el => el === button())
    assert.deepEqual(state.actions, ['approve'])
    assert.equal(state.bodies[0].confirmResubmit, true)
  } finally { await page.unmount() }
})

test('job cards and review expose source details before preparing an application', async () => {
  const description = 'Responsibilities:\nBuild accessible React interfaces.\n\nRequirements:\nTypeScript and component testing.\n<script>malicious()</script>'
  const state = { job: { ...baseJob, location: 'Berlin, Germany', salary: 'EUR 70,000-90,000/year', postedAt: '2026-10-01T12:00:00Z', description }, actions: [] }
  const page = await renderPage('jobs/page.tsx', routes(state))
  try {
    await page.click(el => text(el).startsWith('All matches'))
    assert.match(page.document.body.textContent, /EUR 70,000-90,000\/year/)
    assert.match(page.document.body.textContent, /Posted 2026-10-01/)
    await page.click(el => text(el).includes('Engineer') && text(el).includes('Acme'))
    const details = [...page.document.querySelectorAll('section')].find(el => el.querySelector('h2')?.textContent === 'Job details')
    assert.ok(details)
    for (const expected of ['Berlin, Germany', 'EUR 70,000-90,000/year', '2026-10-01', 'Responsibilities:', 'Requirements:', 'TypeScript and component testing.']) {
      assert.ok(details.textContent.includes(expected), expected)
    }
    assert.equal(details.querySelector('script'), null, 'description is escaped text, not executable HTML')
    assert.equal([...details.querySelectorAll('a')].find(a => a.textContent.includes('Original posting')).href, baseJob.url)
    assert.equal([...details.querySelectorAll('a')].find(a => a.textContent.includes('Application page')).href, baseJob.applyUrl)
    assert.deepEqual(state.actions, [], 'reading details does not prepare or apply')
  } finally { await page.unmount() }
})

test('missing posting fields are labelled rather than invented', async () => {
  const state = { job: { ...baseJob, location: '', remote: false, salary: '', postedAt: '', description: '' }, actions: [] }
  const page = await renderPage('jobs/page.tsx', routes(state))
  try {
    await page.click(el => text(el).startsWith('All matches'))
    await page.click(el => text(el).includes('Engineer') && text(el).includes('Acme'))
    assert.match(page.document.body.textContent, /Not marked remote by source/)
    assert.match(page.document.body.textContent, /The source did not provide a description/)
    assert.match(page.document.body.textContent, /Not provided/)
  } finally { await page.unmount() }
})

function batchRoutes(state) {
  const endpoints = routes({ job: baseJob, actions: [] })
  endpoints['/api/jobs'] = async (_url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body)
      const { action, id } = body
      state.actions.push(action.startsWith('batch-') ? { action, items: body.items } : { action, id })
      state.active++
      state.maxActive = Math.max(state.maxActive, state.active)
      await new Promise(resolve => setTimeout(resolve, 5))
      state.active--
      if (action === 'batch-apply') {
        // The server queues the confirmed jobs; nothing is applied in the browser
        state.batch = { id: 'b1', state: 'running', createdAt: '', updatedAt: '', worker: null,
          items: body.items.map(item => { const job = state.jobs.find(j => j.id === item.id); return { id: job.id, title: job.title, company: job.company, materials: 'x', confirmResubmit: Boolean(item.confirmResubmit), state: 'queued' } }) }
        return { batch: state.batch }
      }
      if (action === 'batch-cancel') {
        state.batch = { ...state.batch, state: 'cancelled', items: state.batch.items.map(i => i.state === 'queued' ? { ...i, state: 'cancelled', message: 'Cancelled before it started' } : i) }
        return { batch: state.batch }
      }
      const job = state.jobs.find(item => item.id === id)
      if (action === 'prepare') Object.assign(job, { status: 'ready', tailoredResume: 'Original CV', coverLetter: 'Basic letter', preparationWarning: 'AI writing was unavailable. Review the original CV.' })
      return { job }
    }
    return { jobs: state.jobs, sources: { linkedInViaJSearch: false }, model: null, autopilot: { enabled: false }, linkedin: { connected: false }, batch: state.batch || null }
  }
  return endpoints
}

test('multiple applications require exact selection and review confirmation, then run on the server', async () => {
  const state = { jobs: [1, 2, 3].map(n => ({ ...baseJob, id: `job${n}`, title: `Engineer ${n}`, status: 'ready', tailoredResume: `CV ${n}`, coverLetter: `Letter ${n}`, preparationWarning: n === 2 ? 'Original-CV draft requires review' : '' })), actions: [], active: 0, maxActive: 0 }
  const page = await renderPage('jobs/page.tsx', batchRoutes(state))
  try {
    await page.click(el => el.getAttribute('aria-label') === 'Select Engineer 1 at Acme')
    await page.click(el => el.getAttribute('aria-label') === 'Select Engineer 2 at Acme')
    await page.click(el => text(el) === 'Review selected applications')
    assert.deepEqual(state.actions, [], 'selection and review do not submit')
    const review = page.document.querySelector('[aria-label="Confirm selected applications"]')
    assert.match(review.textContent, /CV 1/)
    assert.match(review.textContent, /Letter 2/)
    assert.match(review.textContent, /Original-CV draft requires review/)
    assert.equal(review.textContent.includes('Engineer 3'), false)
    await page.click(el => text(el) === 'Cancel batch approval')
    assert.deepEqual(state.actions, [])
    await page.click(el => text(el) === 'Review selected applications')
    await page.click(el => text(el) === 'Confirm & apply to 2 selected jobs')
    await require('react').act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await page.settle()
    // One request hands exactly the confirmed jobs to the server queue; the tab never approves them itself
    assert.deepEqual(state.actions, [{ action: 'batch-apply', items: [{ id: 'job1' }, { id: 'job2' }] }])
    const progress = page.document.querySelector('[aria-label="Batch applications on the server"]')
    assert.match(progress.textContent, /0 of 2 done.*You can close this page/)
    assert.match(page.document.querySelector('[aria-label="Batch application results"]').textContent, /Engineer 1 at Acme · Queued/)
    assert.match(page.document.body.textContent, /Applying to 2 confirmed jobs on the server, one at a time/)
  } finally { await page.unmount() }
})

test('a batch running on the server shows its progress after the page is reopened, and can be cancelled', async () => {
  const state = { jobs: [1, 2, 3].map(n => ({ ...baseJob, id: `job${n}`, title: `Engineer ${n}`, status: n === 1 ? 'submitted' : n === 2 ? 'submitting' : 'ready', tailoredResume: 'CV', coverLetter: 'Letter' })), actions: [], active: 0, maxActive: 0 }
  state.batch = { id: 'b1', state: 'running', createdAt: '', updatedAt: '', worker: null, items: [
    { id: 'job1', title: 'Engineer 1', company: 'Acme', materials: 'x', confirmResubmit: false, state: 'submitted', message: 'Confirmed submission' },
    { id: 'job2', title: 'Engineer 2', company: 'Acme', materials: 'x', confirmResubmit: false, state: 'running', message: 'Applying' },
    { id: 'job3', title: 'Engineer 3', company: 'Acme', materials: 'x', confirmResubmit: false, state: 'queued' },
  ] }
  const page = await renderPage('jobs/page.tsx', batchRoutes(state))
  try {
    const progress = page.document.querySelector('[aria-label="Batch applications on the server"]')
    assert.match(progress.textContent, /1 of 3 done\. Applying to Engineer 2 at Acme/)
    assert.match(progress.textContent, /Engineer 1 at Acme · Applied: Confirmed submission/)
    await page.click(el => text(el) === 'Cancel remaining')
    assert.deepEqual(state.actions.map(a => a.action), ['batch-cancel'])
    assert.match(progress.textContent, /Last batch \(cancelled\)/)
    assert.match(progress.textContent, /Engineer 3 at Acme · Cancelled/)
  } finally { await page.unmount() }
})

test('batch confirmation needs a per-job "it was not sent" tick when Submit was already pressed', async () => {
  const state = { jobs: [1, 2].map(n => ({ ...baseJob, id: `job${n}`, title: `Engineer ${n}`, status: n === 1 ? 'needs_user' : 'ready', tailoredResume: 'CV', coverLetter: 'Letter', submitPressedAt: n === 1 ? '2026-10-01T10:00:00.000Z' : undefined })), actions: [], active: 0, maxActive: 0 }
  const page = await renderPage('jobs/page.tsx', batchRoutes(state))
  try {
    await page.click(el => el.getAttribute('aria-label') === 'Select Engineer 1 at Acme')
    await page.click(el => el.getAttribute('aria-label') === 'Select Engineer 2 at Acme')
    await page.click(el => text(el) === 'Review selected applications')
    const confirm = () => [...page.document.querySelectorAll('button')].find(el => text(el) === 'Confirm & apply to 2 selected jobs')
    assert.equal(confirm().disabled, true, 'blocked until the pressed job is checked')
    assert.match(page.document.querySelector('[aria-label="Confirm selected applications"]').textContent, /Submit was already pressed/)
    await page.click(el => el.getAttribute('aria-label') === 'I checked: Engineer 1 at Acme was not sent. Fill and submit it again.')
    assert.equal(confirm().disabled, false)
    await page.click(el => text(el) === 'Confirm & apply to 2 selected jobs')
    await require('react').act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await page.settle()
    assert.deepEqual(state.actions, [{ action: 'batch-apply', items: [{ id: 'job1', confirmResubmit: true }, { id: 'job2' }] }])
  } finally { await page.unmount() }
})

test('bulk preparation never approves and requires review of fallback drafts before applying', async () => {
  const state = { jobs: [1, 2].map(n => ({ ...baseJob, id: `job${n}`, title: `Engineer ${n}` })), actions: [], active: 0, maxActive: 0 }
  const page = await renderPage('jobs/page.tsx', batchRoutes(state))
  try {
    await page.click(el => text(el).startsWith('All matches'))
    await page.click(el => el.getAttribute('aria-label') === 'Select Engineer 1 at Acme')
    await page.click(el => el.getAttribute('aria-label') === 'Select Engineer 2 at Acme')
    assert.equal([...page.document.querySelectorAll('button')].find(el => text(el) === 'Review selected applications').disabled, true)
    await page.click(el => text(el) === 'Prepare / retry AI for selected')
    await require('react').act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await page.settle()
    assert.deepEqual(state.actions, [{ action: 'prepare', id: 'job1' }, { action: 'prepare', id: 'job2' }])
    assert.equal(state.maxActive, 1)
    assert.equal([...page.document.querySelectorAll('button')].find(el => text(el) === 'Review selected applications').disabled, false)
    assert.equal(page.document.querySelector('[aria-label="Confirm selected applications"]'), null)
  } finally { await page.unmount() }
})
