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
    '/api/jobs/profile': { profile },
    '/api/models': { providers: [], local: {}, customModels: [] },
    '/api/jobs': (_url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body)
        state.actions.push(body.action)
        if (body.action === 'prepare') {
          state.job = { ...state.job, status: 'ready', tailoredResume: 'Jane Example original CV', coverLetter: 'Dear Hiring Manager,', answers: [{ label: 'Email', value: 'jane@example.com' }], preparationWarning: 'AI writing was unavailable. This draft uses your original CV and a basic cover letter. Review it before approving.' }
        } else if (body.action === 'approve') {
          state.job = { ...state.job, status: approveStatus }
        }
        return { job: state.job, ...(body.action === 'approve' ? { message: approveStatus === 'submitted' ? 'Submitted to Acme' : approveStatus === 'failed' ? 'No Chrome or Edge found' : 'A captcha needs your attention' } : {}) }
      }
      return { jobs: [state.job], sources: { linkedInViaJSearch: false }, model: null, autopilot: { enabled: false, intervalHours: 12, dailyLimit: 5, minScore: 75, mode: 'safe', linkedinEasyApply: false, linkedinDailyLimit: 5, laptopControl: false, submittedToday: 0 }, linkedin: { connected: false, connectedAt: null } }
    },
  }
}

test('Prepare opens the honest draft review; approval moves a confirmed job to Applied', async () => {
  const state = { job: { ...baseJob }, actions: [] }
  const page = await renderPage('jobs/page.tsx', routes(state))
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
    await page.click(el => text(el) === 'Approve & apply')
    assert.deepEqual(state.actions, ['prepare', 'approve'])
    assert.match(page.document.body.textContent, /Submitted to Acme/)
    await page.click(el => text(el) === '\u2190 Back to jobs')
    const applied = page.document.querySelector('[role="tab"][aria-selected="true"]')
    assert.match(applied.textContent, /Applied.*1/)
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
