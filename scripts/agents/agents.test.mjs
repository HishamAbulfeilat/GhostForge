// Unit tests for the agent team (run: node --test scripts/agents/agents.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { routeModel, classifyTask, KIND_TIER } from './lib/models.mjs'
import { addTask, areasOverlap, say, readMessages, writeResult, takeResult, loadBoard, saveBoard } from './lib/bus.mjs'
import { commandFor, RATE_LIMIT_RE, winQuote } from './lib/providers.mjs'
import { lastJSON, pickTask, stagePrompt } from './boss.mjs'
import { scoreOf } from './health.mjs'

test('classifyTask maps free text to task kinds', () => {
  assert.equal(classifyTask('Fix SSRF in github-profile'), 'security')
  assert.equal(classifyTask('Add tests for the job store'), 'test')
  assert.equal(classifyTask('Fix crash when profile is empty'), 'bugfix')
  assert.equal(classifyTask('Refresh README'), 'docs')
  assert.equal(classifyTask('Agent Teams page'), 'feature')
})

test('routeModel sends deep work to deep models and chores to fast ones', () => {
  assert.deepEqual(routeModel('claude', { kind: 'security' }), { model: 'opus', tier: 'deep', kind: 'security' })
  assert.equal(routeModel('claude', { kind: 'feature' }).model, 'sonnet')
  assert.equal(routeModel('claude', { kind: 'docs' }).model, 'haiku')
  assert.equal(routeModel('copilot', { kind: 'security' }).model, 'auto')
  assert.equal(routeModel('unknown-provider', { kind: 'feature' }).model, 'auto')
  assert.equal(routeModel('claude', { kind: 'feature', model: 'opus' }).model, 'opus', 'explicit pin wins')
  assert.equal(routeModel('claude', { kind: 'docs' }, { claude: { fast: 'sonnet' } }).model, 'sonnet', 'team.json override')
  for (const tier of Object.values(KIND_TIER)) assert.ok(['deep', 'balanced', 'fast'].includes(tier))
})

test('areasOverlap treats path prefixes and empty areas as overlapping', () => {
  assert.equal(areasOverlap(['web-ui'], ['web-ui/lib/ai.ts']), true)
  assert.equal(areasOverlap(['web-ui/lib'], ['web-ui/app']), false)
  assert.equal(areasOverlap(['web-ui/app'], ['web-ui/application']), false, 'prefix must end at a path boundary')
  assert.equal(areasOverlap([], ['tui']), true, 'whole-repo task overlaps everything')
  assert.equal(areasOverlap(['tui\\index.js'], ['tui/']), true, 'normalizes separators and trailing slashes')
})

test('pickTask respects owner tags, area locks, and strengths', () => {
  const board = { phase: 1, nextId: 1, tasks: [] }
  addTask(board, { title: 'docs thing', kind: 'docs', area: ['README.md'] })
  addTask(board, { title: 'security thing', kind: 'security', area: ['web-ui/lib'] })
  addTask(board, { title: 'copilot only', kind: 'feature', area: ['tui'], agent: 'copilot' })
  assert.equal(pickTask(board.tasks, 'claude', ['security', 'docs']).title, 'security thing')
  assert.equal(pickTask(board.tasks, 'copilot', ['feature']).title, 'copilot only')
  board.tasks[1].status = 'in-progress'
  addTask(board, { title: 'overlaps busy', kind: 'security', area: ['web-ui/lib/ai.ts'] })
  assert.equal(pickTask(board.tasks, 'claude', ['security', 'docs']).title, 'docs thing', 'busy area is locked')
})

test('addTask dedupes open tasks by title', () => {
  const board = { phase: 1, nextId: 1, tasks: [] }
  const a = addTask(board, { title: 'same', kind: 'chore' })
  const b = addTask(board, { title: 'same', kind: 'chore' })
  assert.equal(a.id, b.id)
  assert.equal(board.tasks.length, 1)
})

test('bus round-trips board, messages, and results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bus-'))
  fs.mkdirSync(path.join(dir, 'results'))
  const board = loadBoard(dir)
  addTask(board, { title: 't', kind: 'chore' })
  saveBoard(dir, board)
  assert.equal(loadBoard(dir).tasks[0].id, 'T-001')

  say(dir, 'claude', 'copilot', 'hi')
  say(dir, 'boss', 'all', 'broadcast')
  say(dir, 'copilot', 'gemini', 'not for claude')
  assert.deepEqual(readMessages(dir, { to: 'claude' }).map(m => m.text), ['hi', 'broadcast'])

  writeResult(dir, 'T-001', { agent: 'claude', outcome: 'done', summary: 's' })
  assert.equal(takeResult(dir, 'T-001').outcome, 'done')
  assert.equal(takeResult(dir, 'T-001'), null, 'result is consumed once')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('provider adapters deny pushes for workers and are read-only for the boss', () => {
  const work = commandFor('claude', { prompt: 'p', model: 'sonnet', mode: 'work' })
  assert.equal(work.cmd, 'claude')
  assert.ok(work.args.includes('Bash(git push:*)'))
  assert.ok(commandFor('claude', { prompt: 'p', model: 'opus', mode: 'readonly' }).args.includes('plan'))
  const cop = commandFor('copilot', { prompt: 'p', model: 'auto', mode: 'work' })
  assert.deepEqual(cop.args.slice(0, 4), ['-p', 'p', '--model', 'auto'])
  assert.ok(cop.args.includes('shell(git push)'))
  assert.ok(!cop.args.includes('shell(git rebase)'), 'workers may rebase their own branch before integration')
  assert.ok(!work.args.includes('Bash(git rebase:*)'), 'workers may rebase their own branch before integration')
  assert.ok(!commandFor('codex', { prompt: 'p', model: 'auto', mode: 'work' }).args.includes('-m'), 'auto → provider default')
  assert.throws(() => commandFor('nope', {}), /Unknown provider/)
  assert.ok(RATE_LIMIT_RE.test('Error: 429 Too Many Requests'))
  assert.ok(RATE_LIMIT_RE.test("You've hit your session limit · resets 5:40am (Asia/Amman)"), 'Claude session-limit message')
  assert.ok(RATE_LIMIT_RE.test("You've hit your weekly limit"))
  assert.equal(winQuote('a b'), '"a b"')
  assert.equal(winQuote('--model'), '--model')
})

test('runtime prompts are staged inside the executing worktree', () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-prompt-'))
  const file = stagePrompt(worktree, 'tasks', 'T-001-copilot.md', 'task prompt')
  assert.equal(file, path.join(worktree, '.agent-sync', 'state', 'tasks', 'T-001-copilot.md'))
  assert.equal(fs.readFileSync(file, 'utf8'), 'task prompt')
  fs.rmSync(worktree, { recursive: true, force: true })
})

test('team config exposes five independent Copilot workers', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../.agent-sync/team.json', import.meta.url), 'utf8'))
  const workers = Object.entries(config.agents).filter(([, agent]) => agent.enabled && agent.provider === 'copilot')
  assert.equal(workers.length, 5)
  assert.equal(new Set(workers.map(([, agent]) => agent.worktree)).size, 5)
  assert.equal(new Set(workers.map(([, agent]) => agent.branch)).size, 5)
})

test('lastJSON finds the verdict line in model output', () => {
  assert.deepEqual(lastJSON('Looks good.\n{"approve": true, "issues": []}\n'), { approve: true, issues: [] })
  assert.deepEqual(lastJSON('```json\n{"approve": false, "issues": ["x"]}\n```'), { approve: false, issues: ['x'] })
  assert.deepEqual(lastJSON('plan:\n{\n  "phaseComplete": false,\n  "tasks": []\n}\ndone'), { phaseComplete: false, tasks: [] })
  assert.equal(lastJSON('no json here'), null)
})

test('scoreOf weights checks and ignores skipped ones', () => {
  assert.equal(scoreOf([{ ok: true, weight: 20 }, { ok: false, weight: 20 }]), 50)
  assert.equal(scoreOf([{ ok: true, weight: 10 }, { ok: false, skipped: true, weight: 90 }]), 100)
  assert.equal(scoreOf([]), 0)
})

test('releaseStuckTasks frees todo tasks pinned to a cooling-down or unknown agent', async () => {
  const { releaseStuckTasks } = await import('./boss.mjs')
  const now = Date.parse('2026-10-01T04:00:00Z')
  const tasks = [
    { id: 'T-1', status: 'todo', agent: 'claude' },
    { id: 'T-2', status: 'todo', agent: 'copilot-web' },
    { id: 'T-3', status: 'todo', agent: 'gone' },
    { id: 'T-4', status: 'in-progress', agent: 'claude' },
    { id: 'T-5', status: 'todo', agent: 'any' },
  ]
  const state = { claude: { cooldownUntil: '2026-10-01T04:20:00Z' }, 'copilot-web': { cooldownUntil: null } }
  assert.equal(releaseStuckTasks(tasks, state, now), 2)
  assert.deepEqual(tasks.map(t => t.agent), ['any', 'copilot-web', 'any', 'claude', 'any'])
})
