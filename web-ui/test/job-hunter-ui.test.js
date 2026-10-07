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
      const { action, id } = JSON.parse(init.body)
      state.actions.push({ action, id })
      state.active++
      state.maxActive = Math.max(state.maxActive, state.active)
      await new Promise(resolve => setTimeout(resolve, 5))
      const job = state.jobs.find(item => item.id === id)
      if (action === 'prepare') Object.assign(job, { status: 'ready', tailoredResume: 'Original CV', coverLetter: 'Basic letter', preparationWarning: 'AI writing was unavailable. Review the original CV.' })
      if (action === 'approve') job.status = id === 'job2' ? 'failed' : 'submitted'
      state.active--
      return { job, message: action === 'approve' ? id === 'job2' ? 'Synthetic browser failure' : 'Confirmed submission' : undefined }
    }
    return { jobs: state.jobs, sources: { linkedInViaJSearch: false }, model: null, autopilot: { enabled: false }, linkedin: { connected: false } }
  }
  return endpoints
}

test('multiple applications require exact selection and review confirmation, run sequentially and show each result', async () => {
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
    for (let i = 0; i < 10 && state.actions.length < 2; i++) await page.settle()
    await require('react').act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await page.settle()
    assert.deepEqual(state.actions, [{ action: 'approve', id: 'job1' }, { action: 'approve', id: 'job2' }])
    assert.equal(state.maxActive, 1)
    const results = page.document.querySelector('[aria-label="Batch application results"]')
    assert.match(results.textContent, /Confirmed submission/)
    assert.match(results.textContent, /Synthetic browser failure/)
    assert.match(page.document.querySelector('[role="alert"]').textContent, /1 submitted.*1 failed/)
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
