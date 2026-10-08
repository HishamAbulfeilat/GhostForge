import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { exec } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { isAuthorizedRequest } from '@/lib/auth'
import { getCPU, getRAM, getDisk, getBattery, type MetricStat, type BatteryStat } from '@/lib/system-info'
import { createSwrCache } from '@/lib/swr-cache'

export const dynamic = 'force-dynamic'

const execAsync = promisify(exec)
const ROOT = path.join(os.homedir(), 'GhostForge')
const WEB_UI_DIR = path.join(ROOT, 'web-ui')
const AUDIT_FILE = path.join(os.homedir(), '.ghostforge', 'audit.log')

interface DashboardIssue {
  number: string
  title: string
  labels: string
  state: string
  updated: string
}

interface DashboardRun {
  icon: string
  name: string
  branch: string
  conclusion: string
  updated: string
}

interface DashboardPR {
  number: string
  title: string
  author: string
  review: string
}

interface DashboardRelease {
  tag: string
  date: string
  msg: string
}

interface DashboardSystem {
  cpu: number
  ram: MetricStat
  disk: MetricStat
  battery: BatteryStat
}

interface DashboardService {
  name: string
  port: number
  status: 'online' | 'warn' | 'offline'
  detail: string
}

interface DashboardTtsEngine {
  name: string
  available: boolean
  detail: string
}

interface DashboardAI {
  ollamaRunning: boolean
  ollamaModels: string[]
  modelCount: number
  activeTts: string
  tts: DashboardTtsEngine[]
  keys: {
    fishAudio: boolean
    elevenlabs: boolean
    openrouter: boolean
    gemini: boolean
  }
}

interface DashboardAuditEntry {
  ts: string
  level: string
  event: string
  tool?: string
  result?: string
}

interface DashboardData {
  bridgeConnected: boolean
  githubEnabled: boolean
  issues: DashboardIssue[]
  runs: DashboardRun[]
  prs: DashboardPR[]
  releases: DashboardRelease[]
  activity: string[]
  version: string
  timestamp: string
  panelsFetchedAt: string
  panelsCached: boolean
  system: DashboardSystem
  services: DashboardService[]
  ai: DashboardAI
  audit: DashboardAuditEntry[]
  warnings: string[]
  error?: string
}

async function runCommand(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  try {
    const { stdout } = await execAsync(command, {
      cwd: ROOT,
      env,
      timeout: 12_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

function parseIssues(raw: string): DashboardIssue[] {
  if (!raw) return []
  try {
    const issues = JSON.parse(raw) as Array<{
      number: number
      title: string
      labels: Array<{ name: string }>
      state: string
      updatedAt: string
    }>
    return issues.map(issue => ({
      number: `#${issue.number}`,
      title: (issue.title ?? '').substring(0, 42),
      labels: (issue.labels ?? []).map(label => label.name).join(', ').substring(0, 20) || '—',
      state: issue.state ?? 'open',
      updated: (issue.updatedAt ?? '').substring(0, 10),
    }))
  } catch {
    return []
  }
}

function parseRuns(raw: string): DashboardRun[] {
  if (!raw) return []
  try {
    const runs = JSON.parse(raw) as Array<{
      name: string
      status: string
      conclusion: string
      updatedAt: string
      headBranch: string
    }>
    return runs.map(run => {
      const icon =
        run.conclusion === 'success'
          ? '✅'
          : run.conclusion === 'failure'
            ? '❌'
            : run.status === 'in_progress'
              ? '🔄'
              : '⚪'
      return {
        icon,
        name: (run.name ?? '').substring(0, 28),
        branch: (run.headBranch ?? '').substring(0, 18),
        conclusion: run.conclusion || run.status || '—',
        updated: (run.updatedAt ?? '').substring(0, 10),
      }
    })
  } catch {
    return []
  }
}

function parsePRs(raw: string): DashboardPR[] {
  if (!raw) return []
  try {
    const prs = JSON.parse(raw) as Array<{
      number: number
      title: string
      author: { login: string }
      reviewDecision: string
    }>
    return prs.map(pr => ({
      number: `#${pr.number}`,
      title: (pr.title ?? '').substring(0, 34),
      author: (pr.author?.login ?? '?').substring(0, 14),
      review:
        pr.reviewDecision === 'APPROVED'
          ? 'approved'
          : pr.reviewDecision === 'CHANGES_REQUESTED'
            ? 'changes'
            : 'pending',
    }))
  } catch {
    return []
  }
}

/** `git for-each-ref` lines: "<tag> <YYYY-MM-DD>". */
function parseReleases(raw: string): DashboardRelease[] {
  return raw.split('\n').filter(Boolean).slice(0, 8).map(line => {
    const [tag, date = ''] = line.trim().split(/\s+/)
    return { tag, date: date.substring(0, 10), msg: 'Release' }
  })
}

function parseActivity(raw: string): string[] {
  if (!raw) return ['No recent commits']
  return raw
    .split('\n')
    .filter(Boolean)
    .slice(0, 20)
    .map(line => line.substring(0, 72))
}

async function checkUrl(url: string, timeoutMs = 1500): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false }
  }
}

function getVersion(): string {
  try {
    return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() || '—'
  } catch {
    return '—'
  }
}

// The audit log is append-only and never rotated, so only read its tail.
const AUDIT_TAIL_BYTES = 64 * 1024

function readRecentAudit(limit = 8): DashboardAuditEntry[] {
  let text = ''
  let fd: number | undefined
  try {
    fd = fs.openSync(AUDIT_FILE, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - AUDIT_TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    text = buf.toString('utf8')
    // Drop the (probably partial) first line when we started mid-file
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
  } catch {
    return []
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }

  const entries: DashboardAuditEntry[] = []
  const lines = text.split('\n')
  // Newest first; skip lines that aren't valid JSON instead of dropping all of them
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    if (!lines[i]) continue
    let entry: Partial<DashboardAuditEntry> | null
    try { entry = JSON.parse(lines[i]) } catch { continue }
    if (!entry || typeof entry !== 'object') continue
    entries.push({
      ts: entry.ts ?? new Date().toISOString(),
      level: entry.level ?? 'info',
      event: entry.event ?? 'unknown',
      tool: entry.tool,
      result: entry.result ? String(entry.result).slice(0, 80) : undefined,
    })
  }
  return entries
}

function readEnvLocal(): Record<string, string> {
  try {
    const envPath = path.join(WEB_UI_DIR, '.env.local')
    const content = fs.readFileSync(envPath, 'utf8')
    return content.split('\n').reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return acc
      const index = trimmed.indexOf('=')
      if (index <= 0) return acc
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
      acc[key] = value
      return acc
    }, {})
  } catch {
    return {}
  }
}

// ── GitHub + git panels: stale-while-revalidate cache ──────────────────────
// Every dashboard load (and its 60 s auto-refresh) used to spawn ~9 git/gh
// processes and make 3 GitHub API calls. Serve the cached copy straight away
// and refresh it in the background once it is older than PANELS_TTL_MS;
// ?refresh=1 (the dashboard's refresh button) waits for a fresh copy.
const PANELS_TTL_MS = 60_000

interface PanelsRaw {
  activityRaw: string
  tagsRaw: string
  issuesRaw: string
  runsRaw: string
  prsRaw: string
}

const panelsCache = createSwrCache<PanelsRaw>(PANELS_TTL_MS)

async function fetchPanels(githubEnabled: boolean, ghEnv: NodeJS.ProcessEnv): Promise<PanelsRaw> {
  const [activityRaw, tagsRaw, issuesRaw, runsRaw, prsRaw] = await Promise.all([
    runCommand('git log --oneline -20 --no-merges 2>/dev/null'),
    // One process for tags + dates (was: one `git log` per tag through xargs)
    runCommand("git for-each-ref --sort=-version:refname --count=8 --format='%(refname:short) %(creatordate:short)' refs/tags 2>/dev/null"),
    githubEnabled
      ? runCommand('gh issue list --assignee @me --json number,title,labels,state,updatedAt --limit 15 2>/dev/null', ghEnv)
      : Promise.resolve(''),
    githubEnabled
      ? runCommand('gh run list --limit 12 --json name,status,conclusion,updatedAt,headBranch,databaseId 2>/dev/null', ghEnv)
      : Promise.resolve(''),
    githubEnabled
      ? runCommand('gh pr list --json number,title,author,reviewDecision --limit 12 2>/dev/null', ghEnv)
      : Promise.resolve(''),
  ])
  return { activityRaw, tagsRaw, issuesRaw, runsRaw, prsRaw }
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?scope=system: just the host metrics. JARVIS polls this every 5 s for its
  // HUD; the full payload spawns git and gh processes on every call.
  const scope = req.nextUrl?.searchParams.get('scope')
  if (scope === 'system') {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      system: { cpu: getCPU(), ram: getRAM(), disk: getDisk(), battery: getBattery() },
    })
  }

  const envLocal = readEnvLocal()
  const version = getVersion()
  const githubEnabled = Boolean(process.env.GITHUB_TOKEN)
  const ghEnv = githubEnabled ? { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN } : process.env

  const refresh = req.nextUrl?.searchParams.get('refresh') === '1'

  // Everything below is independent I/O, so run it all at once. The git/gh
  // panels come from the stale-while-revalidate cache above.
  const [bridgeHealth, ollamaHealth, panels] = await Promise.all([
    checkUrl('http://localhost:4747/health', 1500),
    fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
      .then(async res => ({
        ok: res.ok,
        status: res.status,
        models: res.ok ? ((await res.json()) as { models?: Array<{ name: string }> }).models ?? [] : [],
      }))
      .catch(() => ({ ok: false, status: undefined, models: [] as Array<{ name: string }> })),
    panelsCache.get(githubEnabled ? 'gh' : 'local', () => fetchPanels(githubEnabled, ghEnv), refresh),
  ])
  const { activityRaw, tagsRaw, issuesRaw, runsRaw, prsRaw } = panels.value

  const ollamaModels = ollamaHealth.models.map(model => model.name)
  const fishAudio = Boolean(process.env.FISH_AUDIO_API_KEY || envLocal.FISH_AUDIO_API_KEY)
  const elevenlabs = Boolean(process.env.ELEVENLABS_API_KEY || envLocal.ELEVENLABS_API_KEY)
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY || envLocal.OPENROUTER_API_KEY)
  const gemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || envLocal.GOOGLE_GENERATIVE_AI_API_KEY || envLocal.GEMINI_API_KEY)

  const services: DashboardService[] = [
    {
      // This handler is running, so the web UI is up by definition. It used to
      // fetch http://localhost:3001 here: that rendered the home page on every
      // dashboard load and always failed when the server runs HTTPS on 3001.
      name: 'GhostForge Web UI',
      port: Number(process.env.PORT) || 3001,
      status: 'online',
      detail: 'responding',
    },
    {
      name: 'Ollama',
      port: 11434,
      status: ollamaHealth.ok ? 'online' : 'warn',
      detail: ollamaHealth.ok
        ? `${ollamaModels.length} model${ollamaModels.length === 1 ? '' : 's'} available`
        : 'not reachable',
    },
    {
      name: 'Bridge',
      port: 4747,
      status: bridgeHealth.ok ? 'online' : 'warn',
      detail: bridgeHealth.ok ? 'responding' : 'optional service offline',
    },
  ]

  const warnings = [
    !githubEnabled ? 'GitHub panels disabled because GITHUB_TOKEN is not set.' : '',
    !bridgeHealth.ok ? 'Bridge is offline; remote bridge features are degraded.' : '',
    !ollamaHealth.ok ? 'Ollama is offline; local model features may be limited.' : '',
  ].filter(Boolean)

  const data: DashboardData = {
    bridgeConnected: bridgeHealth.ok,
    githubEnabled,
    issues: parseIssues(issuesRaw),
    runs: parseRuns(runsRaw),
    prs: parsePRs(prsRaw),
    releases: parseReleases(tagsRaw),
    activity: parseActivity(activityRaw),
    version,
    timestamp: new Date().toISOString(),
    panelsFetchedAt: new Date(panels.fetchedAt).toISOString(),
    panelsCached: panels.cached,
    system: {
      cpu: getCPU(),
      ram: getRAM(),
      disk: getDisk(),
      battery: getBattery(),
    },
    services,
    ai: {
      ollamaRunning: ollamaHealth.ok,
      ollamaModels,
      modelCount: ollamaModels.length,
      activeTts: fishAudio ? 'fish-audio' : elevenlabs ? 'elevenlabs' : 'browser',
      tts: [
        { name: 'fish-audio', available: fishAudio, detail: fishAudio ? 'API key configured' : 'key missing' },
        { name: 'elevenlabs', available: elevenlabs, detail: elevenlabs ? 'API key configured' : 'key missing' },
        { name: 'browser', available: true, detail: 'always available in the client' },
      ],
      keys: {
        fishAudio,
        elevenlabs,
        openrouter,
        gemini,
      },
    },
    audit: readRecentAudit(),
    warnings,
  }

  return NextResponse.json(data)
}
