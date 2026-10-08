const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-jobs-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'
delete process.env.JSEARCH_API_KEY
delete process.env.RAPIDAPI_KEY
// Listings older than 30 days are dropped as stale, so fixtures are dated relative to today
const RECENT = new Date(Date.now() - 2 * 86_400_000).toISOString()

// lib/*.ts use extensionless relative imports; resolve them to the .ts/.js file.
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

const tp = require('../lib/title-profiles.ts')
const match = require('../lib/job-hunter/match.ts')
const sources = require('../lib/job-hunter/sources.ts')
const writer = require('../lib/job-hunter/writer.ts')
const cv = require('../lib/job-hunter/cv.ts')
const store = require('../lib/job-hunter/store.ts')

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 300)) // let fire-and-forget audit writes finish
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// ── title profiles & page access ────────────────────────────────────────────

test('job titles map to the right access profile', () => {
  const cases = {
    'DevOps Engineer': 'devops', 'Site Reliability Engineer': 'devops', 'IT Support Specialist': 'devops',
    'Senior Data Engineer': 'data', 'Data Analyst': 'data', 'Machine Learning Engineer': 'data',
    'Engineering Manager': 'manager', 'CTO': 'manager', 'Project Manager': 'manager',
    'Frontend Developer': 'engineer', 'Software Engineer': 'engineer', 'QA Tester': 'engineer',
    'Product Designer': 'designer', 'UX Researcher': 'designer', 'UI Engineer': 'engineer',
    'Recruiter': 'people', 'Sales Manager': 'sales', 'Customer Success Lead': 'support',
    'Accountant': 'finance', 'Student': 'student', 'Barista': 'general', '': 'general',
  }
  for (const [title, id] of Object.entries(cases)) assert.equal(tp.profileForTitle(title).id, id, title)
})

test('every profile includes the base permissions and only privileged titles get system control', () => {
  for (const p of tp.TITLE_PROFILES) {
    const perms = tp.permissionsForProfile(p)
    for (const base of tp.BASE_PERMISSIONS) assert.ok(perms.includes(base), `${p.id} missing ${base}`)
  }
  const devops = tp.permissionsForProfile(tp.getProfile('devops'))
  assert.ok(devops.includes('terminal') && devops.includes('remote') && devops.includes('mac_control'))
  const designer = tp.permissionsForProfile(tp.getProfile('designer'))
  assert.ok(!designer.includes('terminal') && !designer.includes('remote'))
  const general = tp.permissionsForProfile(tp.getProfile('general'))
  assert.ok(general.includes('job_hunter') && !general.includes('file_write'))
})

test('pages are gated by the same permissions; admins see everything', () => {
  const designer = { role: 'user', permissions: tp.permissionsForProfile(tp.getProfile('designer')) }
  assert.equal(tp.canAccessPage(designer, '/files'), true)
  assert.equal(tp.canAccessPage(designer, '/terminal'), false)
  assert.equal(tp.canAccessPage(designer, '/terminal/session'), false)
  assert.equal(tp.canAccessPage(designer, '/users'), false)
  assert.equal(tp.canAccessPage(designer, '/settings'), true)
  assert.equal(tp.canAccessPage(designer, '/jobs'), true)
  assert.equal(tp.canAccessPage(designer, '/login'), true) // not in the catalog
  const admin = { role: 'admin', permissions: ['*'] }
  for (const page of tp.PAGE_ACCESS) assert.equal(tp.canAccessPage(admin, page.path), true, page.path)
  assert.equal(tp.canAccessPage(null, '/files'), false)
})

// ── matching ─────────────────────────────────────────────────────────────────

test('remote jobs must be open to where the applicant lives', () => {
  const prefs = { locations: ['Remote'], remote: 'remote' }
  const home = ['Tokyo', 'Japan']
  assert.equal(match.matchesLocation({ location: 'Worldwide', remote: true }, prefs, home), true)
  assert.equal(match.matchesLocation({ location: 'LATAM, Europe, APAC', remote: true }, prefs, home), true)
  assert.equal(match.matchesLocation({ location: 'Japan, Vietnam', remote: true }, prefs, home), true)
  assert.equal(match.matchesLocation({ location: 'Singapore', remote: true }, prefs, home), false)
  assert.equal(match.matchesLocation({ location: 'USA only', remote: true }, prefs, home), false)
  assert.equal(match.matchesLocation({ location: 'Tokyo, Japan', remote: false }, prefs, home), false)
})

test('on-site and hybrid jobs match preferred places', () => {
  const prefs = { locations: ['Tokyo, Japan'], remote: 'any' }
  assert.equal(match.matchesLocation({ location: 'Tokyo', remote: false }, prefs), true)
  assert.equal(match.matchesLocation({ location: 'Minato-ku, Tokyo, Japan', remote: false }, prefs), true)
  assert.equal(match.matchesLocation({ location: 'Berlin, Germany', remote: false }, prefs), false)
  assert.equal(match.matchesLocation({ location: 'Worldwide', remote: true }, prefs), true)
  const onsite = { locations: ['Tokyo'], remote: 'onsite' }
  assert.equal(match.matchesLocation({ location: 'Worldwide', remote: true }, onsite), false)
})

test('fuzzy search results are filtered to relevant roles', () => {
  assert.equal(match.relevantTo({ title: 'Senior Frontend Engineer', description: '' }, ['frontend']), true)
  assert.equal(match.relevantTo({ title: 'Freelance Writer', description: 'Write articles' }, ['frontend']), false)
  assert.equal(match.relevantTo({ title: 'Web Developer', description: 'We need a react developer who knows CSS' }, ['react developer']), true)
})

test('dealbreakers and salary floor mark jobs as Skip', () => {
  const prefs = { dealbreakers: ['crypto'], minSalary: 100000 }
  assert.match(match.dealbreaker({ title: 'Engineer', company: 'Crypto Co', description: '', salary: '' }, prefs), /crypto/)
  assert.match(match.dealbreaker({ title: 'Engineer', company: 'A', description: '', salary: '$60k-$80k' }, prefs), /below your minimum/)
  assert.equal(match.dealbreaker({ title: 'Engineer', company: 'A', description: '', salary: '$120k-$150k' }, prefs), null)
  assert.equal(match.dealbreaker({ title: 'Engineer', company: 'A', description: '', salary: 'Competitive' }, prefs), null)
})

test('HTML entities decode once (no double unescaping)', () => {
  assert.equal(sources.stripHtml('<p>A &amp;lt;b&amp;gt; tag &amp; more</p>'), 'A &lt;b&gt; tag & more')
  assert.equal(sources.stripHtml('x &lt; y'), 'x < y')
})

test('extractJson tolerates think blocks and code fences', () => {
  assert.deepEqual(match.extractJson('<think>hmm</think>```json\n[{"i":0,"fit":"High"}]\n```'), [{ i: 0, fit: 'High' }])
  assert.deepEqual(match.extractJson('Sure! {"a":1} trailing'), { a: 1 })
  assert.equal(match.extractJson('no json here'), null)
})

test('ATS detection from apply URLs', () => {
  assert.equal(sources.detectAts('https://jobs.lever.co/acme/123'), 'lever')
  assert.equal(sources.detectAts('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1'), 'greenhouse')
  // Only the hostname counts: a company site with ?gh_jid= or a lookalike URL is not an auto-submit ATS
  assert.equal(sources.detectAts('https://stripe.com/jobs/search?gh_jid=8172508'), 'other')
  assert.equal(sources.detectAts('https://evil.example/apply?next=jobs.lever.co'), 'other')
  assert.equal(sources.detectAts('https://jobs.lever.co.evil.example/x'), 'other')
  assert.equal(sources.detectAts('not a url'), 'other')
  assert.equal(sources.detectAts('https://jobs.ashbyhq.com/acme/abc'), 'ashby')
  assert.equal(sources.detectAts('https://acme.wd5.myworkdayjobs.com/en-US/EXT/job/x'), 'workday')
  assert.equal(sources.detectAts('https://www.linkedin.com/jobs/view/123'), 'linkedin')
  assert.equal(sources.detectAts('https://careers.example.com/1'), 'other')
})

// ── writer / answers ─────────────────────────────────────────────────────────

const profile = {
  cv: { text: 'Jane Example\nSenior Engineer | Acme KK | 2021 - Present', fileName: 'cv.pdf', filePath: '/tmp/cv.pdf', uploadedAt: '' },
  applicant: {
    firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+81 90 0000 0000', city: 'Tokyo', country: 'Japan',
    linkedin: 'https://linkedin.com/in/jane', github: '', portfolio: '', workAuthorized: 'yes', needsSponsorship: 'no', howHeard: 'Job board',
  },
  preferences: { titles: [], locations: [], remote: 'any', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] },
  customAnswers: { 'Notice period': '1 month' },
  updatedAt: '',
}
const job = { title: 'Engineer', company: 'Beta', description: '' }

test('form labels are answered from the profile', () => {
  const a = l => writer.answerFor(l, profile, job)
  assert.equal(a('First Name*'), 'Jane')
  assert.equal(a('Last name'), 'Example')
  assert.equal(a('Full name'), 'Jane Example')
  assert.equal(a('Email address'), 'jane@example.com')
  assert.equal(a('LinkedIn Profile'), 'https://linkedin.com/in/jane')
  assert.equal(a('Current location'), 'Tokyo, Japan')
  assert.equal(a('Will you now or in the future require visa sponsorship?'), 'No')
  assert.equal(a('Are you legally authorized to work in this country?'), 'Yes')
  assert.equal(a('Gender'), 'Decline to self-identify')
  assert.equal(a('Notice period'), '1 month') // cached custom answer wins
  assert.equal(a('What is your favourite colour?'), '')
})

test('missing applicant fields block approval', () => {
  assert.deepEqual(writer.missingApplicantFields(profile), [])
  assert.deepEqual(writer.missingApplicantFields({ ...profile, cv: null, applicant: { ...profile.applicant, phone: '' } }), ['CV', 'Phone'])
})

test('contact details are parsed from CV text', () => {
  const d = cv.parseContactDetails('Jane Example\njane@example.com | +81 90 1234 5678 | linkedin.com/in/jane-ex | github.com/janeex\nTokyo')
  assert.equal(d.firstName, 'Jane')
  assert.equal(d.lastName, 'Example')
  assert.equal(d.email, 'jane@example.com')
  assert.equal(d.phone, '+81 90 1234 5678')
  assert.equal(d.linkedin, 'https://linkedin.com/in/jane-ex')
  assert.equal(d.github, 'https://github.com/janeex')
})

test('CV extraction rejects unsupported formats', async () => {
  await assert.rejects(cv.extractCvText('cv.exe', Buffer.from('x')), /Unsupported CV format/)
  await assert.rejects(cv.extractCvText('cv.txt', Buffer.from('too short')), /Could not read/)
})

test('long CV/job prompts retry compactly and reject empty model replies', async () => {
  const longProfile = { ...profile, cv: { ...profile.cv, text: 'CV fact\n'.repeat(2000) } }
  const longJob = { ...job, description: 'Job requirement\n'.repeat(1000) }
  for (const write of [
    ai => writer.tailorResume(longProfile, longJob, ai),
    ai => writer.writeCoverLetter(longProfile, longJob, longProfile.cv.text, ai),
  ]) {
    const prompts = []
    const output = await write(async opts => {
      prompts.push(opts)
      if (prompts.length === 1) throw new Error('gateway rejected long text')
      return 'Prepared text'
    })
    assert.equal(output, 'Prepared text')
    assert.equal(prompts.length, 2)
    assert.ok(prompts[1].prompt.length < 4200)
    assert.ok(prompts[1].prompt.length < prompts[0].prompt.length)
    assert.match(prompts[1].system, /Never invent/)
    const smallPrompts = []
    const recovered = await write(async opts => {
      smallPrompts.push(opts)
      if (smallPrompts.length < 3) throw new Error('anonymous prompt too long')
      return 'Smaller factual draft'
    })
    assert.equal(recovered, 'Smaller factual draft')
    assert.equal(smallPrompts.length, 3)
    assert.ok(smallPrompts[2].prompt.length < 2600)
    assert.match(smallPrompts[2].system, /Never invent/)
    await assert.rejects(write(async () => '  '), /empty response/)
  }
})

test('AI outage produces a persisted honest approval draft, then AI retry clears the warning', async () => {
  const jh = require('../lib/job-hunter/index.ts')
  const { prepareApplicationFiles } = require('../lib/job-hunter/apply.ts')
  const { readFile } = require('node:fs/promises')
  const user = 'fallback'
  await jh.importCv(user, 'cv.txt', Buffer.from(profile.cv.text), null)
  await jh.saveProfile(user, { applicant: profile.applicant, preferences: { ...profile.preferences, mustHaves: ['ImaginarySkill'] } })
  await jh.upsertJobs(user, [{ ...job, key: 'fallback', source: 'test', location: 'Worldwide', remote: true, salary: '', url: '', applyUrl: 'http://127.0.0.1/', ats: 'lever', postedAt: '', fit: 'High', score: 90, reasons: '' }])
  const [found] = await jh.listJobs(user)
  const prepared = await jh.prepareJob(user, found.id, async () => { throw new Error('No AI model answered') })
  assert.equal(prepared.status, 'ready')
  assert.equal(prepared.tailoredResume, profile.cv.text)
  assert.match(prepared.preparationWarning, /original CV/)
  assert.ok(!prepared.coverLetter.includes('ImaginarySkill'), 'preferences are not evidence of qualifications')
  assert.ok(prepared.answers.some(a => a.value === 'jane@example.com'))
  assert.deepEqual(await jh.getJob(user, found.id), prepared)
  await assert.rejects(jh.approveJob(user, found.id, { by: 'autopilot' }), /needs your review/)
  const current = await jh.getProfile(user)
  const originalFiles = await prepareApplicationFiles(prepared, current, user)
  assert.equal(originalFiles.resumePath, current.cv.filePath)
  assert.equal(await readFile(originalFiles.coverPath, 'utf8'), prepared.coverLetter)
  // Explicit user approval can proceed, but an unsafe URL must never be opened.
  const result = await jh.approveJob(user, found.id, { by: 'user', headless: true })
  assert.equal(result.job.status, 'failed')
  assert.match(result.message, /not a public web address/)
  const aiPrepared = await jh.prepareJob(user, found.id, async ({ system }) => /cover letters/.test(system) ? 'Dear Hiring Manager,\nRegards, Jane' : '# Jane Example\nTailored experience')
  assert.equal(aiPrepared.preparationWarning, '')
  const files = await prepareApplicationFiles(aiPrepared, current, user)
  assert.ok(files.resumePath.endsWith('tailored-cv.docx'))
  assert.notEqual(files.resumePath, current.cv.filePath)
  const mammoth = require('mammoth')
  const extracted = await mammoth.extractRawText({ path: files.resumePath })
  assert.match(extracted.value, /Tailored experience/)
  assert.equal(await readFile(files.coverPath, 'utf8'), aiPrepared.coverLetter)
})

test('after Submit was pressed, applying again needs the user\'s explicit confirmation', async () => {
  const jh = require('../lib/job-hunter/index.ts')
  const user = 'resubmit'
  await jh.importCv(user, 'cv.txt', Buffer.from(profile.cv.text), null)
  await jh.saveProfile(user, { applicant: profile.applicant })
  await jh.upsertJobs(user, [{ ...job, key: 'resubmit', source: 'test', location: 'Worldwide', remote: true, salary: '', url: '', applyUrl: 'http://127.0.0.1/', ats: 'lever', postedAt: '', fit: 'High', score: 90, reasons: '' }])
  const [found] = await jh.listJobs(user)
  await jh.updateJob(user, found.id, { status: 'needs_user', tailoredResume: 'CV', coverLetter: 'Letter', submitPressedAt: new Date().toISOString() })
  await assert.rejects(jh.approveJob(user, found.id, { by: 'user', headless: true }), /already pressed/)
  await assert.rejects(jh.approveJob(user, found.id, { by: 'autopilot', confirmResubmit: true }), /already pressed/)
  assert.equal((await jh.getJob(user, found.id)).status, 'needs_user', 'a refused approval changes nothing')
  // Confirmed by the user: it proceeds (and the unsafe test URL is still never opened)
  const result = await jh.approveJob(user, found.id, { by: 'user', headless: true, confirmResubmit: true })
  assert.match(result.message, /not a public web address/)
})

test('cover-letter failure and blank AI output still yield labelled approval drafts', async () => {
  const jh = require('../lib/job-hunter/index.ts')
  const [job] = await jh.listJobs('fallback')
  for (const generate of [
    async ({ system }) => { if (/cover letters/.test(system)) throw new Error('model offline'); return 'Tailored CV' },
    async () => '',
  ]) {
    const draft = await jh.prepareJob('fallback', job.id, generate)
    assert.equal(draft.status, 'ready')
    assert.equal(draft.tailoredResume, profile.cv.text)
    assert.ok(draft.coverLetter.trim())
    assert.ok(draft.preparationWarning)
  }
  await jh.updateJob('fallback', job.id, { status: 'submitted' })
  await assert.rejects(jh.prepareJob('fallback', job.id, async () => ''), /can't be prepared/)
})

test('concurrent application operations are rejected and locks release after errors', async () => {
  const jh = require('../lib/job-hunter/index.ts')
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const operation = jh.withJobOperation('racer', 'j1', () => waiting)
  await assert.rejects(jh.prepareJob('racer', 'j1', async () => ''), /already running/)
  await assert.rejects(jh.approveJob('racer', 'j1'), /already running/)
  await assert.rejects(jh.dismissJob('racer', 'j1'), /already running/)
  await assert.rejects(jh.answerQuestions('racer', 'j1', { Question: 'Answer' }), /already running/)
  assert.equal(await jh.withJobOperation('racer', 'j2', async () => 'independent'), 'independent')
  release()
  await operation
  await assert.rejects(jh.withJobOperation('racer', 'j1', async () => { throw new Error('failed operation') }), /failed operation/)
  assert.equal(await jh.withJobOperation('racer', 'j1', async () => 'retry'), 'retry')
})

test('partial question answers stay in Needs you until all are answered', async () => {
  const jh = require('../lib/job-hunter/index.ts')
  const [existing] = await jh.listJobs('fallback')
  await jh.updateJob('fallback', existing.id, { status: 'needs_user', questions: [{ label: 'Notice period', type: 'text', options: [] }, { label: 'Start date', type: 'text', options: [] }] })
  const partial = await jh.answerQuestions('fallback', existing.id, { 'Notice period': 'One month' })
  assert.equal(partial.status, 'needs_user')
  assert.equal(partial.questions.length, 1)
  const complete = await jh.answerQuestions('fallback', existing.id, { 'Start date': '2026-11-01' })
  assert.equal(complete.status, 'ready')
  assert.equal(complete.questions, undefined)
})

// ── pipeline (network and AI mocked) ─────────────────────────────────────────

test('source details preserve long descriptions and Lever requirement lists', async t => {
  const longDescription = `${'Detailed responsibilities. '.repeat(400)}Final requirement: TypeScript.`
  t.mock.method(globalThis, 'fetch', async url => {
    const host = new URL(String(url)).hostname
    if (host === 'api.lever.co') return Response.json([{
      text: 'Frontend Engineer', categories: { location: 'Berlin' }, hostedUrl: 'https://jobs.lever.co/example/1',
      descriptionPlain: longDescription, lists: [{ text: 'Requirements', content: '<ul><li>React</li><li>Accessibility</li></ul>' }],
      additionalPlain: 'Benefits: paid leave.',
    }])
    if (host === 'boards-api.greenhouse.io') return Response.json({ jobs: [] })
    return new Response('', { status: 404 })
  })
  const result = await sources.searchSources({ ...profile.preferences, companies: ['example'] }, [])
  assert.equal(result.jobs.length, 1)
  assert.ok(result.jobs[0].description.length > 8000)
  assert.match(result.jobs[0].description, /Final requirement: TypeScript/)
  assert.match(result.jobs[0].description, /Requirements\s+React\s+Accessibility/)
  assert.match(result.jobs[0].description, /Benefits: paid leave/)
  assert.equal(result.jobs[0].location, 'Berlin')
  const intake = require('../lib/job-hunter/intake.ts')
  const posting = intake.parsePosting(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Frontend Engineer', description: longDescription })}</script>`, 'https://example.com/job')
  assert.equal(posting.description, longDescription)
})

test('search → prepare → approve guards, end to end with mocked sources', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const host = new URL(String(url)).hostname
    const body = host === 'remotive.com'
      ? { jobs: [
          { title: 'Senior Frontend Engineer', company_name: 'Acme', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/acme/1', salary: '', description: '<p>React TypeScript Next.js</p>', publication_date: RECENT },
          { title: 'Frontend Developer', company_name: 'Singa', candidate_required_location: 'Singapore', url: 'https://example.com/2', salary: '', description: 'React', publication_date: RECENT },
          { title: 'Freelance Writer', company_name: 'Words', candidate_required_location: 'Worldwide', url: 'https://example.com/3', salary: '', description: 'Blog posts', publication_date: RECENT },
        ] }
      : host === 'remoteok.com' ? [{ legal: 'notice' }]
      : host === 'www.arbeitnow.com' ? { data: [] }
      : host === 'www.themuse.com' ? { results: [] }
      : null
    if (!body) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const jh = require('../lib/job-hunter/index.ts')
    const user = 'pipeline'
    await jh.importCv(user, 'cv.txt', Buffer.from('Jane Example\njane@example.com | +81 90 1234 5678\nSenior Frontend Engineer | Acme | 2021 - Present\nReact TypeScript Next.js Tailwind'), null)
    await jh.saveProfile(user, {
      preferences: { ...profile.preferences, titles: ['frontend'], locations: ['Remote'], remote: 'remote' },
      applicant: { city: 'Tokyo', country: 'Japan', firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+81 90 1234 5678' },
    })

    const r = await jh.runSearch(user, { generate: null, autoPrepare: 0 })
    assert.equal(r.found, 3)
    assert.equal(r.matched, 1, 'Singapore-only and irrelevant jobs are filtered out')
    const [found] = await jh.listJobs(user)
    assert.equal(found.company, 'Acme')
    assert.equal(found.ats, 'lever')
    assert.equal(found.status, 'found')

    // A second search must not duplicate or reset jobs
    const again = await jh.runSearch(user, { generate: null, autoPrepare: 0 })
    assert.equal(again.added, 0)
    assert.equal((await jh.listJobs(user)).length, 1)

    await assert.rejects(jh.approveJob(user, found.id), /prepare it before approving/)

    const fakeAi = async ({ system }) => (/cover letters/.test(system) ? 'Dear Hiring Manager,\nI led a migration — fast.\nRegards,\nJane Example' : '# Jane Example\nSenior Frontend Engineer — Acme')
    const prepared = await jh.prepareJob(user, found.id, fakeAi)
    assert.equal(prepared.status, 'ready')
    assert.ok(!prepared.coverLetter.includes('—'), 'em dashes are removed')
    assert.ok(prepared.answers.some(a => a.label === 'Email' && a.value === 'jane@example.com'))

    await jh.dismissJob(user, found.id)
    assert.equal((await jh.getJob(user, found.id)).status, 'dismissed')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('search reuses AI scores for unchanged listings and never asks the model about Skip listings', async () => {
  const realFetch = globalThis.fetch
  sources.clearSourceCache()
  globalThis.fetch = async url => {
    const host = new URL(String(url)).hostname
    const body = host === 'remotive.com'
      ? { jobs: [
          { title: 'Platform Engineer', company_name: 'Acme', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/acme/7', salary: '', description: 'Kubernetes Go platform', publication_date: RECENT },
          { title: 'Platform Engineer', company_name: 'Gamble', candidate_required_location: 'Worldwide', url: 'https://jobs.lever.co/gamble/8', salary: '', description: 'Online casino platform', publication_date: RECENT },
        ] }
      : null
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('not found', { status: 404 })
  }
  try {
    const jh = require('../lib/job-hunter/index.ts')
    const user = 'rescore'
    await jh.importCv(user, 'cv.txt', Buffer.from('Jane Example\nPlatform Engineer | Acme | 2020 - Present\nKubernetes Go Terraform'), null)
    const profile = await jh.getProfile(user)
    await jh.saveProfile(user, { preferences: { ...profile.preferences, titles: ['platform'], locations: ['Remote'], remote: 'remote', dealbreakers: ['casino'] } })
    const prompts = []
    const generate = async ({ prompt }) => {
      prompts.push(prompt)
      const n = (prompt.match(/^\[\d+\]/gm) || []).length
      return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, fit: 'High', score: 88, reasons: 'Strong Kubernetes fit' })))
    }
    await jh.runSearch(user, { generate, autoPrepare: 0 })
    assert.equal(prompts.length, 1)
    assert.ok(!prompts[0].includes('Gamble'), 'a dealbreaker listing is not sent to the model')
    const jobs = await jh.listJobs(user)
    assert.equal(jobs.find(j => j.company === 'Gamble').fit, 'Skip')
    assert.equal(jobs.find(j => j.company === 'Acme').score, 88)

    // Same CV, preferences and listing: the stored score is reused, no model call
    await jh.runSearch(user, { generate, autoPrepare: 0 })
    assert.equal(prompts.length, 1)
    assert.equal((await jh.listJobs(user)).find(j => j.company === 'Acme').score, 88)

    // Changed preferences: scored again
    await jh.saveProfile(user, { preferences: { ...(await jh.getProfile(user)).preferences, mustHaves: ['terraform'] } })
    await jh.runSearch(user, { generate, autoPrepare: 0 })
    assert.equal(prompts.length, 2)
  } finally {
    globalThis.fetch = realFetch
    sources.clearSourceCache()
  }
})

test('store keeps each user\'s jobs separate and strips path characters from usernames', async () => {
  await store.upsertJobs('alice', [{ key: 'a|b|c', source: 't', title: 'A', company: 'B', location: 'C', remote: false, salary: '', url: '', applyUrl: '', ats: 'other', description: '', postedAt: '', fit: 'High', score: 90, reasons: '' }])
  assert.equal((await store.listJobs('alice')).length, 1)
  assert.equal((await store.listJobs('bob')).length, 0)
  assert.throws(() => store.userDir('../../etc'), /Invalid username/)
  assert.throws(() => store.userDir('..'), /Invalid username/)
  assert.ok(store.userDir('jane.doe').endsWith('jane.doe'))
})

test('pinning a board clears the "unconfirmed board" mark on jobs already found by name', async () => {
  const job = { key: 'acme|engineer|remote', source: 'Ashby (acme)', title: 'Engineer', company: 'acme', location: 'Remote', remote: true, salary: '', url: 'https://jobs.ashbyhq.com/acme/1', applyUrl: 'https://jobs.ashbyhq.com/acme/1', ats: 'ashby', description: '', postedAt: '', fit: 'High', score: 90, reasons: '' }
  await store.upsertJobs('pinner', [{ ...job, trust: 'board', boardUnconfirmed: true }])
  assert.equal((await store.listJobs('pinner'))[0].boardUnconfirmed, true)
  // The user pinned "ashby:acme": the same listing now arrives without the mark
  await store.upsertJobs('pinner', [{ ...job, trust: 'official' }])
  const [after] = await store.listJobs('pinner')
  assert.equal(after.boardUnconfirmed, undefined)
  assert.equal(after.trust, 'official')
})

test('application links must be public http(s) addresses', () => {
  const { isSafeApplyUrl } = require('../lib/job-hunter/apply.ts')
  assert.equal(isSafeApplyUrl('https://jobs.lever.co/acme/1/apply'), true)
  assert.equal(isSafeApplyUrl('http://careers.example.com/job'), true)
  // Hostnames that merely start like an IPv6 prefix are ordinary public names
  for (const ok of ['https://fcbarcelona.com/jobs/1', 'https://www.fdic.gov/careers', 'https://fe80jobs.example.com/'])
    assert.equal(isSafeApplyUrl(ok), true, ok)
  for (const bad of ['http://localhost:3001/api/execute', 'http://127.0.0.1/', 'http://192.168.1.5/', 'http://10.0.0.1/', 'http://172.20.0.1/',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://printer.local/', 'not a url']) {
    assert.equal(isSafeApplyUrl(bad), false, bad)
  }
})

test('job links: IPv4-mapped IPv6 literals and private literals are refused before any request', async () => {
  const { isSafeApplyUrl } = require('../lib/job-hunter/apply.ts')
  const { fetchPublic } = require('../lib/job-hunter/intake.ts')
  for (const bad of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]:8765/', 'http://[::ffff:169.254.169.254]/latest'])
    assert.equal(isSafeApplyUrl(bad), false, bad)
  await assert.rejects(fetchPublic('http://127.0.0.1:8765/'), /not a public job link/)
  await assert.rejects(fetchPublic('http://[::ffff:7f00:1]/'), /not a public job link/)
})

test('application links that resolve to private addresses are rejected (DNS rebinding-style names)', async () => {
  const { resolvesPublicly, isPrivateAddress } = require('../lib/job-hunter/apply.ts')
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip)
  const fakeDns = map => async host => map[host] || []
  assert.equal(await resolvesPublicly('https://jobs.lever.co/a/1', fakeDns({ 'jobs.lever.co': ['104.16.0.1'] })), true)
  assert.equal(await resolvesPublicly('https://evil.example/apply', fakeDns({ 'evil.example': ['127.0.0.1'] })), false)
  assert.equal(await resolvesPublicly('https://mixed.example/apply', fakeDns({ 'mixed.example': ['104.16.0.1', '10.0.0.5'] })), false)
  assert.equal(await resolvesPublicly('https://nxdomain.example/', fakeDns({})), false)
  assert.equal(await resolvesPublicly('http://localhost/', fakeDns({ localhost: ['8.8.8.8'] })), false)
})
