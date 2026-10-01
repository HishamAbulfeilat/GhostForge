const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const appDir = path.join(__dirname, '..', 'app', 'agents')
const page = fs.readFileSync(path.join(appDir, 'page.tsx'), 'utf8')
const board = fs.readFileSync(path.join(appDir, 'AgentKanbanBoard.tsx'), 'utf8')
const navbar = fs.readFileSync(path.join(__dirname, '..', 'components', 'Navbar.tsx'), 'utf8')
const accessGuard = fs.readFileSync(path.join(__dirname, '..', 'components', 'AccessGuard.tsx'), 'utf8')
const loginPage = fs.readFileSync(path.join(__dirname, '..', 'app', 'login', 'page.tsx'), 'utf8')
const modelPath = path.join(appDir, 'dashboard-model.ts')
const modelSource = fs.readFileSync(modelPath, 'utf8')
const compiledModel = ts.transpileModule(modelSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const modelModule = new Module(modelPath, module)
modelModule.filename = modelPath
modelModule.paths = Module._nodeModulePaths(path.dirname(modelPath))
modelModule._compile(compiledModel, modelPath)
const {
  countOpenTasks,
  findAgentTask,
  formatElapsed,
  getAgentProgress,
  groupTasksByStatus,
  normalizeTaskStatus,
} = modelModule.exports

const tasks = [
  { id: 'T-1', title: 'Todo item', kind: 'feature', status: 'todo', owner: 'worker' },
  { id: 'T-2', title: 'Active item', kind: 'bugfix', status: 'in-progress', owner: 'worker' },
  { id: 'T-3', title: 'Review item', kind: 'test', status: 'review', owner: 'worker' },
  { id: 'T-4', title: 'Finished item', kind: 'docs', status: 'done', owner: 'worker' },
  { id: 'T-5', title: 'Blocked item', kind: 'security', status: 'blocked', owner: null },
]

test('agents dashboard retains authenticated snapshot loading and existing team controls', () => {
  assert.match(page, /fetch\(['"]\/api\/agents['"]/)
  assert.match(page, /fetch\(['"]\/api\/auth\/me['"]/)
  assert.match(page, /authResponse\.status === 401/)
  assert.match(page, /router\.replace\('\/login\?next=\/agents'\)/)
  assert.match(page, /user\.role === 'admin' \|\| user\.permissions\?\.includes\('admin_tools'\)/)
  assert.match(page, /action: 'start'/)
  assert.match(page, /action: 'stop'/)
  assert.match(page, /action: 'say'/)
  assert.match(page, /action: 'add'/)
  assert.match(navbar, /href: ['"]\/agents['"]/)
  assert.match(page, /Start team/)
  assert.match(page, /Stop team/)
  assert.match(page, /Refresh/)
  assert.match(page, />Say</)
  assert.match(page, />Add</)
  assert.match(page, /id="agent-message"/)
  assert.match(page, /id="agent-task"/)
  assert.match(page, /aria-label="Message recipient"/)
  assert.match(page, /aria-label="Task kind"/)
  assert.match(page, /Phase/)
  assert.match(page, /<AgentKanbanBoard agents=\{snapshot\.agents\} tasks=\{snapshot\.tasks\} messages=\{displayMessages\}/)
  assert.match(accessGuard, /pathname !== '\/agents'/)
  assert.match(loginPage, /searchParams\.get\('next'\) \?\? searchParams\.get\('from'\)/)
  assert.match(page, /role=\{notice\.error \? 'alert' : 'status'\}/)
  assert.match(page, /onClick=\{\(\) => void load\(\)\}/)
  assert.match(page, /Agent-team command completed\./)
  assert.match(page, /Unable to load agent team\./)
  assert.match(page, /Enter a message before sending\./)
  assert.match(page, /Enter a task title before adding it\./)
})

test('kanban groups every required state and normalizes the boss in-progress spelling', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(groupTasksByStatus(tasks)).map(([status, items]) => [status, items.map(task => task.id)])),
    {
      todo: ['T-1'],
      'in-progress': ['T-2'],
      review: ['T-3'],
      done: ['T-4'],
      blocked: ['T-5'],
    },
  )
  assert.equal(normalizeTaskStatus('in_progress'), 'in-progress')
  assert.equal(normalizeTaskStatus('inprogress'), 'in-progress')
  assert.equal(countOpenTasks(tasks), 4)
  assert.match(board, /BOARD_COLUMNS\.map\(status/)
  assert.match(board, /statusStyles/)
  assert.match(board, /badgeStyles/)
})

test('worker progress comes from assigned task outcomes and current-task lookup excludes finished work', () => {
  assert.deepEqual(getAgentProgress('worker', tasks), { completed: 1, total: 4, percentage: 25 })
  assert.deepEqual(getAgentProgress('unassigned', tasks), { completed: 0, total: 0, percentage: 0 })
  assert.equal(findAgentTask('worker', {
    provider: 'copilot', state: 'working', task: 'T-4', model: 'gpt', since: null, cooldownUntil: null,
  }, tasks).id, 'T-2')
  assert.equal(findAgentTask('worker', {
    provider: 'copilot', state: 'idle', task: null, model: null, since: null, cooldownUntil: null,
  }, [{ ...tasks[3] }]), null)
  assert.match(board, /Tasks complete \(estimate\)/)
  assert.match(board, /Current task/)
  assert.match(board, /Provider/)
  assert.match(board, /Model/)
})

test('elapsed time uses the boss since timestamp and handles malformed or future timestamps', () => {
  const now = Date.parse('2026-10-01T03:00:00.000Z')
  assert.equal(formatElapsed('2026-10-01T00:30:00.000Z', now), '2h 30m')
  assert.equal(formatElapsed('2026-09-29T03:00:00.000Z', now), '2d 0h')
  assert.equal(formatElapsed('not-a-date', now), '—')
  assert.equal(formatElapsed('2026-10-02T00:00:00.000Z', now), '—')
  assert.match(modelSource, /since: string \| null/)
  assert.match(board, /formatElapsed\(agent\.since, now\)/)
  assert.match(board, /setNow\(Date\.now\(\)\)/)
})

test('history is bounded, hydration-safe, and page has no duplicate worker or task grid', () => {
  assert.match(board, /messages\.slice\(-6\)\.reverse\(\)/)
  assert.match(board, /Recent history/)
  assert.match(board, /teamMessage\.text/)
  assert.match(board, /dateTime=\{teamMessage\.datetime\}/)
  assert.match(board, /No recent team history\./)
  assert.match(board, /now === null \|\| .*formatElapsed\(agent\.since, now\)/)
  assert.match(page, /normalizeMessages\(snapshot\?\.messages\)/)
  assert.match(page, /Unknown sender/)
  assert.match(page, /Unknown recipient/)
  assert.doesNotMatch(page, /aria-labelledby="workers-heading"/)
  assert.doesNotMatch(page, /snapshot\.tasks\.map/)
  assert.match(page, /useEffect\(\(\) => \{[\s\S]*date\.toLocaleString\(/)
  assert.doesNotMatch(page, /function normalizeMessages[\s\S]{0,500}toLocaleString\(/)
  assert.doesNotMatch(page, /Math\.random|Date\.now\s*\(/)
  assert.doesNotMatch(`${page}\n${board}`, /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b/)
})
