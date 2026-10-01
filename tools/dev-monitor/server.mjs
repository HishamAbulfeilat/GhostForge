#!/usr/bin/env node

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(HERE, '../..')
const MAX_STATE_FILE_BYTES = 1024 * 1024
const MAX_SESSION_FILES = 400
const MAX_SESSION_DEPTH = 3
const MAX_BOARD_TASKS = 300
const MAX_MESSAGES = 30
const SECRET_ASSIGNMENT = /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|authorization|cookie|credential)\b\s*[:=]\s*["']?[^\s,"'}]+/ig
const SECRET_TOKEN = /\b(?:Bearer\s+[A-Za-z0-9._~+/-]+=*|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/ig
const SENSITIVE_WORDS = /\b(?:password|passwd|secret|private key|credential|access token|api key)\b/i
const FIELD_KEYS = {
  cwd: new Set(['cwd', 'workingdirectory', 'working_directory', 'workspacepath', 'workspace_path', 'projectpath', 'project_path']),
  branch: new Set(['branch', 'branchname', 'branch_name', 'gitbranch', 'git_branch']),
  name: new Set(['displayname', 'display_name', 'sessionname', 'session_name', 'agentname', 'agent_name', 'name']),
  activity: new Set(['updatedat', 'updated_at', 'lastactivity', 'last_activity', 'lastmessageat', 'last_message_at', 'modifiedat', 'modified_at', 'timestamp']),
  summary: new Set(['summary', 'lastmessagesummary', 'last_message_summary']),
}
const SKIP_KEYS = /^(?:token|secret|password|authorization|cookie|messages|transcript|conversation|history|events|content|text|prompt|response)$/i

export function sanitizeText(value, limit = 240) {
  if (typeof value !== 'string') return ''
  let text = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(SECRET_ASSIGNMENT, '$1=[redacted]')
    .replace(SECRET_TOKEN, '[redacted]')
    .replace(/([?&](?:token|key|secret|password|auth|signature)=)[^&#\s]*/ig, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text
}

function safeSummary(value) {
  if (typeof value !== 'string') return ''
  if (SENSITIVE_WORDS.test(value) || /\bBearer\s+|(?:gh[pousr]_|\bgithub_pat_|\bsk-|\bxox[baprs]-|eyJ[A-Za-z0-9_-]{8,}\.)/i.test(value)) {
    return '[sensitive message omitted]'
  }
  const text = sanitizeText(value, 180)
  const sentenceEnd = text.search(/[.!?](?:\s|$)/)
  return sentenceEnd >= 0 ? text.slice(0, sentenceEnd + 1) : text
}

function regularFile(file) {
  try { return fs.lstatSync(file).isFile() } catch { return false }
}

function readJSON(file, maxBytes = MAX_STATE_FILE_BYTES) {
  try {
    if (!regularFile(file)) return null
    const stat = fs.statSync(file)
    if (stat.size > maxBytes) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const normalized = path.resolve(value).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  } catch {
    return ''
  }
}

function isProjectPath(value, root) {
  return normalizePath(value) === normalizePath(root)
}

function collectFields(value, depth = 0, output = { cwd: '', branch: '', name: '', activity: '', summary: '' }) {
  if (!value || typeof value !== 'object' || depth > 8) return output
  const entries = Array.isArray(value) ? value.slice(0, 100) : Object.entries(value).slice(0, 200)
  for (const entry of entries) {
    const [key, item] = Array.isArray(value) ? ['', entry] : entry
    const field = Object.entries(FIELD_KEYS).find(([, keys]) => keys.has(String(key).toLowerCase()))?.[0]
    if (field && typeof item === 'string' && !output[field]) output[field] = item
    if (typeof item === 'object' && item !== null && !SKIP_KEYS.test(String(key))) {
      collectFields(item, depth + 1, output)
    }
  }
  return output
}

function messageText(record) {
  if (!record || typeof record !== 'object') return ''
  const role = [record.role, record.type, record.kind, record.event, record.name]
    .filter(value => typeof value === 'string').join(' ').toLowerCase()
  if (!/(?:user|assistant).*(?:message|prompt|response)?|(?:message|prompt|response).*(?:user|assistant)/.test(role)) return ''
  const candidates = [record.content, record.text, record.message, record.data]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate
    if (candidate && typeof candidate === 'object') {
      const parts = Array.isArray(candidate) ? candidate : [candidate]
      const text = parts.filter(part => part && typeof part === 'object' && typeof part.text === 'string')
        .map(part => part.text).join(' ')
      if (text) return text
      if (typeof candidate.content === 'string') return candidate.content
    }
  }
  return ''
}

function readTail(file, maxBytes = 64 * 1024) {
  try {
    if (!regularFile(file)) return ''
    const stat = fs.statSync(file)
    const length = Math.min(stat.size, maxBytes)
    const fd = fs.openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, stat.size - length)
      return buffer.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function sessionFiles(base, maxDepth = MAX_SESSION_DEPTH) {
  const files = []
  const groups = new Map()
  let examined = 0
  const visit = (directory, depth) => {
    if (depth > maxDepth || files.length >= MAX_SESSION_FILES || examined >= 2000) return
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= MAX_SESSION_FILES || examined >= 2000) break
      examined++
      const fullPath = path.join(directory, entry.name)
      if (entry.isFile() && /\.(?:json|jsonl|ndjson)$/i.test(entry.name)) {
        const relative = path.relative(base, fullPath)
        const group = relative.split(path.sep)[0]
        if (!groups.has(group)) groups.set(group, [])
        const item = { file: fullPath, group }
        groups.get(group).push(item)
        files.push(item)
      } else if (entry.isDirectory()) {
        visit(fullPath, depth + 1)
      }
    }
  }
  if (fs.existsSync(base)) visit(base, 0)
  return [...groups.values()]
}

function inspectSessionFile(file) {
  const extension = path.extname(file).toLowerCase()
  let fields = { cwd: '', branch: '', name: '', activity: '', summary: '' }
  let lastMessage = ''
  if (extension === '.jsonl' || extension === '.ndjson') {
    const lines = readTail(file).split(/\r?\n/).filter(line => line.length > 0).slice(-80)
    for (const line of lines) {
      if (Buffer.byteLength(line, 'utf8') > 16 * 1024) continue
      try {
        const record = JSON.parse(line)
        fields = collectFields(record, 0, fields)
        const text = messageText(record)
        if (text) lastMessage = text
      } catch { /* Ignore partial or malformed session events. */ }
    }
  } else {
    const record = readJSON(file, 256 * 1024)
    if (record) {
      fields = collectFields(record, 0, fields)
      lastMessage = typeof record.lastMessageSummary === 'string' ? record.lastMessageSummary : ''
    }
  }
  let modifiedAt = ''
  try { modifiedAt = fs.statSync(file).mtime.toISOString() } catch { /* File may disappear during refresh. */ }
  return { ...fields, lastMessage, modifiedAt }
}

function discoverSessions({ base, provider, root, claudeProject = false }) {
  const groupedFiles = sessionFiles(base)
  const sessions = []
  for (const groupFiles of groupedFiles) {
    const records = groupFiles.map(item => ({ ...inspectSessionFile(item.file), file: item.file }))
    const matching = records.filter(record => record.cwd && isProjectPath(record.cwd, root))
    if (!matching.length && !claudeProject) continue
    const selected = [...(matching.length ? matching : records)].sort((a, b) =>
      String(b.activity || b.modifiedAt).localeCompare(String(a.activity || a.modifiedAt)))[0]
    const latestMessage = records
      .filter(record => record.lastMessage)
      .sort((a, b) => String(b.activity || b.modifiedAt).localeCompare(String(a.activity || a.modifiedAt)))[0]
    const group = groupFiles[0].group
    const folderName = path.basename(group)
    const branch = selected.branch ? sanitizeText(selected.branch, 120) : ''
    const name = sanitizeText(selected.name || `${provider} ${folderName}`, 120)
    const activityCandidates = records.map(record => record.activity || record.modifiedAt).filter(Boolean).sort()
    const activity = activityCandidates.at(-1) || ''
    const summary = safeSummary(latestMessage?.lastMessage || selected.summary)
    sessions.push({
      provider,
      name,
      cwd: root,
      branch,
      lastActivity: activity,
      lastMessageSummary: summary || 'No recent message summary available.',
    })
  }
  return sessions.sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity))).slice(0, 100)
}

function safeTask(task, result) {
  if (!task || typeof task !== 'object') return null
  const dependencies = Array.isArray(task.dependencies)
    ? task.dependencies.map(item => sanitizeText(String(item), 40)).filter(Boolean).slice(0, 40)
    : []
  return {
    id: sanitizeText(String(task.id ?? ''), 40),
    title: sanitizeText(String(task.title ?? ''), 200),
    kind: sanitizeText(String(task.kind ?? ''), 40),
    status: sanitizeText(String(task.status ?? 'todo'), 40),
    owner: sanitizeText(String(task.owner ?? task.agent ?? ''), 80),
    assignee: sanitizeText(String(task.assignee ?? ''), 80),
    leader: sanitizeText(String(task.leader ?? ''), 80),
    workflow: sanitizeText(String(task.workflow ?? ''), 40),
    area: Array.isArray(task.area) ? task.area.map(item => sanitizeText(String(item), 120)).slice(0, 20) : [],
    dependencies,
    updatedAt: sanitizeText(String(task.updatedAt ?? task.updated_at ?? ''), 80),
    summary: safeSummary(typeof result?.summary === 'string' ? result.summary : ''),
  }
}

function safeAgent(name, status = {}, config = {}, root = '') {
  const worktree = typeof config.worktree === 'string' ? path.resolve(root, config.worktree) : ''
  return {
    name: sanitizeText(name, 80),
    provider: sanitizeText(String(config.provider ?? status.provider ?? ''), 40),
    state: sanitizeText(String(status.state ?? (config.enabled ? 'idle' : 'disabled')), 40),
    task: sanitizeText(String(status.task ?? ''), 120),
    progress: sanitizeText(String(status.progress ?? ''), 120),
    branch: sanitizeText(String(status.branch ?? config.branch ?? ''), 120),
    cwd: worktree ? sanitizeText(worktree, 240) : name === 'boss' ? sanitizeText(root, 240) : '',
    lastActivity: sanitizeText(String(status.ts ?? status.lastActivity ?? status.updatedAt ?? ''), 80),
  }
}

function readMessages(stateDir) {
  const file = path.join(stateDir, 'messages.jsonl')
  const lines = readTail(file, 128 * 1024).split(/\r?\n/).filter(Boolean).slice(-MAX_MESSAGES * 4)
  const messages = []
  for (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > 12 * 1024) continue
    try {
      const item = JSON.parse(line)
      if (!item || typeof item !== 'object') continue
      messages.push({
        ts: sanitizeText(String(item.ts ?? ''), 80),
        from: sanitizeText(String(item.from ?? ''), 80),
        to: sanitizeText(String(item.to ?? ''), 80),
        summary: safeSummary(String(item.text ?? '')),
      })
    } catch { /* Ignore a torn append at the end of the message bus. */ }
  }
  return messages.slice(-MAX_MESSAGES)
}

function readResults(stateDir) {
  const resultDir = path.join(stateDir, 'results')
  const results = new Map()
  let entries
  try { entries = fs.readdirSync(resultDir, { withFileTypes: true }) } catch { return results }
  for (const entry of entries.slice(0, MAX_BOARD_TASKS)) {
    if (!entry.isFile() || !/^T-[A-Za-z0-9_-]+\.json$/i.test(entry.name)) continue
    const result = readJSON(path.join(resultDir, entry.name), 64 * 1024)
    if (result && typeof result === 'object') results.set(entry.name.slice(0, -5), result)
  }
  return results
}

function readTeamConfig(root) {
  return readJSON(path.join(root, '.agent-sync', 'team.json'), 256 * 1024) ?? {}
}

export function buildSnapshot({ root = DEFAULT_ROOT, stateDir = process.env.GF_AGENT_STATE || path.join(root, '.agent-sync', 'state'), homeDir = os.homedir() } = {}) {
  const board = readJSON(path.join(stateDir, 'board.json'), 2 * 1024 * 1024) ?? { phase: 0, tasks: [] }
  const status = readJSON(path.join(stateDir, 'status.json'), 256 * 1024) ?? {}
  const config = readTeamConfig(root)
  const results = readResults(stateDir)
  const tasks = Array.isArray(board.tasks)
    ? board.tasks.slice(0, MAX_BOARD_TASKS).map(task => safeTask(task, results.get(String(task?.id ?? '')))).filter(task => task.id)
    : []
  const activeAgents = status.agents && typeof status.agents === 'object' ? status.agents : {}
  const configuredAgents = config.agents && typeof config.agents === 'object' ? config.agents : {}
  const agentNames = new Set([...Object.keys(configuredAgents).filter(id => configuredAgents[id]?.enabled), ...Object.keys(activeAgents)])
  const heartbeat = Date.parse(String(status.ts ?? ''))
  const bossState = Number.isFinite(heartbeat)
    ? Date.now() - heartbeat <= 3 * 60 * 1000 ? 'running' : 'stale'
    : 'offline'
  const agents = [
    safeAgent('boss', { state: bossState, lastActivity: status.ts, ts: status.ts, task: status.task, branch: config.integration?.branch }, config.boss ?? {}, root),
    ...[...agentNames].sort().map(name => safeAgent(name, activeAgents[name] ?? {}, configuredAgents[name] ?? {}, root)),
  ]
  const copilotSessions = discoverSessions({
    base: path.join(homeDir, '.copilot', 'session-state'),
    provider: 'Copilot CLI',
    root,
  })
  const claudeProject = path.join(homeDir, '.claude', 'projects', path.resolve(root).replace(/[:\\/]/g, '-'))
  const claudeSessions = discoverSessions({
    base: claudeProject,
    provider: 'Claude Code',
    root,
    claudeProject: true,
  })
  return {
    generatedAt: new Date().toISOString(),
    phase: Number.isFinite(board.phase) ? board.phase : 0,
    health: Number.isFinite(status.health) ? status.health : null,
    merges: Number.isFinite(status.merges) ? status.merges : null,
    agents,
    sessions: [...copilotSessions, ...claudeSessions].slice(0, 150),
    tasks,
    messages: readMessages(stateDir),
    sources: {
      board: fs.existsSync(path.join(stateDir, 'board.json')),
      status: fs.existsSync(path.join(stateDir, 'status.json')),
      copilot: fs.existsSync(path.join(homeDir, '.copilot', 'session-state')),
      claude: fs.existsSync(claudeProject),
    },
  }
}

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  })
  response.end(body)
}

function isLocalHost(header = '') {
  return /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(header)
}

export function createServer(options = {}) {
  const root = path.resolve(options.root ?? DEFAULT_ROOT)
  const snapshotOptions = { ...options, root }
  return http.createServer((request, response) => {
    if (!isLocalHost(request.headers.host)) {
      send(response, 403, 'Forbidden')
      return
    }
    if (request.method !== 'GET') {
      send(response, 405, 'Method not allowed')
      return
    }
    let pathname
    try { pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname } catch {
      send(response, 400, 'Bad request')
      return
    }
    if (pathname === '/api/snapshot') {
      const origin = request.headers.origin
      if (origin) {
        try {
          const parsedOrigin = new URL(origin)
          if (!['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname)) {
            send(response, 403, 'Forbidden')
            return
          }
        } catch {
          send(response, 403, 'Forbidden')
          return
        }
      }
      try {
        send(response, 200, JSON.stringify(buildSnapshot(snapshotOptions)), 'application/json; charset=utf-8')
      } catch {
        send(response, 500, JSON.stringify({ error: 'Snapshot unavailable' }), 'application/json; charset=utf-8')
      }
      return
    }
    if (pathname === '/' || pathname === '/index.html') {
      try {
        const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')
        send(response, 200, html, 'text/html; charset=utf-8')
      } catch {
        send(response, 500, 'Monitor page unavailable')
      }
      return
    }
    if (pathname === '/app.js' || pathname === '/styles.css') {
      const file = path.join(HERE, pathname.slice(1))
      try {
        const content = fs.readFileSync(file, 'utf8')
        send(response, 200, content, pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8')
      } catch {
        send(response, 404, 'Not found')
      }
      return
    }
    send(response, 404, 'Not found')
  })
}

export function startServer({ port = Number(process.env.MONITOR_PORT || 4177), ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MONITOR_PORT must be an integer between 0 and 65535')
  const server = createServer(options)
  server.on('error', error => {
    console.error(`Dev Monitor server error: ${error.message}`)
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () => {
    const address = server.address()
    console.log(`Dev Monitor listening at http://127.0.0.1:${address.port}`)
  })
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    startServer()
  } catch (error) {
    console.error(`Dev Monitor failed to start: ${error.message}`)
    process.exitCode = 1
  }
}
