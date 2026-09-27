const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, readFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-career-'))
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
const im = require('../lib/job-hunter/improve.ts')
const gd = require('../lib/job-hunter/github-designs.ts')
const gp = require('../lib/job-hunter/github-profile.ts')

const realFetch = globalThis.fetch
test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 300)) // let fire-and-forget audit writes finish
  globalThis.fetch = realFetch
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const CV = 'Jane Example\njane@example.com | +81 90 1234 5678 | linkedin.com/in/jane-ex\nTokyo, Japan\n\nSenior Frontend Engineer | Acme KK | 2021 - Present\n- Led React + TypeScript migration to Next.js\nSkills: React, TypeScript, Next.js, Tailwind, Docker'

async function seed(user) {
  await jh.importCv(user, 'cv.txt', Buffer.from(CV), null)
  await jh.saveProfile(user, {
    applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+81 90 1234 5678', city: 'Tokyo', country: 'Japan', linkedin: 'https://linkedin.com/in/jane-ex' },
    preferences: { titles: ['Frontend Engineer'], locations: [], remote: 'any', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] },
  })
}

// ── CV improvement ──────────────────────────────────────────────────────────

const improveAi = async ({ system }) => (/resume coach/i.test(system)
  ? JSON.stringify({ score: 64, summary: 'Solid but thin.', strengths: ['Clear stack'], issues: ['No summary'], suggestions: ['Add a summary'] })
  : '# Jane Example\njane@example.com\n\n## Summary\nFrontend engineer leading a React and TypeScript migration to Next.js at Acme KK — focused on performance.\n\n## Experience\n### Senior Frontend Engineer | Acme KK | 2021 - Present\n- Led the **React + TypeScript** migration to Next.js\n\n## Skills\nReact, TypeScript, Next.js, Tailwind, Docker')

test('CV improvement reviews, rewrites, and never replaces the CV until adopted', async () => {
  const user = 'improver'
  await seed(user)
  const r = await im.improveCv(user, improveAi)
  assert.equal(r.review.score, 64)
  assert.deepEqual(r.review.issues, ['No summary'])
  assert.ok(!r.text.includes('—'), 'em dashes are removed')
  let p = await jh.getProfile(user)
  assert.equal(p.cv.fileName, 'cv.txt', 'the active CV is unchanged')
  assert.ok(p.improvedCv)

  const adopted = await im.adoptImprovedCv(user)
  assert.match(adopted.fileName, /jane-example-cv-improved\.docx$/)
  assert.ok(existsSync(adopted.filePath))
  assert.equal(readFileSync(adopted.filePath).subarray(0, 2).toString(), 'PK', 'a real .docx (zip) file')
  p = await jh.getProfile(user)
  assert.equal(p.cv.text, p.improvedCv.text)
  assert.equal(p.originalCv.fileName, 'cv.txt')

  // Improving again works from the user's own words, not the rewrite
  let seenCv = ''
  await im.improveCv(user, async o => { if (/resume coach/i.test(o.system)) seenCv = o.prompt; return improveAi(o) })
  assert.match(seenCv, /Skills: React, TypeScript/)

  const restored = await im.restoreOriginalCv(user)
  assert.equal(restored.fileName, 'cv.txt')
  assert.equal((await jh.getProfile(user)).originalCv, null)
  await assert.rejects(im.restoreOriginalCv(user), /already using your original/)
})

test('uploading a new CV clears earlier improvements', async () => {
  const user = 'reupload'
  await seed(user)
  await im.improveCv(user, improveAi)
  await jh.importCv(user, 'new.txt', Buffer.from(CV + '\nNew line'), null)
  const p = await jh.getProfile(user)
  assert.equal(p.improvedCv, null)
  assert.equal(p.originalCv, null)
})

test('markdownToDocx produces a Word document', async () => {
  const buf = await im.markdownToDocx('# Name\n## Experience\n- **Bold** bullet with [link](https://example.com)\nPlain line')
  assert.equal(buf.subarray(0, 2).toString(), 'PK')
  assert.ok(buf.length > 2000)
})

// ── GitHub designs ──────────────────────────────────────────────────────────

function mockGithub(extra = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    const method = init.method || 'GET'
    calls.push({ method, path: u.pathname, auth: init.headers?.Authorization, body: init.body })
    const key = `${method} ${u.pathname}`
    if (extra[key]) return extra[key](init)
    if (key === 'GET /users/janedev') return Response.json({ login: 'janedev', name: 'Jane', bio: '', public_repos: 3 })
    if (key === 'GET /users/janedev/repos') {
      return Response.json([
        { name: 'shop-ui', description: 'Storefront in Next.js', language: 'TypeScript', stargazers_count: 12, html_url: 'https://github.com/janedev/shop-ui', fork: false, pushed_at: '2026-09-01' },
        { name: 'forked-lib', description: 'fork', language: 'JS', stargazers_count: 99, html_url: 'https://github.com/janedev/forked-lib', fork: true },
        { name: 'janedev', description: 'profile', fork: false, html_url: 'https://github.com/janedev/janedev' },
      ])
    }
    return new Response('not found', { status: 404 })
  }
  return calls
}

const designAi = async () => JSON.stringify({
  name: 'Jane Example', headline: 'Frontend engineer building fast React apps', about: ['I build web apps.', 'I care about performance.'],
  typingLines: ['Frontend engineer', 'React + TypeScript'], skills: ['React', 'TypeScript', 'Next.js', 'Tailwind', 'Docker', 'Storybook'],
  highlights: ['Led the React + TypeScript migration to Next.js'], focus: ['Learning Rust'],
  timeline: [{ period: '2021 - Present', role: 'Senior Frontend Engineer', org: 'Acme KK' }],
  recommendedStyle: 'visual', why: 'You are a frontend engineer, so a visual showcase fits.',
  bio: 'Frontend engineer · React · TypeScript', location: 'Tokyo, Japan', company: 'Acme KK', blog: '',
})

test('design heuristics pick a style that fits the person', () => {
  assert.equal(gd.heuristicStyle(['Kubernetes', 'Terraform'], 'SRE'), 'terminal')
  assert.equal(gd.heuristicStyle(['Figma'], 'Product Designer'), 'visual')
  assert.equal(gd.heuristicStyle([], 'Engineering Manager'), 'story')
  assert.equal(gd.heuristicStyle([], 'Research Scientist'), 'minimal')
  assert.equal(gd.heuristicStyle(['Java'], 'Developer'), 'badges')
})

test('generates every design from real data, recommended first, with valid widget URLs', async () => {
  const user = 'designer'
  await seed(user)
  mockGithub()
  const set = await gd.generateGithubDesigns(user, 'janedev', { notes: '' }, designAi)
  assert.equal(set.username, 'janedev')
  assert.deepEqual(set.designs.map(d => d.style), ['visual', 'minimal', 'badges', 'terminal', 'story'])
  assert.equal(set.designs[0].recommended, true)
  assert.match(set.designs[0].why, /frontend engineer/)

  const visual = set.designs[0].readme
  // Exact substrings (not URL regexes): these check README text, not hosts
  const has = (text, s) => assert.ok(text.includes(s), `missing: ${s}`)
  has(visual, 'https://skillicons.dev/icons?i=react,ts,nextjs,tailwind,docker&theme=dark')
  has(visual, 'https://github-profile-summary-cards.vercel.app/api/cards/stats?username=janedev')
  has(visual, 'https://ghchart.rshah.org/7aa2f7/janedev')
  for (const d of set.designs) assert.ok(!d.readme.includes('github-readme-stats') && !d.readme.includes('activity-graph'), 'services with broken public instances are not used')
  has(visual, 'https://capsule-render.vercel.app/api?')
  has(visual, '[shop-ui](https://github.com/janedev/shop-ui)')
  assert.doesNotMatch(visual, /forked-lib/, 'forks are not featured')

  const badges = set.designs.find(d => d.style === 'badges').readme
  has(badges, 'https://img.shields.io/badge/React-1f2937?style=for-the-badge&logo=react')
  has(badges, 'https://img.shields.io/badge/Storybook-1f2937')
  assert.match(set.designs.find(d => d.style === 'terminal').readme, /\$ whoami/)
  assert.match(set.designs.find(d => d.style === 'story').readme, /\| 2021 - Present \| Senior Frontend Engineer \| Acme KK \|/)
  assert.doesNotMatch(set.designs.find(d => d.style === 'minimal').readme, /!\[/, 'minimal has no images')

  const p = await jh.getProfile(user)
  assert.equal(p.githubProfile.readme, visual, 'the recommended design is loaded into the draft')
  const chosen = await gd.selectGithubDesign(user, 'terminal')
  assert.match(chosen.readme, /\$ whoami/)
  await assert.rejects(gd.selectGithubDesign(user, 'nope'), /Generate designs first/)
})

test('creative design is optional and uses the model', async () => {
  const user = 'creative'
  await seed(user)
  mockGithub()
  const ai = async o => (/creative designer/.test(o.system) ? '# ✨ Jane\n\nA hand-crafted profile with a custom layout and plenty of personality for everyone to read and enjoy.\n\n## Now\n- Learning Rust' : designAi())
  const set = await gd.generateGithubDesigns(user, 'janedev', { creative: true }, ai)
  assert.equal(set.designs.length, 6)
  assert.ok(set.designs.some(d => d.style === 'creative' && d.readme.startsWith('# ✨ Jane')))
})

test('publish creates the profile repo, commits the README and reports missing profile scope', async () => {
  const user = 'publisher'
  const calls = mockGithub({
    'GET /user': () => Response.json({ login: 'janedev' }),
    'GET /repos/janedev/janedev': () => new Response('', { status: 404 }),
    'POST /user/repos': () => Response.json({}, { status: 201 }),
    'GET /repos/janedev/janedev/contents/README.md': () => new Response('', { status: 404 }),
    'PUT /repos/janedev/janedev/contents/README.md': () => Response.json({}, { status: 201 }),
    'PATCH /user': () => new Response('', { status: 403 }),
  })
  const r = await gp.publishGithubProfile(user, 'tok_123', { username: 'janedev', readme: '# Hi', bio: 'Frontend', location: 'Tokyo', blog: '', company: '' })
  assert.equal(r.createdRepo, true)
  assert.equal(r.profileUpdated, false)
  assert.match(r.notes[0], /user/)
  assert.equal(r.repoUrl, 'https://github.com/janedev/janedev')
  const put = calls.find(c => c.method === 'PUT')
  assert.equal(JSON.parse(put.body).content, Buffer.from('# Hi').toString('base64'))
  assert.ok(calls.every(c => c.auth === 'Bearer tok_123'), 'every call is authenticated with the token')
  const created = calls.find(c => c.method === 'POST' && c.path === '/user/repos')
  assert.equal(JSON.parse(created.body).name, 'janedev')
})

test('publish updates an existing README with its sha', async () => {
  const calls = mockGithub({
    'GET /user': () => Response.json({ login: 'janedev' }),
    'GET /repos/janedev/janedev': () => Response.json({}),
    'GET /repos/janedev/janedev/contents/README.md': () => Response.json({ sha: 'abc123' }),
    'PUT /repos/janedev/janedev/contents/README.md': () => Response.json({}),
    'PATCH /user': () => Response.json({}),
  })
  const r = await gp.publishGithubProfile('publisher2', 'tok', { username: 'janedev', readme: '# Hi', bio: 'x', location: '', blog: '', company: '' })
  assert.equal(r.createdRepo, false)
  assert.equal(r.profileUpdated, true)
  assert.equal(JSON.parse(calls.find(c => c.method === 'PUT').body).sha, 'abc123')
})

test('publish refuses a token for a different account', async () => {
  mockGithub({ 'GET /user': () => Response.json({ login: 'someoneelse' }) })
  await assert.rejects(
    gp.publishGithubProfile('publisher3', 'tok', { username: 'janedev', readme: '# Hi', bio: '', location: '', blog: '', company: '' }),
    /belongs to "someoneelse"/,
  )
})

test('GitHub API URLs stay on api.github.com and only accept valid account names', () => {
  assert.equal(gp.githubApiUrl(['users', 'janedev', 'repos'], { per_page: '100' }), 'https://api.github.com/users/janedev/repos?per_page=100')
  assert.equal(gp.githubApiUrl(['repos', 'janedev', 'janedev', 'contents', 'README.md']), 'https://api.github.com/repos/janedev/janedev/contents/README.md')
  for (const bad of ['..', '@evil.com', '//evil.com', 'a/b', 'x?y', '%2e%2e', 'evil.com']) {
    assert.throws(() => gp.githubApiUrl(['users', bad]), /Invalid GitHub API path segment/, bad)
  }
})

test('GitHub usernames are validated before any request', async () => {
  for (const bad of ['', '-lead', 'trail-', 'a--b', 'has space', '../etc', 'x'.repeat(40)]) assert.equal(gp.validGithubUsername(bad), false, bad)
  for (const good of ['janedev', 'Jane-Dev', 'a1', 'x'.repeat(39)]) assert.equal(gp.validGithubUsername(good), true, good)
  await assert.rejects(gp.fetchGithubData('../../etc'), /not a valid GitHub username/)
})
