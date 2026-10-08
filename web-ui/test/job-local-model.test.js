const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const home = mkdtempSync(join(tmpdir(), 'gf-local-job-ai-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.NODE_ENV = 'test'
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (error) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + ext, context) } catch { /* next extension */ }
        }
      }
      throw error
    }
  },
})
const ai = require('../lib/ai.ts')
const providers = require('../lib/providers.ts')
test.after(() => {
  hooks.deregister()
  rmSync(home, { recursive: true, force: true })
})

test('anonymous writing uses the no-account endpoint with private POST prompts and no key', async t => {
  const requests = []
  t.mock.method(global, 'fetch', async (url, options) => {
    if (String(url) === 'https://text.pollinations.ai/openai') {
      requests.push({ url, options, body: JSON.parse(options.body) })
      return Response.json({ choices: [{ message: { content: 'A factual AI draft' } }] })
    }
    return new Response('', { status: 503 })
  })
  const chain = await ai.buildModelChain({ activeProvider: 'pollinations', activeModel: 'openai-fast', task: 'anonymous-test' })
  const entry = chain[0]
  assert.equal(entry.provider, 'pollinations')
  assert.equal(await entry.generate({ system: 'Use only CV facts', prompt: 'CV: React developer. Job: frontend engineer.', maxTokens: 2500 }), 'A factual AI draft')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.headers.Authorization, undefined)
  assert.equal(requests[0].body.max_tokens, undefined)
  assert.equal(requests[0].body.private, true)
  assert.equal(requests[0].body.stream, false)
  assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: 'Use only CV facts\n\nCV: React developer. Job: frontend engineer.' }])
})

test('anonymous authorization failures are not retried at the same key-required gateway', async t => {
  let calls = 0
  t.mock.method(global, 'fetch', async url => {
    if (String(url) === 'https://text.pollinations.ai/openai') {
      calls++
      return Response.json({ error: { message: 'Unavailable' } }, { status: 401 })
    }
    return new Response('', { status: 503 })
  })
  const chain = await ai.buildModelChain({ activeProvider: 'pollinations', activeModel: 'openai-fast', task: 'authorization-test' })
  await assert.rejects(chain[0].generate({ prompt: 'Synthetic example' }), /401/)
  assert.equal(calls, 1)
})

test('anonymous rate limits get one paced retry at the anonymous endpoint', async t => {
  const times = []
  t.mock.method(global, 'fetch', async url => {
    if (String(url) === 'https://text.pollinations.ai/openai') {
      times.push(Date.now())
      return times.length === 1
        ? Response.json({}, { status: 402 })
        : Response.json({ choices: [{ message: { content: 'Recovered AI response' } }] })
    }
    return new Response('', { status: 503 })
  })
  const chain = await ai.buildModelChain({ activeProvider: 'pollinations', activeModel: 'openai-fast', task: 'paced-retry-test' })
  assert.equal(await chain[0].generate({ prompt: 'Synthetic example' }), 'Recovered AI response')
  assert.equal(times.length, 2)
  assert.ok(times[1] - times[0] >= 14_900)
})

test('custom models retain their endpoint, credentials and token limit; automatic free selection has a separate cache', async t => {
  const custom = providers.saveCustomModel({ name: 'Existing model', baseURL: 'https://existing.example/v1', model: 'existing-model', apiKey: 'test-only-key' })
  const requests = []
  t.mock.method(global, 'fetch', async (url, options) => {
    if (String(url) === 'https://existing.example/v1/chat/completions') {
      requests.push({ options, body: JSON.parse(options.body) })
      return Response.json({ choices: [{ message: { content: 'Existing configured model still works' } }] })
    }
    return new Response('', { status: 503 })
  })
  const override = { activeProvider: 'custom', activeModel: custom.id, task: 'cache-preference-test' }
  const selected = await ai.buildModelChain(override)
  assert.equal(selected[0].provider, 'custom')
  await selected[0].generate({ system: 'Instructions', prompt: 'Synthetic job', maxTokens: 900 })
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-only-key')
  assert.equal(requests[0].body.max_tokens, 900)
  assert.equal(requests[0].body.messages[0].role, 'system')
  const automatic = await ai.buildModelChain({ ...override, preferFree: true })
  assert.equal(automatic.some(entry => entry.provider === 'custom'), false)
  assert.equal(automatic.some(entry => entry.provider === 'pollinations'), true)
})

test('installed local models precede anonymous cloud fallback in automatic mode', async t => {
  providers.saveSelection({ provider: 'ollama', model: 'test-model' })
  t.mock.method(global, 'fetch', async url => String(url).endsWith('/api/tags')
    ? Response.json({ models: [{ name: 'test-model' }] })
    : new Response('', { status: 503 }))
  const chain = await ai.buildModelChain({ preferFree: true, task: 'local-first-test' })
  const localIndex = chain.findIndex(entry => entry.provider === 'ollama')
  const anonymousIndex = chain.findIndex(entry => entry.provider === 'pollinations')
  assert.ok(localIndex >= 0 && anonymousIndex > localIndex)
  providers.clearSelection()
})

test('AI job preparation through the anonymous model creates tailored approval materials', async t => {
  const jh = require('../lib/job-hunter/index.ts')
  const user = 'anonymous-preparation'
  const prompts = []
  const requestTimes = []
  t.mock.method(global, 'fetch', async (url, options) => {
    if (String(url) === 'https://text.pollinations.ai/openai') {
      const body = JSON.parse(options.body)
      prompts.push(body.messages[0].content)
      requestTimes.push(Date.now())
      return Response.json({ choices: [{ message: { content: /personalized cover letters/.test(body.messages[0].content) ? 'Dear Hiring Manager,\nI built React interfaces.\nRegards,\nAlex Example' : '# Alex Example\nBuilt React interfaces with TypeScript.' } }] })
    }
    return new Response('', { status: 503 })
  })
  await jh.importCv(user, 'cv.txt', Buffer.from('Alex Example\nBuilt React interfaces with TypeScript.'), null)
  await jh.saveProfile(user, { model: { provider: 'pollinations', model: 'openai-fast' } })
  await jh.upsertJobs(user, [{
    key: 'anonymous-job', title: 'Frontend Engineer', company: 'Example', source: 'test', location: 'Berlin',
    remote: false, salary: '', url: 'https://example.com/job', applyUrl: 'https://example.com/apply',
    ats: 'other', description: 'React and TypeScript', postedAt: '', score: 90, fit: 'High', reasons: 'React match',
  }])
  const [job] = await jh.listJobs(user)
  const prepared = await jh.prepareJob(user, job.id)
  assert.equal(prepared.status, 'ready')
  assert.equal(Boolean(prepared.preparationWarning), false)
  assert.match(prepared.tailoredResume, /Alex Example/)
  assert.match(prepared.coverLetter, /Dear Hiring Manager/)
  assert.equal(prompts.length, 2)
  assert.ok(prompts.every(prompt => prompt.includes('React') && prompt.includes('Frontend Engineer')))
  assert.ok(requestTimes[1] - requestTimes[0] >= 14_900, 'CV and cover-letter requests respect the 15-second anonymous slot (with dispatch tolerance)')
})

test('Ollama receives the CV/job prompt and chat messages, not just the system instruction', async t => {
  const requests = []
  t.mock.method(global, 'fetch', async (url, options) => {
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'test-model' }] })
    if (String(url).endsWith('/api/chat')) {
      requests.push(JSON.parse(options.body))
      return Response.json({ message: { content: 'A tailored draft' } })
    }
    return new Response('', { status: 503 })
  })
  const chain = await ai.buildModelChain({ activeProvider: 'ollama', activeModel: 'test-model', offline: true })
  const local = chain.find(entry => entry.provider === 'ollama')
  assert.ok(local)
  assert.equal(await local.generate({ system: 'Use only CV facts', prompt: 'CV: React developer. Job: frontend engineer.' }), 'A tailored draft')
  assert.deepEqual(requests[0].messages, [
    { role: 'system', content: 'Use only CV facts' },
    { role: 'user', content: 'CV: React developer. Job: frontend engineer.' },
  ])
  await local.generate({ messages: [{ role: 'user', content: 'A follow-up question' }] })
  assert.deepEqual(requests[1].messages, [{ role: 'user', content: 'A follow-up question' }])
})
