import { NextRequest, NextResponse } from 'next/server'
import { exec, execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { isAuthorizedRequest } from '@/lib/auth'

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

interface MetricStat {
  usedGB: number
  totalGB: number
  pct: number
}

interface BatteryStat {
  pct: number | null
  charging: boolean
  present: boolean
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

function parseReleases(raw: string, dateRaw: string): DashboardRelease[] {
  const tags = raw.split('\n').filter(Boolean)
  const dates = dateRaw.split('\n').filter(Boolean)
  return tags.slice(0, 8).map((tag, index) => ({
    tag,
    date: (dates[index] ?? '').substring(0, 10),
    msg: 'Release',
  }))
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

function getCPU(): number {
  try {
    const output = execSync(String.raw`top -l 1 -n 0 | grep 'CPU usage'`, { timeout: 3000 }).toString()
    const idle = output.match(/(\d+\.\d+)%\s+idle/)
    return idle ? Math.round(100 - parseFloat(idle[1])) : 0
  } catch {
    return 0
  }
}

function getRAM(): MetricStat {
  try {
    const out = execSync('vm_stat', { timeout: 3000 }).toString()
    const pageSize = 16384
    const getValue = (key: string) => {
      const match = out.match(new RegExp(`${key}:\\s+(\\d+)`))
      return match ? parseInt(match[1], 10) : 0
    }
    const totalBytes = parseInt(execSync('sysctl -n hw.memsize', { timeout: 1000 }).toString().trim(), 10)
    const freeBytes = (getValue('Pages free') + getValue('Pages speculative')) * pageSize
    const usedBytes = Math.max(totalBytes - freeBytes, 0)
    return {
      usedGB: Math.round((usedBytes / 1073741824) * 10) / 10,
      totalGB: Math.round((totalBytes / 1073741824) * 10) / 10,
      pct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    }
  } catch {
    return { usedGB: 0, totalGB: 0, pct: 0 }
  }
}

function getDisk(): MetricStat {
  try {
    const out = execSync('df -k /', { timeout: 2000 }).toString()
    const line = out.split('\n')[1] ?? ''
    const parts = line.trim().split(/\s+/)
    const total = (parseInt(parts[1], 10) || 0) / 1048576
    const used = (parseInt(parts[2], 10) || 0) / 1048576
    return {
      usedGB: Math.round(used * 10) / 10,
      totalGB: Math.round(total * 10) / 10,
      pct: total > 0 ? Math.round((used / total) * 100) : 0,
    }
  } catch {
    return { usedGB: 0, totalGB: 0, pct: 0 }
  }
}

function getBattery(): BatteryStat {
  try {
    const out = execSync('pmset -g batt', { timeout: 2000 }).toString()
    const pctMatch = out.match(/(\d+)%/)
    return {
      pct: pctMatch ? parseInt(pctMatch[1], 10) : null,
      charging: out.includes('charging') || out.includes('AC Power'),
      present: Boolean(pctMatch),
    }
  } catch {
    return { pct: null, charging: false, present: false }
  }
}

function getVersion(): string {
  try {
    return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() || '—'
  } catch {
    return '—'
  }
}

function readRecentAudit(limit = 8): DashboardAuditEntry[] {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return []
    const lines = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean)
    return lines
      .slice(-limit)
      .reverse()
      .map(line => JSON.parse(line) as DashboardAuditEntry)
      .map(entry => ({
        ts: entry.ts ?? new Date().toISOString(),
        level: entry.level ?? 'info',
        event: entry.event ?? 'unknown',
        tool: entry.tool,
        result: entry.result ? String(entry.result).slice(0, 80) : undefined,
      }))
  } catch {
    return []
  }
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

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const envLocal = readEnvLocal()
  const version = getVersion()
  const githubEnabled = Boolean(process.env.GITHUB_TOKEN)
  const ghEnv = githubEnabled ? { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN } : process.env

  const [serverHealth, bridgeHealth, ollamaHealth, activityRaw, tagsRaw, tagDatesRaw] = await Promise.all([
    checkUrl('http://localhost:3001', 1500),
    checkUrl('http://localhost:4747/health', 1500),
    fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
      .then(async res => ({
        ok: res.ok,
        status: res.status,
        models: res.ok ? ((await res.json()) as { models?: Array<{ name: string }> }).models ?? [] : [],
      }))
      .catch(() => ({ ok: false, status: undefined, models: [] as Array<{ name: string }> })),
    runCommand('git log --oneline -20 --no-merges 2>/dev/null'),
    runCommand('git tag -l --sort=-version:refname 2>/dev/null | head -8'),
    runCommand("git tag -l --sort=-version:refname 2>/dev/null | head -8 | xargs -I{} git log -1 --format=%ai {} 2>/dev/null | cut -c1-10"),
  ])

  const issuesRaw = githubEnabled
    ? await runCommand('gh issue list --assignee @me --json number,title,labels,state,updatedAt --limit 15 2>/dev/null', ghEnv)
    : ''
  const runsRaw = githubEnabled
    ? await runCommand('gh run list --limit 12 --json name,status,conclusion,updatedAt,headBranch 2>/dev/null', ghEnv)
    : ''
  const prsRaw = githubEnabled
    ? await runCommand('gh pr list --json number,title,author,reviewDecision --limit 12 2>/dev/null', ghEnv)
    : ''

  const ollamaModels = ollamaHealth.models.map(model => model.name)
  const fishAudio = Boolean(process.env.FISH_AUDIO_API_KEY || envLocal.FISH_AUDIO_API_KEY)
  const elevenlabs = Boolean(process.env.ELEVENLABS_API_KEY || envLocal.ELEVENLABS_API_KEY)
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY || envLocal.OPENROUTER_API_KEY)
  const gemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || envLocal.GOOGLE_GENERATIVE_AI_API_KEY || envLocal.GEMINI_API_KEY)

  const services: DashboardService[] = [
    {
      name: 'GhostForge Web UI',
      port: 3001,
      status: serverHealth.ok ? 'online' : 'offline',
      detail: serverHealth.ok ? 'responding' : 'not reachable',
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
    releases: parseReleases(tagsRaw, tagDatesRaw),
    activity: parseActivity(activityRaw),
    version,
    timestamp: new Date().toISOString(),
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
