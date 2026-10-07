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
test.after(() => {
  hooks.deregister()
  rmSync(home, { recursive: true, force: true })
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
