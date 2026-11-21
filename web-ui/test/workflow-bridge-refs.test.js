const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { readFileSync } = require('node:fs')

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw error
    }
  },
})

const home = mkdtempSync(join(tmpdir(), 'gf-wf-refs-'))
const originalHome = process.env.HOME
process.env.HOME = home
const { bridgeRefError, PRODUCTION_DEPLOY_ERROR } = require('../lib/workflows/bridge-refs.ts')
const store = require('../lib/workflows/store.ts')

test.after(() => {
  hooks.deregister()
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

test('bridge ref validation accepts the bridge allowlist and non-bridge refs', () => {
  for (const ref of [
    'bridge:health', 'bridge:release-status', 'bridge:deploy', 'bridge:deploy-azure',
    'bridge:deploy:staging', 'bridge:deploy:dev:app-service', 'bridge:deploy:staging:swa',
    'npm test', 'ecc:code-reviewer', '',
  ]) {
    assert.equal(bridgeRefError(ref), null, ref)
  }
})

test('bridge ref validation refuses production and unknown bridge refs', () => {
  assert.equal(bridgeRefError('bridge:deploy:production'), PRODUCTION_DEPLOY_ERROR)
  assert.equal(bridgeRefError('bridge:deploy:Production:app-service'), PRODUCTION_DEPLOY_ERROR)
  for (const ref of ['bridge:deploy:qa', 'bridge:deploy:staging:docker', 'bridge:deploy:staging:static:x', 'bridge:shell', 'bridge:deployx']) {
    assert.notEqual(bridgeRefError(ref), null, ref)
  }
})

test('store refuses to save a workflow with a production or unknown bridge ref', async () => {
  await assert.rejects(
    store.createWorkflow('alice', { name: 'Prod', steps: [{ title: 'Ship', kind: 'command', ref: 'bridge:deploy:production:app-service' }] }),
    err => err instanceof store.WorkflowValidationError && /deploy from the CLI/.test(err.message),
  )
  await assert.rejects(
    store.createWorkflow('alice', { name: 'Bad', steps: [{ title: 'X', kind: 'command', ref: 'bridge:rm-rf' }] }),
    store.WorkflowValidationError,
  )
  assert.equal((await store.listWorkflows('alice')).length, 0)

  const wf = await store.createWorkflow('alice', { name: 'Ok', steps: [{ title: 'Health', kind: 'command', ref: 'bridge:health' }] })
  await assert.rejects(
    store.updateWorkflow('alice', wf.id, { steps: [{ title: 'Prod', kind: 'command', ref: 'bridge:deploy:production' }] }),
    store.WorkflowValidationError,
  )
  await assert.rejects(
    store.updateStep('alice', wf.id, wf.steps[0].id, { ref: 'bridge:deploy:production' }),
    store.WorkflowValidationError,
  )
  const saved = await store.getWorkflow('alice', wf.id)
  assert.equal(saved.steps[0].ref, 'bridge:health')
})

test('workflows route maps validation errors to 400', () => {
  const route = readFileSync(resolve(__dirname, '../app/api/workflows/route.ts'), 'utf8')
  assert.match(route, /instanceof WorkflowValidationError[^\n]*status: 400/)
})
