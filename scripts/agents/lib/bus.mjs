// Local message bus for the agent team: the task board, the chat log, and
// per-task results. Lives in <main repo>/.agent-sync/state/ (gitignored), so
// coordination never causes git conflicts and never lands in a commit.
//
// Writers:
//   board.json        — the boss only (single writer → no claim races)
//   messages.jsonl    — anyone, append-only (one small write per line)
//   results/<id>.json — the worker that owns task <id>
//   status.json       — the boss (heartbeat for `status` and the UI)

import fs from 'node:fs'
import path from 'node:path'

export function stateDir(root) {
  const dir = process.env.GF_AGENT_STATE || path.join(root, '.agent-sync', 'state')
  fs.mkdirSync(path.join(dir, 'results'), { recursive: true })
  return dir
}

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

/** Atomic write: temp file + rename, so a crash never leaves half a file. */
export function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

// ── Board ────────────────────────────────────────────────────────────────────
// Task: { id, title, kind, area: string[], agent: 'claude'|'copilot'|'any',
//         status: 'todo'|'in-progress'|'done'|'blocked',
//         owner, attempts, notes, phase, createdAt, updatedAt }

export function loadBoard(dir) {
  return readJSON(path.join(dir, 'board.json'), { phase: 1, nextId: 1, tasks: [] })
}

export function saveBoard(dir, board) {
  writeJSON(path.join(dir, 'board.json'), board)
}

export function addTask(board, t) {
  const dup = board.tasks.find(x => x.title === t.title && x.status !== 'done')
  if (dup) return dup
  const now = new Date().toISOString()
  const task = {
    id: `T-${String(board.nextId++).padStart(3, '0')}`,
    title: t.title, kind: t.kind, area: t.area ?? [], agent: t.agent ?? 'any',
    assignee: t.assignee ?? null, leader: t.leader ?? null, workflow: t.workflow ?? 'parallel',
    dependencies: t.dependencies ?? [], acceptanceCriteria: t.acceptanceCriteria ?? [],
    status: 'todo', owner: null, attempts: 0, notes: t.notes ?? '',
    phase: t.phase ?? board.phase, createdAt: now, updatedAt: now,
  }
  board.tasks.push(task)
  return task
}

/** Two areas overlap when one path is a prefix of the other (empty = whole repo). */
export function areasOverlap(a = [], b = []) {
  const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!a.length || !b.length) return true
  return a.some(x => b.some(y => {
    const [p, q] = [norm(x), norm(y)]
    return p === q || p.startsWith(q + '/') || q.startsWith(p + '/')
  }))
}

// ── Messages ─────────────────────────────────────────────────────────────────
// Line: { ts, from, to, text }   `to` is an agent id or 'all'.

export function say(dir, from, to, text) {
  const line = JSON.stringify({ ts: new Date().toISOString(), from, to, text }) + '\n'
  fs.appendFileSync(path.join(dir, 'messages.jsonl'), line)
}

export function readMessages(dir, { to, since, limit = 30 } = {}) {
  let lines = []
  try { lines = fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8').split('\n').filter(Boolean) } catch { /* none yet */ }
  const msgs = []
  for (const l of lines) { try { msgs.push(JSON.parse(l)) } catch { /* skip a torn line */ } }
  return msgs
    .filter(m => !to || m.to === to || m.to === 'all' || m.from === to)
    .filter(m => !since || m.ts > since)
    .slice(-limit)
}

// ── Results ──────────────────────────────────────────────────────────────────
// { id, ts, agent, outcome: 'done'|'blocked', summary }

export function writeResult(dir, id, result) {
  writeJSON(path.join(dir, 'results', `${id}.json`), { id, ts: new Date().toISOString(), ...result })
}

export function takeResult(dir, id) {
  const file = path.join(dir, 'results', `${id}.json`)
  const r = readJSON(file, null)
  if (r) fs.rmSync(file, { force: true })
  return r
}
