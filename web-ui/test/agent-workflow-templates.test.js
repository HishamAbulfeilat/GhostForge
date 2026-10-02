const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  AgentWorkflowTemplateError,
  MAX_STORAGE_BYTES,
  MAX_TEMPLATES,
  getAgentWorkflowTemplate,
  listAgentWorkflowTemplates,
  saveAgentWorkflowTemplate,
} = require('../lib/agent-workflow-templates.js')

function validTemplate(overrides = {}) {
  return {
    name: 'Release preparation',
    title: 'Prepare release checklist',
    kind: 'feature',
    leader: 'boss',
    assignee: 'any',
    workflow: 'ordered',
    dependencies: ['T-110'],
    acceptanceCriteria: ['Run tests', 'Review changes'],
    ...overrides,
  }
}

function temporaryStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-workflow-templates-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('workflow templates are validated, persisted atomically, and isolated per admin', async t => {
  const root = temporaryStore(t)
  const saved = await saveAgentWorkflowTemplate('admin@example.test', validTemplate(), root)

  assert.match(saved.id, /^[a-f0-9-]{36}$/)
  assert.equal(saved.name, 'Release preparation')
  assert.deepEqual(listAgentWorkflowTemplates('admin@example.test', root), [saved])
  assert.deepEqual(getAgentWorkflowTemplate('admin@example.test', saved.id, root), saved)
  assert.deepEqual(listAgentWorkflowTemplates('other-admin', root), [])
  assert.equal(getAgentWorkflowTemplate('admin@example.test', '00000000-0000-0000-0000-000000000000', root), null)
})

test('workflow templates reject unsafe, malformed, and oversized fields', async t => {
  const root = temporaryStore(t)
  const invalid = [
    { name: '' },
    { title: '  ' },
    { title: '-option-like task' },
    { kind: 'shell' },
    { workflow: 'arbitrary' },
    { leader: '../outside' },
    { assignee: 'any\n--help' },
    { dependencies: ['T-1,T-2'] },
    { dependencies: ['T-1', 'T-1'] },
    { dependencies: Array.from({ length: 21 }, (_, index) => `T-${index}`) },
    { acceptanceCriteria: ['bad\u0000value'] },
    { acceptanceCriteria: Array.from({ length: 21 }, () => 'criterion') },
    { unexpected: 'command' },
  ]

  for (const overrides of invalid) {
    await assert.rejects(saveAgentWorkflowTemplate('admin', validTemplate(overrides), root), AgentWorkflowTemplateError)
  }
  await assert.rejects(
    saveAgentWorkflowTemplate('admin', validTemplate({ title: 'x'.repeat(181) }), root),
    /Task title must be/,
  )
  assert.deepEqual(listAgentWorkflowTemplates('admin', root), [])
})

test('template counts and persisted JSON size are bounded', async t => {
  const root = temporaryStore(t)
  for (let index = 0; index < MAX_TEMPLATES; index++) {
    await saveAgentWorkflowTemplate('admin', validTemplate({ name: `Template ${index}` }), root)
  }
  await assert.rejects(
    saveAgentWorkflowTemplate('admin', validTemplate({ name: 'One too many' }), root),
    error => error instanceof AgentWorkflowTemplateError && error.status === 413,
  )

  const oversizedRoot = temporaryStore(t)
  const oversizedFile = path.join(oversizedRoot, `${require('node:crypto').createHash('sha256').update('admin').digest('hex')}.json`)
  fs.writeFileSync(oversizedFile, ' '.repeat(MAX_STORAGE_BYTES + 1))
  assert.throws(() => listAgentWorkflowTemplates('admin', oversizedRoot), /Unable to read workflow templates/)
})

test('duplicate template names and corrupted stored records fail explicitly', async t => {
  const root = temporaryStore(t)
  await saveAgentWorkflowTemplate('admin', validTemplate(), root)
  await assert.rejects(
    saveAgentWorkflowTemplate('admin', validTemplate({ name: 'release preparation' }), root),
    error => error instanceof AgentWorkflowTemplateError && error.status === 409,
  )

  const file = fs.readdirSync(root).find(name => name.endsWith('.json'))
  fs.writeFileSync(path.join(root, file), '{"version":1,"templates":[{"unsafe":true}]}')
  assert.throws(() => listAgentWorkflowTemplates('admin', root), /Unable to read workflow templates/)
})
