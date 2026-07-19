import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { executeBridgeCommand } from '@/lib/ws-client'

export const dynamic = 'force-dynamic'

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

interface DashboardData {
  bridgeConnected: boolean
  issues: DashboardIssue[]
  runs: DashboardRun[]
  prs: DashboardPR[]
  releases: DashboardRelease[]
  activity: string[]
  version: string
  timestamp: string
  error?: string
}

async function runGhCommand(bridgeUrl: string, bridgeToken: string, cmd: string): Promise<string> {
  try {
    const res = await executeBridgeCommand(bridgeUrl, bridgeToken, cmd)
    return (res.output ?? '').trim()
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
      labels: (issue.labels ?? []).map(l => l.name).join(', ').substring(0, 20) || '—',
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
  return tags.slice(0, 8).map((tag, i) => ({
    tag,
    date: (dates[i] ?? '').substring(0, 10),
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

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bridgeUrl = process.env.WS_BRIDGE_URL
  const bridgeToken = process.env.WS_BRIDGE_TOKEN

  const empty: DashboardData = {
    bridgeConnected: false,
    issues: [],
    runs: [],
    prs: [],
    releases: [],
    activity: [],
    version: '—',
    timestamp: new Date().toISOString(),
  }

  if (!bridgeUrl || !bridgeToken) {
    return NextResponse.json({ ...empty, error: 'Bridge not configured' })
  }

  // Verify bridge is reachable
  try {
    const healthRes = await fetch(`${bridgeUrl}/health`, {
      headers: { Authorization: `Bearer ${bridgeToken}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!healthRes.ok) {
      return NextResponse.json({ ...empty, error: 'Bridge offline' })
    }
  } catch {
    return NextResponse.json({ ...empty, error: 'Bridge unreachable' })
  }

  // Run all gh commands in parallel
  const [issuesRaw, runsRaw, prsRaw, tagsRaw, tagDatesRaw, activityRaw, versionRaw] =
    await Promise.all([
      runGhCommand(
        bridgeUrl,
        bridgeToken,
        'gh issue list --assignee @me --json number,title,labels,state,updatedAt --limit 15 2>/dev/null'
      ),
      runGhCommand(
        bridgeUrl,
        bridgeToken,
        'gh run list --limit 12 --json name,status,conclusion,updatedAt,headBranch 2>/dev/null'
      ),
      runGhCommand(
        bridgeUrl,
        bridgeToken,
        'gh pr list --json number,title,author,reviewDecision --limit 12 2>/dev/null'
      ),
      runGhCommand(
        bridgeUrl,
        bridgeToken,
        'git tag -l --sort=-version:refname 2>/dev/null | head -8'
      ),
      runGhCommand(
        bridgeUrl,
        bridgeToken,
        "git tag -l --sort=-version:refname 2>/dev/null | head -8 | xargs -I{} git log -1 --format=%ai {} 2>/dev/null | cut -c1-10"
      ),
      runGhCommand(
        bridgeUrl,
        bridgeToken,
        'git log --oneline -20 --no-merges 2>/dev/null'
      ),
      runGhCommand(bridgeUrl, bridgeToken, 'cat ~/ghostforge/VERSION 2>/dev/null || echo "?"'),
    ])

  const data: DashboardData = {
    bridgeConnected: true,
    issues: parseIssues(issuesRaw),
    runs: parseRuns(runsRaw),
    prs: parsePRs(prsRaw),
    releases: parseReleases(tagsRaw, tagDatesRaw),
    activity: parseActivity(activityRaw),
    version: versionRaw || '?',
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(data)
}
