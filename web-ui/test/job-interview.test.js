const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-interview-'))
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

const jh = require('../lib/job-hunter/index.ts')
const iv = require('../lib/job-hunter/interview.ts')
const { requirementsExcerpt } = require('../lib/job-hunter/match.ts')

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 200))
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const CV = `Jane Example
Senior Frontend Engineer, Acme (2021 - Present)
- Rebuilt the checkout in React and TypeScript, cutting page load time by 40%
- Mentored 3 junior engineers on accessibility reviews
Skills: React, TypeScript, Jest`

const JOB = {
  title: 'Staff Frontend Engineer', company: 'Beta',
  description: `Beta builds payments software.\nRequirements:\n- Deep experience with React and TypeScript\n- Experience leading accessibility work\n- Kubernetes operations experience\nBenefits:\nGood coffee`,
}

test('requirementsExcerpt reads the requirements section, not the company blurb', () => {
  const r = requirementsExcerpt(JOB.description)
  assert.match(r, /React and TypeScript/)
  assert.match(r, /Kubernetes/)
  assert.doesNotMatch(r, /payments software|coffee/)
  // No headings: requirement-like lines, then the description itself
  assert.equal(requirementsExcerpt('We are great.\nYou need 3+ years of experience with Go.\nLunch.'), 'You need 3+ years of experience with Go.')
  assert.equal(requirementsExcerpt('Short text only'), 'Short text only')
})

test('model examples must quote the CV; invented quotes and metrics become gaps', () => {
  const raw = {
    questions: [
      { question: 'Tell me about a performance win.', why: 'Requires React', points: ['Rebuilt the checkout in React', 'Grew revenue by 25%'],
        star: { situation: 'Slow checkout', task: 'Speed it up', action: 'Rebuilt it in React and TypeScript', result: 'Load time down 40%' },
        evidence: 'Rebuilt the checkout in React and TypeScript, cutting page load time by 40%' },
      { question: 'How have you run Kubernetes?', points: [],
        star: { situation: 'Ran a cluster', task: 'Scale', action: 'Migrated 200 services to Kubernetes', result: 'Saved money' },
        evidence: 'Migrated 200 services to Kubernetes' },
      { question: 'Leading accessibility?', points: ['Mentored 3 junior engineers on accessibility reviews'],
        star: { situation: 'Team', task: 'Teach', action: 'Mentored engineers', result: 'Doubled audit scores in 6 weeks' },
        evidence: 'Mentored 3 junior engineers on accessibility reviews' },
      { question: '' },
    ],
    gaps: ['Kubernetes operations'],
  }
  const { questions, gaps } = iv.groundPrep(raw, CV, JOB)
  assert.equal(questions.length, 3, 'empty questions are dropped')
  assert.ok(questions[0].star, 'a quoted CV example is kept')
  assert.deepEqual(questions[0].points, ['Rebuilt the checkout in React'], 'a talking point with an invented metric is dropped')
  assert.equal(questions[1].star, undefined, 'a quote that is not in the CV is not an example')
  assert.match(questions[1].gap, /does not show/)
  assert.equal(questions[2].star, undefined, 'an example with invented numbers is dropped even when the quote is real')
  assert.match(questions[2].gap, /does not show/)
  assert.deepEqual(gaps, ['Kubernetes operations'])
})

test('without a model the outline quotes matching CV lines and names what the CV does not show', async () => {
  const prep = await iv.writeInterviewPrep(CV, JOB, null)
  assert.equal(prep.ai, false)
  assert.match(prep.warning, /basic outline/)
  const react = prep.questions.find(q => /React and TypeScript/.test(q.question))
  assert.ok(react.points.some(p => p.startsWith('Rebuilt the checkout')), 'CV lines are quoted unchanged')
  assert.ok(react.points.every(p => CV.includes(p)))
  const k8s = prep.questions.find(q => /Kubernetes/.test(q.question))
  assert.deepEqual(k8s.points, [])
  assert.match(k8s.gap, /does not show/)
  assert.ok(prep.gaps.some(g => /Kubernetes/.test(g)))
  assert.ok(prep.questions.every(q => !q.star), 'no STAR example without a model')

  // A failing model falls back to the same outline, labelled
  const failing = await iv.writeInterviewPrep(CV, JOB, async () => { throw new Error('rate limited') })
  assert.equal(failing.ai, false)
  assert.match(failing.warning, /AI writing was unavailable/)
})

test('interview prep needs a prepared application, is stored on the job and never changes its status', async () => {
  const user = 'interview-user'
  await jh.importCv(user, 'cv.txt', Buffer.from(CV), null)
  const { jobs } = await jh.upsertJobs(user, [{
    key: 'beta|staff|remote', source: 'test', title: JOB.title, company: JOB.company, location: 'Remote', remote: true, salary: '',
    url: 'https://jobs.lever.co/beta/1', applyUrl: 'https://jobs.lever.co/beta/1/apply', ats: 'lever', description: JOB.description, postedAt: '',
    fit: 'High', score: 90, reasons: '',
  }])
  const id = jobs[0].id
  await assert.rejects(iv.prepareInterview(user, id, null), /Prepare the application first/)
  await jh.updateJob(user, id, { status: 'ready', tailoredResume: '# Jane', coverLetter: 'Dear' })
  let prompt = ''
  const generate = async opts => {
    prompt = opts.prompt
    return JSON.stringify({ questions: [{ question: 'Walk me through the checkout rebuild.', why: 'React', points: ['Rebuilt the checkout in React and TypeScript'],
      star: { situation: 'Slow checkout', task: 'Improve it', action: 'Rebuilt it', result: 'Faster pages' }, evidence: 'Rebuilt the checkout in React and TypeScript' }], gaps: [] })
  }
  const job = await iv.prepareInterview(user, id, generate)
  assert.equal(job.status, 'ready')
  assert.equal(job.interviewPrep.ai, true)
  assert.equal(job.interviewPrep.questions[0].evidence, 'Rebuilt the checkout in React and TypeScript')
  assert.match(prompt, /Mentored 3 junior engineers/, 'the original CV is the source of facts')
  assert.match(prompt, /REQUIREMENTS:\n- Deep experience with React/)
})
