#!/usr/bin/env node
// GhostForge Agent Team Dashboard — a tiny, dependency-free live monitor.
//
//   node scripts/agents-dashboard.mjs            # http://127.0.0.1:3460
//   PORT=8080 node scripts/agents-dashboard.mjs  # custom port
//
// Reads the same files the boss writes (never writes anything itself):
//   .agent-sync/state/status.json   boss + per-agent runtime state
//   .agent-sync/state/board.json    the task board
//   .agent-sync/state/boss.log      boss activity log (tail)
//   .agent-sync/state/messages.jsonl  team message bus (tail)
//   .agent-sync/team.json           configured agents (roles, providers, models)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE = path.join(ROOT, '.agent-sync', 'state')
const PORT = Number(process.env.PORT || process.env.GF_DASHBOARD_PORT || 3460)
const LOG_TAIL_BYTES = 24 * 1024 // enough for ~40 log lines
const MSG_TAIL_LINES = 30

const FREE = path.join(os.homedir(), '.free-worker')
const SWITCH = path.join(os.homedir(), '.claude-switch')
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
const mtime = f => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }

function tailLines(file, n) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const lines = text.split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - n)).filter(Boolean)
}

// Read only the last LOG_TAIL_BYTES of a possibly-large log file.
function tailBytes(file, bytes = LOG_TAIL_BYTES) {
  let fd
  try {
    const size = fs.statSync(file).size
    if (!size) return []
    fd = fs.openSync(file, 'r')
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    const firstNewline = buf.indexOf(0x0a)
    return buf.toString('utf8').slice(firstNewline + 1).split(/\r?\n/).filter(Boolean)
  } catch { return [] } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch { /* ignore */ } }
}

function collectState() {
  const status = readJSON(path.join(STATE, 'status.json'), null)
  const board = readJSON(path.join(STATE, 'board.json'), null)
  const team = readJSON(path.join(ROOT, '.agent-sync', 'team.json'), null)
  const tasks = board?.tasks ?? board ?? []
  const messages = tailLines(path.join(STATE, 'messages.jsonl'), MSG_TAIL_LINES)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
    .reverse() // newest first
  const log = tailBytes(path.join(STATE, 'boss.log'), LOG_TAIL_BYTES).slice(-45).reverse() // newest first
  const pid = status?.pid
  const bossAlive = pid ? isAlive(pid) : false
  return {
    now: Date.now(),
    boss: {
      pid: pid ?? null,
      alive: bossAlive,
      health: status?.health ?? null,
      merges: status?.merges ?? null,
      phase: status?.phase ?? null,
      pr: status?.pr ?? null,
      codeRev: status?.codeRev ?? null,
      heartbeat: mtime(path.join(STATE, 'status.json')),
    },
    agents: status?.agents ?? {},
    teamAgents: team?.agents ?? {},
    board: { total: tasks.length, byStatus: countBy(tasks, 'status'), tasks },
    messages,
    log,
    free: collectFree(),
  }
}

// Free-worker (opencode free models on Jorcord / vinylcut / agent-world) + claude-switch routing.
function collectFree() {
  const cfg = readJSON(path.join(FREE, 'config.json'), { projects: [] })
  const queues = (cfg.projects ?? []).map(p => ({ project: p.name, tasks: readJSON(path.join(FREE, `queue-${p.name}.json`), []).map(({ prompt, ...t }) => t) }))
  return {
    status: readJSON(path.join(FREE, 'status.json'), {}),
    loopAlive: isAlive(Number(readJSON(path.join(FREE, 'loop.pid'), 0))),
    queues,
    log: tailBytes(path.join(FREE, 'worker.log')).slice(-25).reverse(),
    switchState: readJSON(path.join(SWITCH, 'state.json'), {}),
  }
}

function countBy(items, key) {
  const out = {}
  for (const it of items) { const v = it?.[key] ?? 'unknown'; out[v] = (out[v] || 0) + 1 }
  return out
}

function isAlive(pid) {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GhostForge Agent Team</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤝</text></svg>">
<style>
  :root{
    --bg:#0b0f14; --surface:#111820; --surface2:#0f151d; --line:#1e2a36; --line2:#2a3a4a;
    --ink:#e6edf3; --muted:#8b9bab; --accent:#4dd0e1; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --info:#58a6ff;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif}
  header{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 20px;background:rgba(11,15,20,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  h1{margin:0;font-size:16px;letter-spacing:.2px}
  h1 span{color:var(--muted);font-weight:400}
  .grow{flex:1}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--line2);border-radius:999px;font-size:12px;color:var(--muted);white-space:nowrap}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
  .dot.ok{background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .dot.bad{background:var(--bad);box-shadow:0 0 8px var(--bad)}
  .dot.warn{background:var(--warn);box-shadow:0 0 8px var(--warn)}
  main{padding:20px;max-width:1500px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
  section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  section>h2{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .row{display:flex;flex-wrap:wrap;gap:10px}
  .card{flex:1 1 190px;min-width:170px;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
  .card .k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .card .v{font-size:20px;font-weight:650;margin-top:2px}
  .card .s{font-size:11px;color:var(--muted);margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface)}
  td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  .tag{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:600;border:1px solid transparent;white-space:nowrap}
  .tag.todo{background:#1c2430;color:#a8b6c4;border-color:#2c3947}
  .tag.in-progress{background:#0d2b3a;color:#7fd7f0;border-color:#17475c}
  .tag.review{background:#2b2410;color:#e8c46a;border-color:#5a4a1c}
  .tag.done{background:#0e2a16;color:#6fd08c;border-color:#1b4a2a}
  .tag.blocked{background:#2e1214;color:#f08c86;border-color:#5c2326}
  .tag.agent{background:#16202c;color:#b9c8d6;border-color:#26343f}
  .agent{display:flex;flex-wrap:wrap;gap:10px}
  .agent .card{flex:1 1 240px}
  .state{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.05em}
  .state.idle{color:var(--muted)} .state.working,.state.busy{color:var(--ok)} .state.review{color:var(--warn)} .state.cooling,.state.cooldown{color:var(--info)}
  pre{margin:0;max-height:340px;overflow:auto;background:#0a0e13;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:#b8c4d0;white-space:pre-wrap;word-break:break-word}
  .msg{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:12.5px}
  .msg:last-child{border-bottom:none}
  .msg .who{color:var(--accent);font-weight:600;white-space:nowrap}
  .msg .to{color:var(--muted);white-space:nowrap}
  .msg .t{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .msg .x{flex:1;min-width:0;word-break:break-word}
  a{color:var(--info)}
  .bar{height:7px;border-radius:99px;background:#1a2430;overflow:hidden}
  .bar>i{display:block;height:100%;background:linear-gradient(90deg,#2ea043,#3fb950)}
  .hint{color:var(--muted);font-size:12px}
  .scroll{max-height:420px;overflow:auto}
  @media (max-width:720px){ main{padding:12px} .card .v{font-size:17px} }
</style>
</head>
<body>
<header>
  <h1>🤝 GhostForge Agent Team <span id="sub">loading…</span></h1>
  <div class="grow"></div>
  <span class="pill" id="boss-pill"><i class="dot"></i> boss</span>
  <span class="pill" id="health-pill">health —</span>
  <span class="pill" id="merges-pill">merges —</span>
  <span class="pill" id="phase-pill">phase —</span>
  <span class="pill" id="updated-pill">—</span>
</header>
<main>
  <section>
    <h2>Overview</h2>
    <div class="row" id="overview"></div>
  </section>

  <section>
    <h2>Agents <span class="hint" id="agents-count"></span></h2>
    <div class="agent" id="agents"></div>
  </section>

  <section>
    <h2>Board <span class="hint" id="board-count"></span></h2>
    <div class="row" style="margin-bottom:12px" id="board-summary"></div>
    <div class="scroll">
      <table>
        <thead><tr><th style="width:70px">ID</th><th style="width:100px">Status</th><th style="width:90px">Agent</th><th>Task</th><th style="width:90px">Kind</th></tr></thead>
        <tbody id="board-rows"></tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Free workers <span class="hint" id="free-sub"></span></h2>
    <div class="scroll">
      <table>
        <thead><tr><th style="width:150px">Project</th><th style="width:70px">ID</th><th style="width:90px">Status</th><th style="width:220px">Model</th><th>Task</th></tr></thead>
        <tbody id="free-rows"></tbody>
      </table>
    </div>
    <pre id="free-log"></pre>
  </section>

  <section>
    <h2>Messages</h2>
    <div class="scroll" id="messages"></div>
  </section>

  <section>
    <h2>Boss log <span class="hint">(newest first)</span></h2>
    <pre id="log"></pre>
  </section>
</main>

<script>
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return Math.floor(s) + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago' }
const time = ts => { try { return new Date(ts).toLocaleTimeString() } catch { return '—' } }
const STATUS_ORDER = ['in-progress', 'review', 'todo', 'blocked', 'done']

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }

function renderHeader(d) {
  $('sub').textContent = d.boss.alive ? 'live' : 'offline'
  const pill = $('boss-pill')
  pill.innerHTML = '<i class="dot ' + (d.boss.alive ? 'ok' : 'bad') + '"></i> boss ' + (d.boss.alive ? 'running (pid ' + esc(d.boss.pid) + ')' : 'not running')
  const h = d.boss.health
  $('health-pill').innerHTML = 'health <b style="color:' + (h == null ? 'var(--muted)' : h >= 95 ? 'var(--ok)' : h >= 80 ? 'var(--warn)' : 'var(--bad)') + '">' + (h == null ? '—' : h + '%') + '</b>'
  $('merges-pill').textContent = 'merges ' + (d.boss.merges ?? '—')
  $('phase-pill').textContent = 'phase ' + (d.boss.phase ?? '—')
  $('updated-pill').textContent = 'updated ' + time(d.now)
  document.title = (d.boss.alive ? '🟢' : '🔴') + ' ' + (d.board.byStatus['in-progress'] || 0) + ' active · ' + (d.board.byStatus['todo'] || 0) + ' todo · GhostForge'
}

function renderOverview(d) {
  const total = d.board.total || 0
  const done = d.board.byStatus['done'] || 0
  const pct = total ? Math.round(done / total * 100) : 0
  const cards = [
    ['Health', d.boss.health == null ? '—' : d.boss.health + '%', d.boss.alive ? 'boss running' : 'boss offline', '<div class="bar"><i style="width:' + (d.boss.health ?? 0) + '%"></i></div>'],
    ['Progress', pct + '%', done + ' of ' + total + ' tasks done', '<div class="bar"><i style="width:' + pct + '%"></i></div>'],
    ['Active', (d.board.byStatus['in-progress'] || 0) + (d.board.byStatus['review'] || 0), 'in-progress + review', ''],
    ['Todo', d.board.byStatus['todo'] || 0, 'waiting for a worker', ''],
    ['Blocked', d.board.byStatus['blocked'] || 0, 'needs a human', ''],
    ['Boss heartbeat', d.boss.heartbeat ? ago(d.boss.heartbeat) : '—', 'status.json mtime', ''],
    ['Code revision', d.boss.codeRev ? d.boss.codeRev.slice(0, 8) : '—', 'scripts/agents', ''],
    ['PR', d.boss.pr ? '<a href="' + esc(d.boss.pr) + '" target="_blank" rel="noopener">open</a>' : 'none', '', ''],
  ]
  $('overview').replaceChildren(...cards.map(([k, v, s, extra]) => {
    const c = el('div', 'card')
    c.appendChild(el('div', 'k', esc(k)))
    c.appendChild(el('div', 'v', v))
    if (s) c.appendChild(el('div', 's', s))
    if (extra) c.appendChild(el('div', 's', extra))
    return c
  }))
}

function renderAgents(d) {
  const agents = Object.entries(d.agents || {})
  const configured = Object.entries(d.teamAgents || {})
  $('agents-count').textContent = agents.length ? '(' + agents.length + ' enabled)' : ''
  const cards = agents.length ? agents.map(([id, a]) => agentCard(id, a)) : [el('div', 'hint', 'No agents enabled — the boss runs alone.')]
  $('agents').replaceChildren(...cards)
  function agentCard(id, a) {
    const cfg = configured.find(([k]) => k === id)?.[1] ?? {}
    const state = String(a.state || 'unknown')
    const c = el('div', 'card')
    c.appendChild(el('div', 'k', esc(id) + (cfg.enabled === false ? ' (disabled)' : '')))
    c.appendChild(el('div', 'state ' + state, esc(state)))
    const model = a.model || cfg.models?.fast || cfg.models?.balanced || 'provider default'
    c.appendChild(el('div', 's', esc(cfg.provider || '—') + ' · ' + esc(model)))
    if (a.task) c.appendChild(el('div', 's', 'task: <b style="color:var(--ink)">' + esc(String(a.task).slice(0, 46)) + '</b>'))
    if (a.cooldownUntil) {
      const until = Date.parse(a.cooldownUntil)
      c.appendChild(el('div', 's', 'resting until ' + (isNaN(until) ? esc(a.cooldownUntil) : time(until))))
    }
    if (cfg.role) c.appendChild(el('div', 's', esc(cfg.role)))
    return c
  }
}

function renderBoard(d) {
  const by = d.board.byStatus
  $('board-count').textContent = '(' + d.board.total + ' total)'
  $('board-summary').replaceChildren(...STATUS_ORDER.filter(s => by[s]).map(s => el('div', 'card',
    '<div class="k">' + esc(s) + '</div><div class="v" style="font-size:22px">' + by[s] + '</div>')))
  const sorted = [...d.board.tasks].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status), bi = STATUS_ORDER.indexOf(b.status)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || String(a.id).localeCompare(String(b.id))
  })
  const rows = sorted.slice(0, 200).map(t => {
    const tr = document.createElement('tr')
    tr.innerHTML =
      '<td style="color:var(--muted);font-variant-numeric:tabular-nums">T-' + esc(t.id) + '</td>' +
      '<td><span class="tag ' + esc(t.status) + '">' + esc(t.status) + '</span></td>' +
      '<td><span class="tag agent">' + esc(t.agent || t.owner || 'any') + '</span></td>' +
      '<td>' + esc(t.title) +
        (t.lastFailure ? '<div class="hint" style="margin-top:3px">↳ ' + esc(String(t.lastFailure).slice(0, 220)) + '</div>' : '') +
        (t.summary ? '<div class="hint" style="margin-top:3px">✓ ' + esc(String(t.summary).slice(0, 220)) + '</div>' : '') +
      '</td>' +
      '<td style="color:var(--muted)">' + esc(t.kind || '—') + '</td>'
    return tr
  })
  if (!rows.length) rows.push(el('tr', '', '<td colspan="5" class="hint">Board is empty.</td>'))
  $('board-rows').replaceChildren(...rows)
}

function renderFree(d) {
  const f = d.free; if (!f) return
  const cur = f.status.current
  $('free-sub').textContent = (f.loopAlive ? 'loop running' : 'loop stopped') +
    (cur ? ' · now: ' + cur.project + ' ' + cur.task + ' on ' + cur.model : '') +
    ' · claude-switch: ' + (f.switchState.mode || '?') + (f.switchState.lastModel ? ' (' + f.switchState.lastModel + ')' : '')
  const rows = []
  for (const q of f.queues) for (const t of q.tasks)
    rows.push(el('tr', '', '<td>' + esc(q.project) + '</td><td>' + esc(t.id) + '</td><td>' + esc(t.status) + '</td><td>' + esc(t.model || (cur && cur.task === t.id ? cur.model : '')) + '</td><td>' + esc(t.title) + '</td>'))
  if (!rows.length) rows.push(el('tr', '', '<td colspan="5" class="hint">No free-worker tasks queued.</td>'))
  $('free-rows').replaceChildren(...rows)
  $('free-log').textContent = f.log.join('\\n')
}

function renderMessages(d) {
  if (!d.messages.length) { $('messages').replaceChildren(el('div', 'hint', 'No messages yet.')); return }
  $('messages').replaceChildren(...d.messages.map(m => {
    const e = el('div', 'msg')
    e.innerHTML =
      '<span class="t">' + time(Math.floor(m.ts ? Date.parse(m.ts) : 0) || 0) + '</span>' +
      '<span class="who">' + esc(m.from) + '</span><span class="to">→ ' + esc(m.to) + '</span>' +
      '<span class="x">' + esc(m.text) + '</span>'
    return e
  }))
}

function renderLog(d) {
  if (!d.log.length) { $('log').textContent = '(no log yet — ' + path + ')'; return }
  $('log').textContent = d.log.join('\\n')
}

async function refresh() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' })
    const d = await r.json()
    if (d.error) { $('sub').textContent = 'error: ' + d.error; return }
    renderHeader(d); renderOverview(d); renderAgents(d); renderBoard(d); renderMessages(d); renderFree(d); renderLog(d)
    if (d.log) renderLog(d)
  } catch (e) { $('sub').textContent = 'offline — retrying' }
}
refresh()
setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 3000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
</script>
</body>
</html>`

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (url === '/api/state') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    try { return res.end(JSON.stringify(collectState())) }
    catch (e) { return res.end(JSON.stringify({ error: e.message, now: Date.now() })) }
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(PAGE)
  }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent team dashboard → http://127.0.0.1:${PORT}`)
  console.log(`Reading state from ${STATE}`)
})
