#!/usr/bin/env node
// free-worker — runs queued coding tasks on free opencode models, one at a time
// (low RAM, below-normal priority), in a dedicated git worktree per project so
// the user's checkout is never touched. A task's changes are kept only if the
// project's own verify command passes; they then merge into `free/integration`
// for a paid-model (Pro) review before anything reaches the main branch.
//
//   node free-worker.mjs loop     run forever (exits at once if another loop is alive)
//   node free-worker.mjs once     one task per project, then exit
//   node free-worker.mjs status   print queues
//   node free-worker.mjs add <project> "title" "prompt" [hard|easy]
//
// Runtime config, queues, logs and status.json live in ~/.free-worker/.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HOME = path.join(os.homedir(), '.free-worker')
const CONFIG = path.join(HOME, 'config.json')
const LOG = path.join(HOME, 'worker.log')
const STATUS = path.join(HOME, 'status.json')
const LOCK = path.join(HOME, 'loop.pid')
const STOP = path.join(HOME, 'STOP')
const OPENCODE_CONFIG = path.join(HOME, 'opencode.json')
const TASK_TIMEOUT = 30 * 60_000
// How long the loop waits before re-checking the queues when it has no work.
// Kept short so a task queued from the dashboard starts within ~a minute; the
// idle check only reads three small queue files, so the cost is negligible.
const IDLE_SLEEP = 45_000
const INTEGRATION = 'free/integration'

const log = msg => { const line = `[${new Date().toISOString()}] ${msg}`; console.log(line); fs.appendFileSync(LOG, line + '\n') }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2))
const queueFile = name => path.join(HOME, `queue-${name}.json`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

function sh(cmd, cwd, timeout = 10 * 60_000, env = {}) {
  const r = spawnSync(cmd, { cwd, encoding: 'utf8', timeout, windowsHide: true, shell: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000) }
}
const git = (cwd, args) => sh(`git ${args}`, cwd, 120_000)

function setStatus(patch) { writeJson(STATUS, { ...readJson(STATUS, {}), ...patch, updated: new Date().toISOString() }) }

/** A worktree on free/integration next to the repo, created (and deps installed) on first use. */
function ensureWorktree(project) {
  const wt = `${project.path}-free`
  if (!fs.existsSync(wt)) {
    const base = git(project.path, 'branch --show-current').out.trim()
    const hasBranch = git(project.path, `rev-parse --verify -q ${INTEGRATION}`).ok
    const r = git(project.path, hasBranch ? `worktree add "${wt}" ${INTEGRATION}` : `worktree add -b ${INTEGRATION} "${wt}" ${base}`)
    if (!r.ok) { log(`${project.name}: worktree add failed: ${r.out}`); return null }
  }
  if (project.install && !fs.existsSync(path.join(wt, 'node_modules'))) {
    log(`${project.name}: installing deps in worktree`)
    const r = sh(project.install, wt, 20 * 60_000)
    if (!r.ok) { log(`${project.name}: install failed: ${r.out.split('\n').slice(-3).join(' | ')}`); return null }
  }
  return wt
}

function runTask(project, task, cfg) {
  const wt = ensureWorktree(project)
  if (!wt) return 'skipped'
  git(wt, `checkout -q ${INTEGRATION}`)
  if (git(wt, 'status --porcelain').out.trim()) { git(wt, 'reset -q --hard'); git(wt, 'clean -fdq') }
  const branch = `free/${task.id}`
  git(wt, `checkout -q -B ${branch}`)
  const prompt = `${task.prompt}\n\nRules: make the smallest change that fully does this. Do not touch unrelated files. ` +
    `Do not commit, push, or switch branches. When done, \`${project.verify}\` must pass.`
  const models = cfg.models[task.tier ?? 'hard'] ?? cfg.models.hard
  let outcome = 'failed', limited = 0
  for (const model of models) {
    log(`${project.name} ${task.id} → ${model}`)
    setStatus({ current: { project: project.name, task: task.id, title: task.title, model, started: new Date().toISOString() } })
    const quoted = prompt.replace(/"/g, '\\"').replace(/\r?\n/g, ' ')
    const run = sh(`opencode run --auto -m ${model} --title "free-worker ${task.id}" "${quoted}"`, wt, TASK_TIMEOUT, { OPENCODE_CONFIG })
    if (!git(wt, 'status --porcelain').out.trim()) {
      if (/rate limit|too many requests|status 429/i.test(run.out)) { limited++; log(`  rate-limited on ${model}, next model`) } else log('  no changes, next model')
      continue
    }
    const v = sh(project.verify, wt, 20 * 60_000)
    if (v.ok) {
      git(wt, 'add -A'); git(wt, `commit -q -m "${task.title.replace(/"/g, "'")} (free-worker ${task.id}, ${model})"`)
      task.model = model; outcome = 'review'; log(`  verified, committed on ${branch}`); break
    }
    log(`  verify failed, reverting: ${v.out.split('\n').slice(-3).join(' | ')}`)
    git(wt, 'reset -q --hard'); git(wt, 'clean -fdq')
  }
  if (outcome === 'failed' && limited === models.length) outcome = 'ratelimited'
  git(wt, `checkout -q ${INTEGRATION}`)
  if (outcome === 'review') {
    if (!git(wt, `merge -q --no-edit ${branch}`).ok) { git(wt, 'merge --abort'); outcome = 'conflict' }
  } else git(wt, `branch -q -D ${branch}`)
  return outcome
}

async function cycle(cfg) {
  let worked = false
  for (const project of cfg.projects) {
    if (fs.existsSync(STOP)) return false
    const q = readJson(queueFile(project.name), [])
    const task = q.find(t => t.status === 'todo')
    if (!task) continue
    task.status = 'running'; writeJson(queueFile(project.name), q)
    const outcome = runTask(project, task, cfg)
    // re-read: tasks may have been added while this one ran, and writing the stale copy would drop them
    const fresh = readJson(queueFile(project.name), [])
    const t = fresh.find(x => x.id === task.id) ?? task
    // skipped (no worktree) and ratelimited (every free model refused) are not real attempts: retry later
    if (outcome !== 'skipped' && outcome !== 'ratelimited') t.attempts = (t.attempts ?? 0) + 1
    t.status = outcome === 'skipped' || outcome === 'ratelimited' ? 'todo' : outcome === 'failed' && t.attempts < 2 ? 'todo' : outcome
    t.finished = new Date().toISOString()
    if (task.model) t.model = task.model
    writeJson(queueFile(project.name), fresh)
    setStatus({ current: null, last: { project: project.name, task: task.id, outcome } })
    if (outcome === 'ratelimited') { log('all free models rate-limited, backing off'); return false } // loop sleeps, then retries
    worked ||= outcome !== 'skipped'
  }
  return worked
}

const [cmd, ...rest] = process.argv.slice(2)
fs.mkdirSync(HOME, { recursive: true })
const cfg = readJson(CONFIG, null)
if (!cfg) { console.error(`missing ${CONFIG}`); process.exit(1) }

if (cmd === 'status') {
  for (const p of cfg.projects) for (const t of readJson(queueFile(p.name), [])) console.log(`${p.name.padEnd(22)} ${t.id.padEnd(7)} ${t.status.padEnd(8)} ${t.model ?? ''} ${t.title}`)
} else if (cmd === 'add') {
  const [name, title, prompt, tier] = rest
  const q = readJson(queueFile(name), [])
  const next = Math.max(0, ...q.map(t => Number(t.id.split('-')[1]) || 0)) + 1
  q.push({ id: `${name.slice(0, 2).toUpperCase()}-${String(next).padStart(3, '0')}`, title, prompt: prompt || title, tier: tier || 'hard', status: 'todo' })
  writeJson(queueFile(name), q); console.log('queued')
} else if (cmd === 'once') {
  await cycle(cfg)
} else if (cmd === 'loop') {
  const other = Number(readJson(LOCK, 0))
  if (other && other !== process.pid && alive(other)) process.exit(0)
  writeJson(LOCK, process.pid)
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* best effort */ }
  log('loop started')
  while (!fs.existsSync(STOP)) { if (!(await cycle(cfg))) await sleep(IDLE_SLEEP) }
  log('STOP file found, exiting')
} else {
  console.log('usage: free-worker.mjs loop|once|status|add <project> "title" "prompt" [hard|easy]')
}
