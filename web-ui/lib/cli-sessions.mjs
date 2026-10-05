// CLI sessions for Agent World: Claude Code + Copilot CLI sessions on the
// machine running this server. Served by /api/agents/cli-sessions (admin_tools)
// and switched off with GF_CLI_SESSIONS=0.
//
// A standalone copy of this collector also runs outside GhostForge as the
// external Agent World; keep the two in step when changing what is read.
//
// Metadata only. It reads ids, paths, models, timestamps, token/cost totals,
// tool *names*, error statuses and subagent *types*. It never returns message
// text, prompts, tool arguments, tool output, checkpoint notes, or subagent
// task descriptions. Copilot's `summary` column (prompt text) is included only
// when INCLUDE_SUMMARIES=1.
//
// Claude transcripts are parsed incrementally: each file remembers its byte
// offset, so a refresh reads only what was appended since the last one.
//
// Sources
//   Claude Code  ~/.claude/projects/<slug>/<session>.jsonl
//                ~/.claude/projects/<slug>/<session>/subagents/*.meta.json
//   Copilot CLI  ~/.copilot/session-store.db (read-only)
//                ~/.copilot/open-sessions-state.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude', 'projects')
const COPILOT_DIR = path.join(HOME, '.copilot')
const env = process.env
const INCLUDE_SUMMARIES = env.INCLUDE_SUMMARIES === '1'
const ACTIVE_MS = Number(env.ACTIVE_WINDOW_MS || 15 * 60_000) // "active": wrote within this window
const LIVE_MS = 2 * 60_000                                       // "working": wrote within this window
const STALL_MS = 10 * 60_000                                     // tool call with no result for this long
const RECENT_MS = 7 * 24 * 60 * 60_000                           // sessions shown at all
const TIMELINE_BUCKET_MS = 5 * 60_000
const TIMELINE_BUCKETS = 24                                      // 2 hours of 5-minute buckets
const MAX_EVENTS = 25
const MAX_READ_BYTES = 64 * 1024 * 1024                          // per read chunk

const clip = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
const toMs = v => { const t = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(t) ? t : 0 }
const iso = ms => (ms ? new Date(ms).toISOString() : undefined)

// --- Claude Code: incremental transcript parser ------------------------------

/** One entry per transcript file: parse position plus accumulated metadata. */
const claudeCache = new Map()

function freshClaudeStats() {
  return {
    model: undefined, models: {}, cwd: undefined, gitBranch: undefined, version: undefined, entrypoint: undefined,
    firstTs: 0, lastTs: 0,
    prompts: 0, assistantMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: undefined,
    tools: {}, toolCalls: 0, lastTool: undefined, pendingTools: new Map(),
    toolErrors: 0, apiErrors: {}, lastError: undefined, lastApiError: undefined,
    subagentCalls: 0,
    buckets: new Map(), // bucket start ms -> activity count
    events: [],
    seenMessages: new Set(), seenTools: new Set(),
  }
}

function pushEvent(st, ev) {
  st.events.push(ev)
  if (st.events.length > MAX_EVENTS) st.events.shift()
}

function bump(st, ts) {
  if (!ts) return
  const b = Math.floor(ts / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS
  st.buckets.set(b, (st.buckets.get(b) ?? 0) + 1)
}

function applyClaudeRecord(st, o) {
  const ts = toMs(o.timestamp)
  if (ts) { st.firstTs = st.firstTs ? Math.min(st.firstTs, ts) : ts; st.lastTs = Math.max(st.lastTs, ts) }
  if (o.cwd) st.cwd = clip(o.cwd, 300)
  if (o.gitBranch) st.gitBranch = clip(o.gitBranch, 120)
  if (o.version) st.version = clip(o.version, 40)
  if (o.entrypoint) st.entrypoint = clip(o.entrypoint, 40)

  if (o.type === 'cost-state') {
    // Written by Claude Code itself; the last one is authoritative.
    const models = {}
    for (const [m, u] of Object.entries(o.modelUsage ?? {})) {
      models[m] = {
        input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, thinking: u.thinkingTokens ?? 0,
        cacheRead: u.cacheReadInputTokens ?? 0, cacheWrite: u.cacheCreationInputTokens ?? 0, costUSD: u.costUSD ?? 0,
      }
    }
    st.cost = {
      usd: o.totalCostUSD ?? 0, apiMs: o.totalAPIDuration ?? 0, toolMs: o.totalToolDuration ?? 0,
      linesAdded: o.totalLinesAdded ?? 0, linesRemoved: o.totalLinesRemoved ?? 0, models,
    }
    return
  }

  if (o.type === 'assistant' && o.message) {
    const m = o.message
    if (o.isApiErrorMessage) {
      const status = String(o.apiErrorStatus ?? o.error ?? 'error')
      st.apiErrors[status] = (st.apiErrors[status] ?? 0) + 1
      st.lastError = st.lastApiError = { ts: iso(ts), kind: 'api', status, type: clip(typeof o.error === 'string' ? o.error : undefined, 60) }
      pushEvent(st, { ts: iso(ts), type: 'error', name: status === '429' ? 'rate limited' : `api ${status}` })
      return
    }
    if (m.model && m.model !== '<synthetic>') {
      st.model = clip(m.model, 80)
      st.models[st.model] = (st.models[st.model] ?? 0) + 1
    }
    // Claude Code writes one record per content block, repeating the message id
    // and its usage, so count each message once.
    if (m.id && !st.seenMessages.has(m.id)) {
      st.seenMessages.add(m.id)
      st.assistantMessages++
      const u = m.usage ?? {}
      st.tokens.input += u.input_tokens ?? 0
      st.tokens.output += u.output_tokens ?? 0
      st.tokens.cacheRead += u.cache_read_input_tokens ?? 0
      st.tokens.cacheWrite += u.cache_creation_input_tokens ?? 0
      bump(st, ts)
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type !== 'tool_use' || !c.id || st.seenTools.has(c.id)) continue
      st.seenTools.add(c.id)
      const name = clip(c.name, 80) ?? 'tool'
      st.tools[name] = (st.tools[name] ?? 0) + 1
      st.toolCalls++
      st.lastTool = { name, ts: iso(ts) }
      st.pendingTools.set(c.id, ts)
      if (name === 'Agent' || name === 'Task') st.subagentCalls++
      pushEvent(st, { ts: iso(ts), type: name === 'Agent' || name === 'Task' ? 'subagent' : 'tool', name })
    }
    return
  }

  if (o.type === 'user' && o.message) {
    const content = o.message.content
    if (typeof content === 'string') { st.prompts++; bump(st, ts); pushEvent(st, { ts: iso(ts), type: 'prompt', name: 'user turn' }); return }
    if (!Array.isArray(content)) return
    let sawText = false
    for (const c of content) {
      if (c.type === 'tool_result') {
        st.pendingTools.delete(c.tool_use_id)
        if (c.is_error) { st.toolErrors++; st.lastError = { ts: iso(ts), kind: 'tool' }; pushEvent(st, { ts: iso(ts), type: 'error', name: 'tool error' }) }
      } else if (c.type === 'text') sawText = true
    }
    if (sawText && !o.isMeta) { st.prompts++; bump(st, ts); pushEvent(st, { ts: iso(ts), type: 'prompt', name: 'user turn' }) }
  }
}

/** Read whatever was appended to a transcript since the last refresh. */
function refreshClaudeFile(file, stat) {
  let entry = claudeCache.get(file)
  if (!entry || stat.size < entry.offset) entry = { offset: 0, partial: '', stats: freshClaudeStats() }
  if (stat.size > entry.offset) {
    const fd = fs.openSync(file, 'r')
    try {
      while (entry.offset < stat.size) {
        const len = Math.min(stat.size - entry.offset, MAX_READ_BYTES)
        const buf = Buffer.alloc(len)
        const read = fs.readSync(fd, buf, 0, len, entry.offset)
        if (!read) break
        entry.offset += read
        const text = entry.partial + buf.subarray(0, read).toString('utf8')
        const lines = text.split('\n')
        entry.partial = lines.pop() ?? '' // incomplete last line, finished next time
        for (const line of lines) {
          if (!line) continue
          let o
          try { o = JSON.parse(line) } catch { continue }
          applyClaudeRecord(entry.stats, o)
        }
      }
    } finally { fs.closeSync(fd) }
  }
  claudeCache.set(file, entry)
  return entry.stats
}

function readSubagents(dir) {
  const sub = path.join(dir, 'subagents')
  let files = []
  try { files = fs.readdirSync(sub).filter(f => f.endsWith('.meta.json')) } catch { return [] }
  return files.slice(-50).flatMap(f => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(sub, f), 'utf8'))
      let mtime = 0
      try { mtime = fs.statSync(path.join(sub, f.replace(/\.meta\.json$/, '.jsonl'))).mtimeMs } catch {}
      // agentType only: `description` is task text written for the subagent.
      return [{ id: f.replace(/\.meta\.json$/, ''), type: clip(meta.agentType, 60) ?? 'agent', depth: meta.spawnDepth ?? 1, background: meta.requestShape === 'background', updatedAt: iso(mtime) }]
    } catch { return [] }
  })
}

function readClaudeSessions(now) {
  const out = []
  const errors = []
  let dirs = []
  try { dirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true }).filter(d => d.isDirectory()) }
  catch (e) { if (fs.existsSync(CLAUDE_DIR)) errors.push(`claude projects unreadable: ${e.message}`); return { sessions: out, errors, total: 0 } }

  let total = 0
  for (const dir of dirs) {
    const full = path.join(CLAUDE_DIR, dir.name)
    let files = []
    try { files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const name of files) {
      total++
      const file = path.join(full, name)
      let stat
      try { stat = fs.statSync(file) } catch { continue }
      if (now - stat.mtimeMs > RECENT_MS) continue
      let st
      try { st = refreshClaudeFile(file, stat) } catch (e) { errors.push(`${name}: ${e.message}`); continue }
      const id = name.replace(/\.jsonl$/, '')
      out.push({ id, projectSlug: dir.name, mtime: stat.mtimeMs, createdMs: stat.birthtimeMs || st.firstTs, st, subagents: readSubagents(path.join(full, id)) })
    }
  }
  return { sessions: out, errors, total }
}

function shapeClaude(s, now) {
  const st = s.st
  const lastMs = Math.max(s.mtime, st.lastTs)
  const pendingOld = [...st.pendingTools.values()].some(t => now - t > STALL_MS)
  const tokensTotal = st.tokens.input + st.tokens.output + st.tokens.cacheRead + st.tokens.cacheWrite
  // Health reflects the API and stalls only; tool errors (a failed edit, a
  // denied permission) are routine and only counted.
  const api = st.lastApiError && now - toMs(st.lastApiError.ts) < ACTIVE_MS ? st.lastApiError : null
  // A later successful reply means the session recovered.
  const recovered = api && st.lastTs > toMs(api.ts) && st.lastTool && toMs(st.lastTool.ts) > toMs(api.ts)
  const health = pendingOld && now - lastMs > STALL_MS ? 'stalled'
    : api && !recovered ? (api.status === '429' ? 'rate-limited' : 'erroring') : 'ok'
  return {
    base: {
      id: s.id, provider: 'claude-code', projectSlug: s.projectSlug,
      cwd: st.cwd, gitBranch: st.gitBranch, model: st.model, version: st.version, entrypoint: st.entrypoint,
      createdAt: iso(st.firstTs || s.createdMs), updatedAt: iso(lastMs), lastMs,
      prompts: st.prompts, messages: st.assistantMessages,
      tokens: { ...st.tokens, total: tokensTotal },
      costUSD: st.cost?.usd,
      linesAdded: st.cost?.linesAdded, linesRemoved: st.cost?.linesRemoved,
      toolCalls: st.toolCalls, topTool: topOf(st.tools), lastTool: st.lastTool,
      subagents: Math.max(st.subagentCalls, s.subagents.length),
      errors: st.toolErrors + sum(st.apiErrors),
      health,
      timeline: timeline(st.buckets, now),
    },
    detail: {
      models: st.models, modelUsage: st.cost?.models ?? {},
      tools: sortedCounts(st.tools), toolErrors: st.toolErrors, apiErrors: st.apiErrors, lastError: st.lastError,
      apiMs: st.cost?.apiMs, toolMs: st.cost?.toolMs,
      subagentList: s.subagents.slice(-20).reverse(),
      events: st.events.slice().reverse(),
    },
  }
}

// --- Copilot CLI ----------------------------------------------------------------

let DatabaseSync
async function openCopilot() {
  const dbPath = path.join(COPILOT_DIR, 'session-store.db')
  if (!fs.existsSync(dbPath)) return null
  DatabaseSync ??= (await import('node:sqlite')).DatabaseSync
  return new DatabaseSync(dbPath, { readOnly: true })
}

function groupBy(list) {
  const m = new Map()
  for (const r of list) {
    const k = r.session_id
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

async function readCopilotSessions(now, limit) {
  let db
  try { db = await openCopilot() } catch (e) { return { sessions: [], errors: [`copilot store unavailable: ${e.message}`], total: 0 } }
  if (!db) return { sessions: [], errors: [], total: 0 }
  let open = {}
  try { open = JSON.parse(fs.readFileSync(path.join(COPILOT_DIR, 'open-sessions-state.json'), 'utf8')) } catch {}

  try {
    const total = db.prepare('SELECT count(*) c FROM sessions').get().c
    const since = new Date(now - RECENT_MS).toISOString()
    const rows = db.prepare(
      `SELECT id, cwd, repository, branch, summary, created_at, updated_at
       FROM sessions WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT ?`,
    ).all(since, limit)
    if (!rows.length) return { sessions: [], errors: [], total }
    const ids = rows.map(r => r.id)
    const marks = ids.map(() => '?').join(',')

    const usage = new Map(db.prepare(
      `SELECT session_id, count(*) requests, sum(input_tokens) input, sum(output_tokens) output,
              sum(cache_read_tokens) cacheRead, sum(cache_write_tokens) cacheWrite, sum(reasoning_tokens) reasoning,
              sum(total_nano_aiu) nanoAiu, sum(duration_ms) apiMs, count(DISTINCT agent_id) subagents,
              sum(CASE WHEN finish_reason NOT IN ('stop','tool_calls','tool_use','end_turn') THEN 1 ELSE 0 END) badFinish,
              sum(content_filter_triggered) filtered, max(created_at) lastAt, min(created_at) firstAt
       FROM assistant_usage_events WHERE session_id IN (${marks}) GROUP BY session_id`,
    ).all(...ids).map(r => [r.session_id, r]))
    const modelsBy = groupBy(db.prepare(
      `SELECT session_id, model, count(*) n, max(created_at) lastAt FROM assistant_usage_events
       WHERE session_id IN (${marks}) GROUP BY session_id, model`,
    ).all(...ids))
    const turns = new Map(db.prepare(
      `SELECT session_id, count(*) n FROM turns WHERE session_id IN (${marks}) GROUP BY session_id`,
    ).all(...ids).map(r => [r.session_id, r.n]))
    const filesBy = groupBy(db.prepare(
      `SELECT session_id, tool_name, count(*) n FROM session_files WHERE session_id IN (${marks}) GROUP BY session_id, tool_name`,
    ).all(...ids))
    const bucketSince = new Date(now - TIMELINE_BUCKETS * TIMELINE_BUCKET_MS).toISOString()
    const activityBy = groupBy(db.prepare(
      `SELECT session_id, created_at FROM assistant_usage_events WHERE session_id IN (${marks}) AND created_at >= ?`,
    ).all(...ids, bucketSince))
    const recentBy = groupBy(db.prepare(
      `SELECT session_id, model, finish_reason, agent_id, created_at FROM assistant_usage_events
       WHERE session_id IN (${marks}) ORDER BY created_at DESC LIMIT 3000`,
    ).all(...ids))

    const sessions = rows.map(r => {
      const u = usage.get(r.id) ?? {}
      const o = open[r.id]
      const buckets = new Map()
      for (const a of activityBy.get(r.id) ?? []) {
        const b = Math.floor(toMs(a.created_at) / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS
        buckets.set(b, (buckets.get(b) ?? 0) + 1)
      }
      const models = modelsBy.get(r.id) ?? []
      const lastModel = models.slice().sort((a, b) => toMs(b.lastAt) - toMs(a.lastAt))[0]?.model
      const tools = Object.fromEntries((filesBy.get(r.id) ?? []).map(f => [f.tool_name ?? 'tool', f.n]))
      const lastMs = Math.max(toMs(r.updated_at), toMs(u.lastAt))
      const tokens = { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0 }
      return {
        base: {
          id: r.id, provider: 'copilot-cli', name: INCLUDE_SUMMARIES ? clip(r.summary, 200) : undefined,
          cwd: clip(r.cwd, 300), repository: clip(r.repository, 160), gitBranch: clip(r.branch, 120),
          model: clip(lastModel, 80),
          createdAt: iso(toMs(r.created_at) || toMs(u.firstAt)), updatedAt: iso(lastMs), lastMs,
          prompts: turns.get(r.id) ?? 0, messages: u.requests ?? 0,
          tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite },
          aiu: u.nanoAiu ? u.nanoAiu / 1e9 : undefined,
          toolCalls: sum(tools), topTool: topOf(tools),
          subagents: u.subagents ?? 0,
          errors: (u.badFinish ?? 0) + (u.filtered ?? 0),
          open: !!o, working: !!o?.working,
          health: (u.badFinish ?? 0) > 0 && now - lastMs < ACTIVE_MS ? 'erroring' : 'ok',
          timeline: timeline(buckets, now),
        },
        detail: {
          models: Object.fromEntries(models.map(m => [m.model, m.n])),
          modelUsage: {}, tools: sortedCounts(tools), toolErrors: 0,
          apiErrors: u.badFinish ? { 'abnormal finish': u.badFinish } : {}, contentFiltered: u.filtered ?? 0,
          apiMs: u.apiMs, reasoningTokens: u.reasoning ?? 0,
          subagentList: [],
          events: (recentBy.get(r.id) ?? []).slice(0, MAX_EVENTS).map(e => ({
            ts: iso(toMs(e.created_at)), type: e.agent_id ? 'subagent' : 'request', name: `${e.model ?? 'model'} · ${e.finish_reason ?? '…'}`,
          })),
        },
      }
    })
    return { sessions, errors: [], total }
  } catch (e) {
    return { sessions: [], errors: [`copilot query failed: ${e.message}`], total: 0 }
  } finally { db.close() }
}

// --- helpers --------------------------------------------------------------------

function sum(obj) { return Object.values(obj ?? {}).reduce((a, b) => a + (Number(b) || 0), 0) }
function topOf(counts) { const e = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]; return e ? { name: e[0], count: e[1] } : undefined }
function sortedCounts(counts) { return Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) }
function timeline(buckets, now) {
  const end = Math.floor(now / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS
  return Array.from({ length: TIMELINE_BUCKETS }, (_, i) => buckets.get(end - (TIMELINE_BUCKETS - 1 - i) * TIMELINE_BUCKET_MS) ?? 0)
}
function statusOf(lastMs, now, working) {
  if (working || now - lastMs <= LIVE_MS) return 'working'
  return now - lastMs <= ACTIVE_MS ? 'active' : 'idle'
}

// --- snapshot -------------------------------------------------------------------

let lastDetails = new Map()

/**
 * Build the world snapshot. Sessions carry summary fields only; per-session
 * detail (tool breakdown, events, subagents, model usage) is kept for
 * getSessionDetail() so the list stays small.
 */
export async function buildSnapshot({ maxSessions = Number(env.MAX_SESSIONS || 300) } = {}) {
  const now = Date.now()
  const claude = readClaudeSessions(now)
  const copilot = await readCopilotSessions(now, maxSessions)

  const shaped = [...claude.sessions.map(s => shapeClaude(s, now)), ...copilot.sessions]
    .sort((a, b) => b.base.lastMs - a.base.lastMs)
    .slice(0, maxSessions * 2)

  const details = new Map()
  const sessions = shaped.map(({ base, detail }) => {
    const status = statusOf(base.lastMs, now, base.working)
    details.set(base.id, { ...base, status, ...detail })
    const { lastMs, ...rest } = base
    return { ...rest, status, state: status }
  })
  lastDetails = details

  // One agent per provider + model among sessions active right now.
  const groups = new Map()
  for (const s of sessions) {
    if (s.status === 'idle') continue
    const key = `${s.provider}:${s.model ?? 'model-pending'}`
    const g = groups.get(key) ?? { id: key, name: key, provider: s.provider, model: s.model, sessions: 0, working: 0, tokens: 0, costUSD: 0, toolCalls: 0, projects: [] }
    g.sessions++
    if (s.status === 'working') g.working++
    g.tokens += s.tokens?.total ?? 0
    g.costUSD += s.costUSD ?? 0
    g.toolCalls += s.toolCalls ?? 0
    const proj = (s.cwd ?? '').split(/[\\/]+/).filter(Boolean).at(-1)
    if (proj && !g.projects.includes(proj)) g.projects.push(proj)
    groups.set(key, g)
  }

  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0)
  const todays = sessions.filter(s => toMs(s.updatedAt) >= midnight.getTime())
  const toolTotals = {}
  for (const d of details.values()) for (const t of d.tools ?? []) toolTotals[t.name] = (toolTotals[t.name] ?? 0) + t.count

  const errors = [...claude.errors.slice(0, 5), ...copilot.errors]
  const add = (list, f) => list.reduce((a, s) => a + (f(s) ?? 0), 0)
  return {
    version: 2,
    heartbeat: new Date(now).toISOString(),
    device: os.hostname(),
    counts: {
      sessions: sessions.length,
      active: sessions.filter(s => s.status !== 'idle').length,
      working: sessions.filter(s => s.status === 'working').length,
      agents: groups.size,
      claude: claude.total, copilot: copilot.total,
      claudeShown: sessions.filter(s => s.provider === 'claude-code').length,
      copilotShown: sessions.filter(s => s.provider === 'copilot-cli').length,
      unhealthy: sessions.filter(s => s.status !== 'idle' && s.health !== 'ok').length,
    },
    totals: {
      // "today" = sessions active since local midnight; their whole-session totals.
      today: {
        costUSD: add(todays, s => s.costUSD), aiu: add(todays, s => s.aiu),
        tokens: add(todays, s => s.tokens?.total), toolCalls: add(todays, s => s.toolCalls), errors: add(todays, s => s.errors),
      },
      topTools: sortedCounts(toolTotals).slice(0, 8),
      timeline: sessions.reduce((acc, s) => acc.map((v, i) => v + (s.timeline?.[i] ?? 0)), Array(TIMELINE_BUCKETS).fill(0)),
      timelineBucketMinutes: TIMELINE_BUCKET_MS / 60_000,
    },
    agents: [...groups.values()],
    tasks: [],
    sessions,
    events: errors.map(e => ({ ts: new Date(now).toISOString(), type: 'collector.error', error: e })),
  }
}

/** Full detail for one session from the most recent snapshot. */
export function getSessionDetail(id) {
  const d = lastDetails.get(id)
  if (!d) return null
  const { lastMs, ...rest } = d
  return rest
}
