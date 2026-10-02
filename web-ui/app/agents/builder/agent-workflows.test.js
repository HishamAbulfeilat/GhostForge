const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../../../lib/agent-workflows.ts')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText
const sourceModule = new Module(sourcePath, module)
sourceModule.filename = sourcePath
sourceModule.paths = Module._nodeModulePaths(path.dirname(sourcePath))
sourceModule._compile(compiled, sourcePath)
const {
  AgentWorkflowError,
  listAgentTeamTemplates,
  listAgentWorkflowTemplates,
  normalizeAgentWorkflow,
  resolveWorkflowTaskDependencies,
  resolveWorkflowTaskDependenciesForTask,
  saveAgentWorkflowTemplate,
} = sourceModule.exports

function validWorkflow(overrides = {}) {
  return {
    name: 'Release preparation',
    description: 'Prepare and verify a release.',
    leader: 'boss',
    workers: [
      { id: 'copilot', provider: 'copilot', model: 'auto' },
      { id: 'copilot-qa', provider: 'copilot', model: 'auto' },
    ],
    mode: 'dependent',
    tasks: [
      {
        id: 'build',
        title: 'Build release',
        kind: 'feature',
        assignee: 'copilot',
        area: ['web-ui'],
        dependsOn: [],
        acceptanceCriteria: ['Build succeeds'],
      },
      {
        id: 'verify',
        title: 'Verify release',
        kind: 'test',
        assignee: 'copilot-qa',
        area: ['web-ui/test'],
        dependsOn: ['build'],
        acceptanceCriteria: ['Tests pass'],
      },
    ],
    ...overrides,
  }
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-agent-workflows-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('workflow validation checks team membership, task shape, and dependency graph', () => {
  const valid = normalizeAgentWorkflow(validWorkflow(), ['boss', 'copilot', 'copilot-qa'])
  assert.equal(valid.tasks.length, 2)

  const cases = [
    validWorkflow({ workers: [] }),
    validWorkflow({ mode: 'random' }),
    validWorkflow({ tasks: [{ ...validWorkflow().tasks[0], id: 'bad id' }] }),
    validWorkflow({ tasks: [{ ...validWorkflow().tasks[0], dependsOn: ['missing'] }] }),
    validWorkflow({ tasks: [
      { ...validWorkflow().tasks[0], dependsOn: ['verify'] },
      validWorkflow().tasks[1],
    ] }),
    validWorkflow({ tasks: [
      validWorkflow().tasks[0],
      { ...validWorkflow().tasks[1], dependsOn: ['verify'] },
    ] }),
    validWorkflow({ tasks: [{ ...validWorkflow().tasks[0], assignee: 'disabled-agent' }] }),
  ]
  for (const value of cases) assert.throws(() => normalizeAgentWorkflow(value, ['boss', 'copilot', 'copilot-qa']), AgentWorkflowError)
})

test('launch dependency mapping retains local edges as real task IDs and preserves external edges', () => {
  const workflow = normalizeAgentWorkflow(validWorkflow({
    tasks: [
      { ...validWorkflow().tasks[0], dependsOn: ['T-120'] },
      validWorkflow().tasks[1],
    ],
  }))
  const resolved = resolveWorkflowTaskDependencies(workflow, new Map([['build', 'T-180']]))
  assert.deepEqual(resolved, [
    { task: workflow.tasks[0], dependencies: ['T-120'] },
    { task: workflow.tasks[1], dependencies: ['T-180'] },
  ])

  const ordered = normalizeAgentWorkflow(validWorkflow({ mode: 'ordered' }))
  assert.throws(
    () => resolveWorkflowTaskDependencies(ordered, new Map()),
    /has not been launched yet/,
  )
  assert.deepEqual(
    resolveWorkflowTaskDependenciesForTask(ordered, ordered.tasks[1], new Map([['build', 'T-181']])),
    ['T-181'],
  )
})

test('workflow templates save atomically, reload, and reject duplicate names', t => {
  const root = temporaryRoot(t)
  const saved = saveAgentWorkflowTemplate(validWorkflow(), ['boss', 'copilot', 'copilot-qa'], root)
  assert.equal(saved.id, 'release-preparation')
  assert.deepEqual(listAgentWorkflowTemplates(undefined, root), [saved])
  assert.throws(() => saveAgentWorkflowTemplate(validWorkflow(), ['boss', 'copilot', 'copilot-qa'], root), error =>
    error instanceof AgentWorkflowError && error.status === 409)

  const file = path.join(root, '.agent-sync', 'templates', 'workflows', 'workflow-release-preparation.json')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).type, 'workflow')
})

test('team templates accept the existing array and enabled-agent-map formats', t => {
  const root = temporaryRoot(t)
  const directory = path.join(root, '.agent-sync', 'templates')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'pair.json'), JSON.stringify({
    name: 'pair',
    description: 'A pair team.',
    agents: ['copilot', 'copilot-qa'],
  }))
  fs.writeFileSync(path.join(directory, 'trio.json'), JSON.stringify({
    name: 'trio',
    description: 'A trio team.',
    agents: { copilot: true, 'copilot-qa': true, disabled: false },
  }))
  const workflowDirectory = path.join(directory, 'workflows')
  fs.mkdirSync(workflowDirectory, { recursive: true })
  fs.writeFileSync(path.join(workflowDirectory, 'workflow-pair.json'), JSON.stringify({
    type: 'workflow',
    version: 1,
    ...validWorkflow(),
    id: 'pair',
  }))

  assert.deepEqual(listAgentTeamTemplates(root).map(template => template.agents), [
    ['copilot', 'copilot-qa'],
    ['copilot', 'copilot-qa'],
  ])
  assert.equal(listAgentWorkflowTemplates(undefined, root).length, 1)
})
