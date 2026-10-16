#!/usr/bin/env node
// GhostForge Agent Dashboard — a tiny, dependency-free control surface.
//
//   node scripts/agents-dashboard.mjs            # http://127.0.0.1:3460
//   PORT=8080 node scripts/agents-dashboard.mjs  # custom port
//
// Reads (never mutates) the files the boss and free-worker write, and exposes a
// small allow-listed action API so the UI can start/stop agents and talk to the
// team:
//   GET  /api/state    everything the page renders (board, agents, services,
//                      sessions, runtime, free-worker, messages, log)
//   POST /api/action   { action, ... }  allow-listed controls (say/task/service/kill)
//
// Sources:
//   .agent-sync/state/{status,board,messages,boss.log}   boss + team
//   .agent-sync/team.json                                configured agents
//   ~/.free-worker/{config,queue-*,status,worker.log}    free opencode workers
//   ~/.claude/projects/*/*.jsonl                         Claude Code sessions
//   ~/.claude-switch/state.json                          model routing
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE = path.join(ROOT, '.agent-sync', 'state')
const PORT = Number(process.env.PORT || process.env.GF_DASHBOARD_PORT || 3460)
const LOG_TAIL_BYTES = 24 * 1024 // enough for ~40 log lines
const MSG_TAIL_LINES = 30

const HOME = os.homedir()
const FREE = path.join(HOME, '.free-worker')
const SWITCH = path.join(HOME, '.claude-switch')
const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects')
const JORCORD = path.join(HOME, 'Desktop', 'Jorcord')

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

function isAlive(pid) {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

// ── services (TCP probe, so it works without elevation) ──────────────────────
const SERVICES = [
  { id: 'dashboard', label: 'Dashboard', port: PORT, self: true },
  { id: 'jorcord', label: 'Jorcord server+web', port: 3000, altPort: 5173, control: 'jorcord' },
  { id: 'livekit', label: 'LiveKit', port: 7880 },
  { id: 'omniroute', label: 'OmniRoute', port: 20128 },
  { id: 'proxy', label: 'claude-switch proxy', port: 3457 },
  { id: 'bridge', label: 'Mark-L bridge', port: 8765 },
]

function probe(port, host = '127.0.0.1', timeout = 400) {
  return new Promise(resolve => {
    if (!port) return resolve(false)
    const s = net.connect({ port, host })
    let done = false
    const fin = v => { if (done) return; done = true; try { s.destroy() } catch { /* ignore */ } resolve(v) }
    s.setTimeout(timeout, () => fin(false))
    s.on('connect', () => fin(true))
    s.on('error', () => fin(false))
  })
}

// ── runtime sampler (heavy: PowerShell + Get-Process; cached) ────────────────
const cache = { procs: { at: 0, data: null }, sessions: { at: 0, data: null }, titles: new Map() }

function sampleProcesses() {
  const now = Date.now()
  if (now - cache.procs.at < 12_000 && cache.procs.data) return Promise.resolve(cache.procs.data)
  return new Promise(resolve => {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-Process node,claude,opencode,bun -ErrorAction SilentlyContinue | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessName,$_.Id,[int]($_.WorkingSet64/1MB) }"],
    { windowsHide: true, timeout: 12_000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    let data
    try {
      const lines = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean)
      const procs = lines.map(l => { const [name, pid, mb] = l.split('|'); return { name, pid: Number(pid), mb: Number(mb) } })
        .filter(p => Number.isFinite(p.pid) && Number.isFinite(p.mb))
      procs.sort((a, b) => b.mb - a.mb)
      const byName = {}
      for (const p of procs) { const n = byName[p.name] || (byName[p.name] = { count: 0, mb: 0 }); n.count++; n.mb += p.mb }
      data = { procs: procs.slice(0, 20), byName, total: { count: procs.length, mb: procs.reduce((s, p) => s + p.mb, 0) } }
    } catch { data = { procs: [], byName: {}, total: { count: 0, mb: 0 } } }
    cache.procs = { at: now, data }
    resolve(data)
  })
}

// First readable prompt line of a Claude transcript, cached by mtime. Headless
// boss/worker sessions enqueue their prompt as the very first line
// (`queue-operation`), while interactive sessions start with a `user` message.
function firstUserText(fp) {
  const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  let fd
  try {
    const size = fs.statSync(fp).size
    fd = fs.openSync(fp, 'r')
    const n = Math.min(size, 16 * 1024)
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, 0)
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      let o; try { o = JSON.parse(line) } catch { continue }
      if (o.type === 'queue-operation' && typeof o.content === 'string') {
        const s = clean(o.content); if (s.length > 3) return s.slice(0, 100)
      }
      if (typeof o.summary === 'string' && o.summary.trim()) return clean(o.summary).slice(0, 100)
      if (o.type && o.type !== 'user') continue
      const c = o.message?.content
      const s = clean(typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x && x.type === 'text')?.text || '') : '')
      if (s.length > 8) return s.slice(0, 100)
    }
  } catch { /* ignore */ } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch { /* ignore */ } }
  return ''
}

function listSessions(limit = 20) {
  const now = Date.now()
  if (now - cache.sessions.at < 6000 && cache.sessions.data) return cache.sessions.data
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(CLAUDE_PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { /* none */ }
  for (const d of dirs) {
    const pdir = path.join(CLAUDE_PROJECTS, d.name)
    let files = []
    try { files = fs.readdirSync(pdir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const fp = path.join(pdir, f)
      let st; try { st = fs.statSync(fp) } catch { continue }
      if (st.size < 300) continue
      const c = cache.titles.get(fp)
      let title
      if (c && c.mtime === st.mtimeMs) title = c.title
      else { title = firstUserText(fp); cache.titles.set(fp, { mtime: st.mtimeMs, title }) }
      out.push({
        project: d.name, id: f.slice(0, 8), size: st.size, mtime: st.mtimeMs,
        active: now - st.mtimeMs < 120_000, title,
      })
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  const data = out.slice(0, limit)
  cache.sessions = { at: now, data }
  return data
}

async function collectState() {
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

  const freeCfg = readJSON(path.join(FREE, 'config.json'), { projects: [] })
  const freeProjects = (freeCfg.projects ?? []).map(p => p.name)

  const services = await Promise.all(SERVICES.map(async s => ({
    id: s.id, label: s.label, port: s.port, control: s.control || null,
    up: s.self ? true : await probe(s.port),
    upAlt: s.altPort ? await probe(s.altPort) : null,
  })))

  const [runtime] = await Promise.all([sampleProcesses()])

  const loopAlive = isAlive(Number(readJSON(path.join(FREE, 'loop.pid'), 0)))

  return {
    now: Date.now(),
    boss: {
      pid: pid ?? null, alive: bossAlive,
      health: status?.health ?? null, merges: status?.merges ?? null,
      phase: status?.phase ?? null, pr: status?.pr ?? null, codeRev: status?.codeRev ?? null,
      heartbeat: mtime(path.join(STATE, 'status.json')),
    },
    agents: status?.agents ?? {},
    teamAgents: team?.agents ?? {},
    bossCfg: team?.boss ?? {},
    services,
    teamPower: {
      boss: bossAlive,
      freeworker: loopAlive,
      jorcord: !!(services.find(s => s.id === 'jorcord')?.up),
    },
    runtime,
    sessions: listSessions(),
    board: { total: tasks.length, byStatus: countBy(tasks, 'status'), tasks },
    messages,
    log,
    free: collectFree(freeCfg, loopAlive),
    targets: {
      say: ['all', 'boss', ...Object.keys(team?.agents ?? {})],
      tasks: ['boss', ...freeProjects],
    },
  }
}

// Free-worker (opencode free models on Jorcord / vinylcut / agent-world) + claude-switch routing.
function collectFree(cfg, loopAlive) {
  const queues = (cfg.projects ?? []).map(p => ({
    project: p.name,
    tasks: readJSON(path.join(FREE, `queue-${p.name}.json`), []).map(({ prompt, ...t }) => t),
  }))
  return {
    status: readJSON(path.join(FREE, 'status.json'), {}),
    loopAlive,
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

// ── controls ─────────────────────────────────────────────────────────────────
function spawnDetached(cmd, args, cwd) {
  const c = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  c.unref?.()
}
function spawnShell(cmdline, cwd) {
  const c = spawn('cmd.exe', ['/c', cmdline], { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  c.unref?.()
}
function portPids(port) {
  const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
  const pids = new Set()
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
    if (m && Number(m[1]) === Number(port)) pids.add(Number(m[2]))
  }
  return [...pids]
}
function killPid(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }) } catch { /* ignore */ }
}

async function doAction(b) {
  const action = String(b.action || '')
  const team = readJSON(path.join(ROOT, '.agent-sync', 'team.json'), { agents: {} })
  const agentIds = Object.keys(team.agents ?? {})
  const freeCfg = readJSON(path.join(FREE, 'config.json'), { projects: [] })
  const projects = (freeCfg.projects ?? []).map(p => p.name)

  if (action === 'say') {
    const to = String(b.to || 'all')
    const text = String(b.text || '').trim()
    if (!text) return { ok: false, message: 'empty message' }
    if (!['all', 'boss', 'human', 'free-worker', ...agentIds].includes(to)) return { ok: false, message: 'unknown target ' + to }
    fs.appendFileSync(path.join(STATE, 'messages.jsonl'), JSON.stringify({ ts: new Date().toISOString(), from: 'human', to, text }) + '\n')
    return { ok: true, message: 'message sent to ' + to }
  }

  if (action === 'task') {
    const title = String(b.title || '').trim()
    if (!title) return { ok: false, message: 'title required' }
    const target = String(b.target || 'boss')
    if (target === 'boss') {
      const req = { title, kind: String(b.kind || 'feature'), area: [], agent: 'any', assignee: 'any', leader: 'boss', from: 'human' }
      if (b.notes) req.notes = String(b.notes)
      fs.appendFileSync(path.join(STATE, 'requests.jsonl'), JSON.stringify(req) + '\n')
      return { ok: true, message: 'queued for the boss: ' + title }
    }
    if (!projects.includes(target)) return { ok: false, message: 'unknown project ' + target }
    const qf = path.join(FREE, `queue-${target}.json`)
    const q = readJSON(qf, [])
    const prompt = String(b.prompt || '').trim() || title
    const tier = b.effort === 'easy' ? 'easy' : 'hard'
    const id = `${target.slice(0, 2).toUpperCase()}-${String(q.length + 1).padStart(3, '0')}`
    q.push({ id, title, prompt, tier, status: 'todo' })
    fs.writeFileSync(qf, JSON.stringify(q, null, 2))
    return { ok: true, message: `queued ${id} on ${target}` }
  }

  if (action === 'service') {
    const id = String(b.id || '')
    const op = String(b.op || '')
    if (id === 'boss') {
      if (op === 'start') { fs.rmSync(path.join(STATE, 'STOP'), { force: true }); spawnDetached(process.execPath, [path.join(ROOT, 'scripts', 'agents', 'boss.mjs'), 'start'], ROOT); return { ok: true, message: 'boss starting' } }
      if (op === 'stop') { fs.writeFileSync(path.join(STATE, 'STOP'), new Date().toISOString()); return { ok: true, message: 'boss will stop after in-flight tasks' } }
    }
    if (id === 'freeworker') {
      if (op === 'start') { fs.rmSync(path.join(FREE, 'STOP'), { force: true }); spawnDetached(process.execPath, [path.join(ROOT, 'scripts', 'free-worker', 'free-worker.mjs'), 'loop'], ROOT); return { ok: true, message: 'free-worker starting' } }
      if (op === 'stop') { fs.writeFileSync(path.join(FREE, 'STOP'), new Date().toISOString()); return { ok: true, message: 'free-worker will stop' } }
    }
    if (id === 'jorcord') {
      if (op === 'start') { spawnShell('pnpm dev', JORCORD); return { ok: true, message: 'jorcord starting (pnpm dev)' } }
      if (op === 'stop') { const pids = [...new Set([...portPids(3000), ...portPids(5173)])]; for (const p of pids) killPid(p); return { ok: true, message: `stopped jorcord (${pids.length} pid)` } }
    }
    return { ok: false, message: 'unknown service/op: ' + id + '/' + op }
  }

  if (action === 'kill') {
    const pid = Number(b.pid)
    if (!pid || pid === process.pid || pid <= 4) return { ok: false, message: 'refusing pid ' + pid }
    try { process.kill(pid, 'SIGKILL') } catch (e) { return { ok: false, message: e.message } }
    return { ok: true, message: 'killed ' + pid }
  }

  return { ok: false, message: 'unknown action ' + action }
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GhostForge Agent Control</title>
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
  main{padding:20px;max-width:1560px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
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
  button{cursor:pointer;font:600 12px ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:#1b2734;border:1px solid var(--line2);border-radius:8px;padding:5px 10px}
  button:hover{background:#243444;border-color:#3a4d60}
  button.start{border-color:#1b4a2a;color:#8fe0a4}
  button.stop{border-color:#5c2326;color:#f0a09a}
  button.tiny{padding:2px 7px;font-size:11px;border-radius:6px}
  input,select,textarea{background:#0a0e13;color:var(--ink);border:1px solid var(--line2);border-radius:8px;padding:6px 8px;font:13px ui-sans-serif,system-ui,sans-serif}
  .svc{display:flex;flex-wrap:wrap;gap:10px}
  .svc .chip{display:flex;align-items:center;gap:8px;padding:7px 11px;background:var(--surface2);border:1px solid var(--line);border-radius:10px;font-size:12.5px}
  .svc .chip b{font-weight:600}
  .svc .chip small{color:var(--muted)}
  #toast{position:fixed;right:16px;bottom:16px;z-index:9;background:#16202c;border:1px solid var(--line2);border-left:3px solid var(--accent);border-radius:8px;padding:10px 14px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
  #toast.show{opacity:1}
  @media (max-width:720px){ main{padding:12px} .card .v{font-size:17px} }
</style>
</head>
<body>
<header>
  <h1>🤝 GhostForge Agent Control <span id="sub">loading…</span></h1>
  <div class="grow"></div>
  <span class="pill" id="boss-pill"><i class="dot"></i> boss</span>
  <span class="pill" id="health-pill">health —</span>
  <span class="pill" id="ram-pill">ram —</span>
  <span class="pill" id="merges-pill">merges —</span>
  <span class="pill" id="updated-pill">—</span>
</header>
<main>
  <section>
    <h2>Overview</h2>
    <div class="row" id="overview"></div>
  </section>

  <section>
    <h2>Control <span class="hint">start · stop · talk · queue</span></h2>
    <div class="row" style="align-items:flex-start">
      <div class="card" style="flex:2 1 340px">
        <div class="k">Message the team</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <select id="say-to"></select>
          <input id="say-text" placeholder="message…" style="flex:1;min-width:200px">
          <button onclick="sendSay()">Send</button>
        </div>
        <div class="hint" style="margin-top:6px">Posts to the team bus — the boss and every agent read it on their next tick.</div>
      </div>
      <div class="card" style="flex:2 1 340px">
        <div class="k">Queue a task</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <select id="task-target" onchange="taskHint()"></select>
          <select id="task-effort" title="free-worker only"><option value="hard">hard</option><option value="easy">easy</option></select>
          <input id="task-title" placeholder="title…" style="flex:1;min-width:170px">
        </div>
        <textarea id="task-prompt" placeholder="what should it do?" style="width:100%;margin-top:8px;height:50px"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button onclick="sendTask()">Queue</button>
          <span class="hint" id="task-hint"></span>
        </div>
      </div>
      <div class="card" style="flex:1 1 240px">
        <div class="k">Team power</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="start" onclick="svc('boss','start')">▶ boss</button>
          <button class="stop" onclick="svc('boss','stop')">■ boss</button>
          <button class="start" onclick="svc('freeworker','start')">▶ free-worker</button>
          <button class="stop" onclick="svc('freeworker','stop')">■ free-worker</button>
          <button class="start" onclick="svc('jorcord','start')">▶ jorcord</button>
          <button class="stop" onclick="svc('jorcord','stop')">■ jorcord</button>
        </div>
        <div class="hint" style="margin-top:6px" id="power-hint"></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Services <span class="hint" id="svc-sub"></span></h2>
    <div class="svc" id="services"></div>
  </section>

  <section>
    <h2>Agents <span class="hint" id="agents-count"></span></h2>
    <div class="agent" id="agents"></div>
  </section>

  <section>
    <h2>Runtime <span class="hint" id="runtime-sub"></span></h2>
    <div class="row" id="runtime-cards" style="margin-bottom:10px"></div>
    <div class="scroll">
      <table>
        <thead><tr><th style="width:90px">Proc</th><th style="width:90px">PID</th><th style="width:100px">RAM</th><th style="width:80px"></th></tr></thead>
        <tbody id="proc-rows"></tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Sessions <span class="hint" id="sessions-sub"></span></h2>
    <div class="scroll">
      <table>
        <thead><tr><th style="width:70px">Age</th><th style="width:260px">Project</th><th style="width:70px">Size</th><th>First prompt</th></tr></thead>
        <tbody id="session-rows"></tbody>
      </table>
    </div>
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
        <thead><tr><th style="width:150px">Project</th><th style="width:70px">ID</th><th style="width:90px">Status</th><th style="width:200px">Model</th><th>Task</th></tr></thead>
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
<div id="toast"></div>

<script>
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return Math.floor(s) + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago' }
const time = ts => { try { return new Date(ts).toLocaleTimeString() } catch { return '—' } }
const mb = n => n >= 1024 ? (n/1024).toFixed(1) + ' GB' : Math.round(n) + ' MB'
const STATUS_ORDER = ['in-progress', 'review', 'todo', 'blocked', 'done']

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }

let toastTimer
function toast(msg, ok) {
  const t = $('toast'); t.textContent = msg; t.style.borderLeftColor = ok === false ? 'var(--bad)' : 'var(--accent)'
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600)
}

async function act(payload) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await r.json()
    toast(d.message || (d.ok ? 'ok' : 'failed'), d.ok)
    setTimeout(refresh, 500)
    return d
  } catch (e) { toast('error: ' + e.message, false) }
}

function renderHeader(d) {
  $('sub').textContent = d.boss.alive ? 'live' : 'offline'
  const pill = $('boss-pill')
  pill.innerHTML = '<i class="dot ' + (d.boss.alive ? 'ok' : 'bad') + '"></i> boss ' + (d.boss.alive ? 'running (pid ' + esc(d.boss.pid) + ')' : 'not running')
  const h = d.boss.health
  $('health-pill').innerHTML = 'health <b style="color:' + (h == null ? 'var(--muted)' : h >= 95 ? 'var(--ok)' : h >= 80 ? 'var(--warn)' : 'var(--bad)') + '">' + (h == null ? '—' : h + '%') + '</b>'
  const rt = d.runtime.total
  $('ram-pill').innerHTML = 'node/js <b style="color:var(--info)">' + mb(rt.mb) + '</b> · ' + rt.count + ' proc'
  $('merges-pill').textContent = 'merges ' + (d.boss.merges ?? '—')
  $('updated-pill').textContent = 'updated ' + time(d.now)
  document.title = (d.boss.alive ? '🟢' : '🔴') + ' ' + (d.board.byStatus['in-progress'] || 0) + ' active · GhostForge'
}

function renderOverview(d) {
  const total = d.board.total || 0, done = d.board.byStatus['done'] || 0
  const pct = total ? Math.round(done / total * 100) : 0
  const up = d.services.filter(s => s.up).length
  const cards = [
    ['Health', d.boss.health == null ? '—' : d.boss.health + '%', d.boss.alive ? 'boss running' : 'boss offline', '<div class="bar"><i style="width:' + (d.boss.health ?? 0) + '%"></i></div>'],
    ['Progress', pct + '%', done + ' of ' + total + ' tasks done', '<div class="bar"><i style="width:' + pct + '%"></i></div>'],
    ['Active', (d.board.byStatus['in-progress'] || 0) + (d.board.byStatus['review'] || 0), 'in-progress + review', ''],
    ['Services', up + '/' + d.services.length, 'listening now', ''],
    ['JS runtime', mb(d.runtime.total.mb), d.runtime.total.count + ' node/claude procs', ''],
    ['Sessions', d.sessions.length, 'Claude transcripts', ''],
    ['Blocked', d.board.byStatus['blocked'] || 0, 'needs a human', ''],
    ['Boss heartbeat', d.boss.heartbeat ? ago(d.boss.heartbeat) : '—', 'status.json mtime', ''],
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

function renderServices(d) {
  $('svc-sub').textContent = d.services.filter(s => s.up).length + ' up'
  $('services').replaceChildren(...d.services.map(s => {
    const chip = el('div', 'chip')
    chip.appendChild(el('span', 'dot ' + (s.up ? 'ok' : 'bad')))
    chip.appendChild(el('b', '', esc(s.label)))
    chip.appendChild(el('small', '', ':' + s.port + (s.up ? '' : ' · down')))
    return chip
  }))
}

function renderRuntime(d) {
  const by = d.runtime.byName
  $('runtime-sub').textContent = d.runtime.total.count + ' processes · ' + mb(d.runtime.total.mb)
  const order = Object.entries(by).sort((a, b) => b[1].mb - a[1].mb)
  $('runtime-cards').replaceChildren(...order.map(([name, v]) => {
    const c = el('div', 'card')
    c.appendChild(el('div', 'k', esc(name)))
    c.appendChild(el('div', 'v', mb(v.mb)))
    c.appendChild(el('div', 's', v.count + ' process' + (v.count === 1 ? '' : 'es')))
    return c
  }))
  const rows = d.runtime.procs.map(p => {
    const tr = document.createElement('tr')
    tr.innerHTML = '<td><span class="tag agent">' + esc(p.name) + '</span></td>' +
      '<td style="font-variant-numeric:tabular-nums;color:var(--muted)">' + p.pid + '</td>' +
      '<td style="font-variant-numeric:tabular-nums">' + mb(p.mb) + '</td>' +
      '<td><button class="tiny stop" onclick="killP(' + p.pid + ',\\'' + esc(p.name) + '\\')">kill</button></td>'
    return tr
  })
  if (!rows.length) rows.push(el('tr', '', '<td colspan="4" class="hint">No node/claude processes sampled.</td>'))
  $('proc-rows').replaceChildren(...rows)
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
    if (a.cooldownUntil) { const u = Date.parse(a.cooldownUntil); c.appendChild(el('div', 's', 'resting until ' + (isNaN(u) ? esc(a.cooldownUntil) : time(u)))) }
    if (cfg.role) c.appendChild(el('div', 's', esc(cfg.role)))
    c.appendChild(el('div', 's', '<button class="tiny" onclick="talkTo(\\'' + esc(id) + '\\')">message</button>'))
    return c
  }
}

function renderSessions(d) {
  $('sessions-sub').textContent = d.sessions.length + ' recent'
  const rows = d.sessions.map(s => {
    const tr = document.createElement('tr')
    tr.innerHTML =
      '<td style="color:var(--muted);white-space:nowrap">' + (s.active ? '<span class="dot ok" style="display:inline-block;margin-right:5px"></span>' : '') + ago(s.mtime) + '</td>' +
      '<td style="color:var(--muted);font-size:12px;word-break:break-all">' + esc(s.project) + '</td>' +
      '<td style="font-variant-numeric:tabular-nums">' + (s.size > 1048576 ? (s.size/1048576).toFixed(1) + ' MB' : Math.round(s.size/1024) + ' KB') + '</td>' +
      '<td>' + esc(s.title || s.id) + '</td>'
    return tr
  })
  if (!rows.length) rows.push(el('tr', '', '<td colspan="4" class="hint">No Claude sessions found.</td>'))
  $('session-rows').replaceChildren(...rows)
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
      '<td style="color:var(--muted);font-variant-numeric:tabular-nums">' + esc(t.id) + '</td>' +
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
    e.innerHTML = '<span class="t">' + time(Math.floor(m.ts ? Date.parse(m.ts) : 0) || 0) + '</span>' +
      '<span class="who">' + esc(m.from) + '</span><span class="to">→ ' + esc(m.to) + '</span>' +
      '<span class="x">' + esc(m.text) + '</span>'
    return e
  }))
}

function renderLog(d) {
  $('log').textContent = d.log.length ? d.log.join('\\n') : '(no log yet)'
}

function renderTargets(d) {
  const say = $('say-to'), task = $('task-target')
  if (say.options.length !== d.targets.say.length) { say.replaceChildren(...d.targets.say.map(t => new Option(t, t))) }
  if (task.options.length !== d.targets.tasks.length) { task.replaceChildren(...d.targets.tasks.map(t => new Option(t === 'boss' ? 'boss board' : t + ' (free)', t))) }
  const p = d.teamPower
  $('power-hint').textContent = 'boss ' + (p.boss ? 'up' : 'down') + ' · free-worker ' + (p.freeworker ? 'up' : 'down') + ' · jorcord ' + (p.jorcord ? 'up' : 'down')
}

function sendSay() {
  const text = $('say-text').value.trim(); if (!text) return
  act({ action: 'say', to: $('say-to').value, text }).then(d => { if (d && d.ok) $('say-text').value = '' })
}
function talkTo(id) { $('say-to').value = id; $('say-text').focus(); toast('target set to ' + id) }
function taskHint() { $('task-effort').style.display = $('task-target').value === 'boss' ? 'none' : '' }
function sendTask() {
  const title = $('task-title').value.trim(); if (!title) { toast('title required', false); return }
  const target = $('task-target').value
  const payload = target === 'boss'
    ? { action: 'task', target: 'boss', title, notes: $('task-prompt').value.trim() }
    : { action: 'task', target, title, prompt: $('task-prompt').value.trim(), effort: $('task-effort').value }
  act(payload).then(d => { if (d && d.ok) { $('task-title').value = ''; $('task-prompt').value = '' } })
}
function svc(id, op) { act({ action: 'service', id, op }) }
function killP(pid, name) { if (confirm('Kill ' + name + ' (pid ' + pid + ')? This is forceful.')) act({ action: 'kill', pid }) }

async function refresh() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' })
    const d = await r.json()
    if (d.error) { $('sub').textContent = 'error: ' + d.error; return }
    renderHeader(d); renderOverview(d); renderTargets(d); renderServices(d); renderAgents(d)
    renderRuntime(d); renderSessions(d); renderBoard(d); renderMessages(d); renderFree(d); renderLog(d)
  } catch (e) { $('sub').textContent = 'offline — retrying' }
}
taskHint(); refresh()
setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 3000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
</script>
</body>
</html>`

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  if (req.method === 'POST' && url === '/api/action') {
    let body = ''
    req.on('data', c => { body += c; if (body.length > 262144) req.destroy() })
    req.on('end', async () => {
      let out
      try { out = await doAction(JSON.parse(body || '{}')) } catch (e) { out = { ok: false, message: e.message } }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })
    return
  }
  if (url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
    collectState().then(s => res.end(JSON.stringify(s)))
      .catch(e => res.end(JSON.stringify({ error: e.message, now: Date.now() })))
    return
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(PAGE)
  }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent control dashboard → http://127.0.0.1:${PORT}`)
  console.log(`Reading state from ${STATE}`)
})
