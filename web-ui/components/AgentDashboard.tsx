'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentStatus = 'IDLE' | 'MONITORING' | 'PLANNING' | 'CODING' | 'TESTING' | 'COMMITTING' | 'PR' | 'ERROR' | 'PAUSED'

type IssueStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

interface AgentConfig {
  repoUrl: string
  githubToken: string
  ollamaUrl: string
  model: string
  pollInterval: number
  autoMerge: boolean
  testRequired: boolean
  labelsToMonitor: string[]
  branchPrefix: string
  maxConcurrentIssues: number
  dryRun: boolean
}

interface AgentIssue {
  number: number
  title: string
  labels: Array<{ name: string; color: string }>
  status: IssueStatus
  assignedAgent: string | null
  timeElapsed: number
  subtasksCompleted: number
  subtasksTotal: number
  priority: number
  createdAt: string
  prUrl?: string
}

interface ActiveTask {
  issueNumber: number
  issueTitle: string
  subtasks: Array<{ label: string; done: boolean }>
  gitBranch: string
  timeElapsed: number
  codeDiff: string
  testResults?: { passed: number; failed: number; details: string[] }
}

interface AgentStats {
  totalProcessed: number
  successRate: number
  avgTimePerIssue: number
  linesGenerated: number
  testsWritten: number
  prsCreated: number
  prsMerged: number
}

interface AgentHistoryEntry {
  issueNumber: number
  title: string
  prUrl?: string
  completedAt: string
  success: boolean
  timeElapsed: number
  linesChanged: number
}

interface AgentState {
  status: AgentStatus
  uptime: number
  issues: AgentIssue[]
  activeTask: ActiveTask | null
  stats: AgentStats
  history: AgentHistoryEntry[]
  config: AgentConfig
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, { color: string; bg: string; label: string; icon: string }> = {
  IDLE:       { color: '#71717a', bg: 'rgba(113,113,122,0.12)', label: 'IDLE',       icon: '⏸' },
  MONITORING: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  label: 'MONITORING', icon: '🔍' },
  PLANNING:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: 'PLANNING',   icon: '📋' },
  CODING:     { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'CODING',     icon: '💻' },
  TESTING:    { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  label: 'TESTING',    icon: '🧪' },
  COMMITTING: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'COMMITTING', icon: '📦' },
  PR:         { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'PR',         icon: '🔀' },
  ERROR:      { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'ERROR',      icon: '✗' },
  PAUSED:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: 'PAUSED',     icon: '⏸' },
}

const ISSUE_STATUS_CONFIG: Record<IssueStatus, { color: string; bg: string; label: string }> = {
  pending:     { color: '#71717a', bg: 'rgba(113,113,122,0.15)', label: 'PENDING' },
  in_progress: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', label: 'IN PROGRESS' },
  completed:   { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  label: 'COMPLETED' },
  failed:      { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  label: 'FAILED' },
}

const MOCK_ISSUES: AgentIssue[] = [
  { number: 142, title: 'Fix RTL layout in navigation sidebar', labels: [{ name: 'bug', color: '#ef4444' }, { name: 'ui', color: '#8b5cf6' }], status: 'completed', assignedAgent: 'agent-1', timeElapsed: 340, subtasksCompleted: 4, subtasksTotal: 4, priority: 1, createdAt: '2026-07-24T10:00:00Z', prUrl: 'https://github.com/ghostforge/ghostforge-agents/pull/143' },
  { number: 145, title: 'Add Dark mode toggle to settings page', labels: [{ name: 'enhancement', color: '#3b82f6' }, { name: 'ui', color: '#8b5cf6' }], status: 'in_progress', assignedAgent: 'agent-1', timeElapsed: 180, subtasksCompleted: 2, subtasksTotal: 5, priority: 2, createdAt: '2026-07-25T08:30:00Z' },
  { number: 146, title: 'Implement WebSocket real-time agent logs', labels: [{ name: 'feature', color: '#22c55e' }], status: 'pending', assignedAgent: null, timeElapsed: 0, subtasksCompleted: 0, subtasksTotal: 6, priority: 3, createdAt: '2026-07-25T09:00:00Z' },
  { number: 147, title: 'Performance regression in dashboard render', labels: [{ name: 'performance', color: '#f97316' }, { name: 'urgent', color: '#ef4444' }], status: 'pending', assignedAgent: null, timeElapsed: 0, subtasksCompleted: 0, subtasksTotal: 3, priority: 1, createdAt: '2026-07-25T09:15:00Z' },
  { number: 148, title: 'Add Arabic translation for agent dashboard', labels: [{ name: 'i18n', color: '#06b6d4' }, { name: 'ui', color: '#8b5cf6' }], status: 'in_progress', assignedAgent: 'agent-2', timeElapsed: 95, subtasksCompleted: 1, subtasksTotal: 4, priority: 2, createdAt: '2026-07-25T09:30:00Z' },
]

const MOCK_HISTORY: AgentHistoryEntry[] = [
  { issueNumber: 138, title: 'Fix clipboard paste on mobile', prUrl: 'https://github.com/ghostforge/ghostforge-agents/pull/139', completedAt: '2026-07-23T14:00:00Z', success: true, timeElapsed: 240, linesChanged: 47 },
  { issueNumber: 139, title: 'Add Gemini Live audio streaming', prUrl: 'https://github.com/ghostforge/ghostforge-agents/pull/140', completedAt: '2026-07-23T18:30:00Z', success: true, timeElapsed: 520, linesChanged: 312 },
  { issueNumber: 140, title: 'Improve wake word detection accuracy', completedAt: '2026-07-24T09:00:00Z', success: false, timeElapsed: 180, linesChanged: 0 },
  { issueNumber: 141, title: 'Migrate n8n workflows to v2', prUrl: 'https://github.com/ghostforge/ghostforge-agents/pull/142', completedAt: '2026-07-24T12:00:00Z', success: true, timeElapsed: 390, linesChanged: 156 },
  { issueNumber: 142, title: 'Fix RTL layout in navigation sidebar', prUrl: 'https://github.com/ghostforge/ghostforge-agents/pull/143', completedAt: '2026-07-24T15:45:00Z', success: true, timeElapsed: 340, linesChanged: 89 },
]

const MOCK_ACTIVE_TASK: ActiveTask = {
  issueNumber: 145,
  issueTitle: 'Add Dark mode toggle to settings page',
  subtasks: [
    { label: 'Analyze current settings structure', done: true },
    { label: 'Create ThemeContext provider', done: true },
    { label: 'Build toggle component', done: false },
    { label: 'Persist preference to localStorage', done: false },
    { label: 'Write integration tests', done: false },
  ],
  gitBranch: 'feat/145-dark-mode-toggle',
  timeElapsed: 180,
  codeDiff: `--- a/web-ui/components/Settings.tsx
+++ b/web-ui/components/Settings.tsx
@@ -12,6 +12,8 @@ export default function Settings() {
+  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
+
   return (
-    <div className="bg-white">
+    <div className={\`\${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}\`}>
       <h1>Settings</h1>
+      <ThemeToggle value={theme} onChange={setTheme} />
     </div>
   )
 }`,
  testResults: undefined,
}

const MOCK_STATS: AgentStats = {
  totalProcessed: 47,
  successRate: 91.5,
  avgTimePerIssue: 312,
  linesGenerated: 4280,
  testsWritten: 89,
  prsCreated: 43,
  prsMerged: 38,
}

const MOCK_CONFIG: AgentConfig = {
  repoUrl: 'https://github.com/ghostforge/ghostforge-agents',
  githubToken: '',
  ollamaUrl: 'http://localhost:11434',
  model: 'codellama:34b',
  pollInterval: 5,
  autoMerge: false,
  testRequired: true,
  labelsToMonitor: ['bug', 'enhancement', 'feature'],
  branchPrefix: 'auto/',
  maxConcurrentIssues: 1,
  dryRun: false,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTimeElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function labelColor(name: string): string {
  const map: Record<string, string> = {
    bug: '#ef4444', enhancement: '#3b82f6', feature: '#22c55e',
    ui: '#8b5cf6', performance: '#f97316', urgent: '#ef4444',
    i18n: '#06b6d4', documentation: '#71717a', tests: '#f59e0b',
  }
  return map[name] || '#71717a'
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentStatus }) {
  const c = STATUS_CONFIG[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider border transition-colors duration-300"
      style={{ color: c.color, background: c.bg, borderColor: `${c.color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{
        background: c.color,
        boxShadow: status === 'IDLE' ? 'none' : `0 0 6px ${c.color}`,
        animation: status !== 'IDLE' && status !== 'ERROR' && status !== 'PAUSED' ? 'agentPulse 1.5s ease-in-out infinite' : 'none',
      }} />
      {c.icon} {c.label}
    </span>
  )
}

function IssueQueuePanel({ issues }: { issues: AgentIssue[] }) {
  const [filter, setFilter] = useState<IssueStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'priority' | 'date'>('priority')

  const filtered = useMemo(() => {
    let list = filter === 'all' ? issues : issues.filter(i => i.status === filter)
    if (sortBy === 'priority') list = [...list].sort((a, b) => a.priority - b.priority)
    else list = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return list
  }, [issues, filter, sortBy])

  const counts = useMemo(() => ({
    all: issues.length,
    pending: issues.filter(i => i.status === 'pending').length,
    in_progress: issues.filter(i => i.status === 'in_progress').length,
    completed: issues.filter(i => i.status === 'completed').length,
    failed: issues.filter(i => i.status === 'failed').length,
  }), [issues])

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1.5 flex-wrap font-mono text-[9px]">
        {(['all', 'pending', 'in_progress', 'completed', 'failed'] as const).map(f => (
          <button key={f} type="button"
            onClick={() => setFilter(f)}
            className="rounded px-2 py-1 border transition"
            style={{
              borderColor: filter === f ? '#3b82f666' : 'rgba(255,255,255,0.06)',
              background: filter === f ? 'rgba(59,130,246,0.12)' : 'transparent',
              color: filter === f ? '#3b82f6' : '#71717a',
            }}>
            {f === 'all' ? 'ALL' : f === 'in_progress' ? 'ACTIVE' : f.toUpperCase()} ({counts[f]})
          </button>
        ))}
        <span className="ms-auto" />
        <button type="button"
          onClick={() => setSortBy(s => s === 'priority' ? 'date' : 'priority')}
          className="rounded px-2 py-1 border transition"
          style={{ borderColor: 'rgba(255,255,255,0.06)', color: '#71717a' }}>
          ↕ {sortBy === 'priority' ? 'PRIORITY' : 'DATE'}
        </button>
      </div>

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-[10px] font-mono" style={{ color: '#52525b' }}>
            No issues matching this filter.
          </div>
        ) : filtered.map(issue => {
          const sc = ISSUE_STATUS_CONFIG[issue.status]
          const progress = issue.subtasksTotal > 0 ? (issue.subtasksCompleted / issue.subtasksTotal) * 100 : 0
          return (
            <div key={issue.number}
              className="rounded-lg border p-3 transition hover:border-[#3b82f666]"
              style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.18)' }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold" style={{ color: '#3b82f6' }}>
                      #{issue.number}
                    </span>
                    <span className="text-[11px] text-gray-200 truncate">{issue.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {issue.labels.map(l => (
                      <span key={l.name}
                        className="rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider"
                        style={{ color: l.color || labelColor(l.name), background: `${l.color || labelColor(l.name)}18`, border: `1px solid ${l.color || labelColor(l.name)}22` }}>
                        {l.name}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="rounded px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-wider shrink-0"
                  style={{ color: sc.color, background: sc.bg, border: `1px solid ${sc.color}22` }}>
                  {sc.label}
                </span>
              </div>

              <div className="flex items-center gap-3 mt-2 text-[9px] font-mono" style={{ color: '#52525b' }}>
                {issue.assignedAgent && (
                  <span>🤖 {issue.assignedAgent}</span>
                )}
                {issue.timeElapsed > 0 && (
                  <span>⏱ {formatTimeElapsed(issue.timeElapsed)}</span>
                )}
                {issue.prUrl && (
                  <a href={issue.prUrl} target="_blank" rel="noopener noreferrer"
                    className="underline" style={{ color: '#22c55e' }}>
                    PR →
                  </a>
                )}
              </div>

              {issue.subtasksTotal > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[8px] font-mono mb-0.5"
                    style={{ color: '#52525b' }}>
                    <span>{issue.subtasksCompleted}/{issue.subtasksTotal} subtasks</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${progress}%`, background: sc.color }} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActiveTaskPanel({ task }: { task: ActiveTask | null }) {
  const [diffExpanded, setDiffExpanded] = useState(false)

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full text-[10px] font-mono" style={{ color: '#52525b' }}>
        No active task — agent is idle.
      </div>
    )
  }

  const completedSubtasks = task.subtasks.filter(s => s.done).length
  const progress = task.subtasks.length > 0 ? (completedSubtasks / task.subtasks.length) * 100 : 0

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* Task header */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(59,130,246,0.2)', background: 'rgba(0,0,0,0.18)' }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold" style={{ color: '#3b82f6' }}>#{task.issueNumber}</span>
            <span className="text-[11px] text-gray-200 truncate">{task.issueTitle}</span>
          </div>
          <span className="font-mono text-[9px]" style={{ color: '#f97316' }}>
            ⏱ {formatTimeElapsed(task.timeElapsed)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[9px] font-mono" style={{ color: '#52525b' }}>
          <span>🔀 {task.gitBranch}</span>
        </div>
      </div>

      {/* Subtasks */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[9px] tracking-widest" style={{ color: '#52525b' }}>SUBTASKS</span>
          <span className="font-mono text-[9px]" style={{ color: completedSubtasks === task.subtasks.length ? '#22c55e' : '#71717a' }}>
            {completedSubtasks}/{task.subtasks.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {task.subtasks.map((sub, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[8px]"
                style={{
                  borderColor: sub.done ? '#22c55e' : 'rgba(255,255,255,0.15)',
                  background: sub.done ? 'rgba(34,197,94,0.15)' : 'transparent',
                  color: sub.done ? '#22c55e' : 'transparent',
                }}>
                {sub.done ? '✓' : ''}
              </span>
              <span style={{ color: sub.done ? '#71717a' : '#a1a1aa', textDecoration: sub.done ? 'line-through' : 'none' }}>
                {sub.label}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${progress}%`, background: '#3b82f6' }} />
        </div>
      </div>

      {/* Test results */}
      {task.testResults && (
        <div className="rounded-lg border p-3"
          style={{
            borderColor: task.testResults.failed > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
            background: task.testResults.failed > 0 ? 'rgba(239,68,68,0.04)' : 'rgba(34,197,94,0.04)',
          }}>
          <div className="flex items-center gap-3 mb-1.5">
            <span className="font-mono text-[9px] tracking-widest" style={{ color: '#52525b' }}>TEST RESULTS</span>
            <span className="font-mono text-[10px]" style={{ color: '#22c55e' }}>✓ {task.testResults.passed} passed</span>
            {task.testResults.failed > 0 && (
              <span className="font-mono text-[10px]" style={{ color: '#ef4444' }}>✗ {task.testResults.failed} failed</span>
            )}
          </div>
          {task.testResults.details.length > 0 && (
            <div className="space-y-0.5">
              {task.testResults.details.map((d, i) => (
                <div key={i} className="text-[9px] font-mono" style={{ color: d.startsWith('✓') ? '#22c55e' : '#ef4444' }}>
                  {d}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Code diff */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.18)' }}>
        <button type="button"
          onClick={() => setDiffExpanded(e => !e)}
          className="w-full flex items-center justify-between px-3 py-2 text-start transition hover:bg-[rgba(255,255,255,0.02)]">
          <span className="font-mono text-[9px] tracking-widest" style={{ color: '#52525b' }}>CODE DIFF</span>
          <span className="font-mono text-[9px]" style={{ color: '#71717a' }}>{diffExpanded ? '▲ COLLAPSE' : '▼ EXPAND'}</span>
        </button>
        {diffExpanded && (
          <pre className="px-3 py-2 text-[9px] font-mono overflow-x-auto leading-relaxed border-t"
            style={{ borderColor: 'rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.2)' }}>
            <code>
              {task.codeDiff.split('\n').map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith('+') ? '#22c55e' : line.startsWith('-') ? '#ef4444' : '#71717a',
                }}>
                  {line}
                </div>
              ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  )
}

function HistoryPanel({ history }: { history: AgentHistoryEntry[] }) {
  const stats = useMemo(() => {
    const total = history.length
    const succeeded = history.filter(h => h.success).length
    const avgTime = total > 0 ? history.reduce((acc, h) => acc + h.timeElapsed, 0) / total : 0
    const totalLines = history.reduce((acc, h) => acc + h.linesChanged, 0)
    return { total, succeeded, failed: total - succeeded, rate: total > 0 ? (succeeded / total) * 100 : 0, avgTime, totalLines }
  }, [history])

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* History stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'SUCCESS RATE', value: `${stats.rate.toFixed(1)}%`, color: stats.rate >= 80 ? '#22c55e' : stats.rate >= 50 ? '#f59e0b' : '#ef4444' },
          { label: 'COMPLETED', value: `${stats.succeeded}`, color: '#22c55e' },
          { label: 'FAILED', value: `${stats.failed}`, color: '#ef4444' },
          { label: 'AVG TIME', value: formatTimeElapsed(Math.round(stats.avgTime)), color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} className="rounded border p-2 text-center" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)' }}>
            <div className="text-[8px] font-mono tracking-widest mb-1" style={{ color: '#52525b' }}>{s.label}</div>
            <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* History list */}
      <div className="flex-1 space-y-2">
        {history.map(h => (
          <div key={h.issueNumber}
            className="rounded-lg border p-3 transition"
            style={{ borderColor: h.success ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', background: 'rgba(0,0,0,0.12)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold" style={{ color: h.success ? '#22c55e' : '#ef4444' }}>
                    #{h.issueNumber}
                  </span>
                  <span className="text-[11px] text-gray-200 truncate">{h.title}</span>
                </div>
              </div>
              <span className="text-[9px] font-mono shrink-0" style={{ color: '#52525b' }}>
                {new Date(h.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[9px] font-mono" style={{ color: '#52525b' }}>
              <span>⏱ {formatTimeElapsed(h.timeElapsed)}</span>
              <span>📄 {h.linesChanged} lines</span>
              {h.prUrl && (
                <a href={h.prUrl} target="_blank" rel="noopener noreferrer"
                  className="underline" style={{ color: '#3b82f6' }}>
                  PR →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsPanel({ config: initialConfig }: { config: AgentConfig }) {
  const [config, setConfig] = useState(initialConfig)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const update = useCallback(<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }, [])

  const saveConfig = useCallback(() => {
    setSaving(true)
    setTimeout(() => { setSaving(false); setSaved(true) }, 400)
  }, [])

  const inputCls = "w-full rounded px-2.5 py-1.5 text-[10px] font-mono bg-black/40 border outline-none transition focus:border-[#3b82f6]"
  const inputStyle = { borderColor: 'rgba(255,255,255,0.1)', color: '#e4e4e7' }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {/* Repository */}
      <Section title="REPOSITORY">
        <Field label="Repository URL">
          <input type="text" value={config.repoUrl} onChange={e => update('repoUrl', e.target.value)}
            className={inputCls} style={inputStyle} placeholder="https://github.com/org/repo" />
        </Field>
        <Field label="GitHub Token">
          <input type="password" value={config.githubToken} onChange={e => update('githubToken', e.target.value)}
            className={inputCls} style={inputStyle} placeholder="ghp_xxxxxxxxxxxx" />
        </Field>
      </Section>

      {/* AI */}
      <Section title="AI MODEL">
        <Field label="Ollama URL">
          <input type="text" value={config.ollamaUrl} onChange={e => update('ollamaUrl', e.target.value)}
            className={inputCls} style={inputStyle} placeholder="http://localhost:11434" />
        </Field>
        <Field label="Model">
          <select value={config.model} onChange={e => update('model', e.target.value)}
            className={inputCls} style={inputStyle}>
            <option value="codellama:34b">CodeLlama 34B</option>
            <option value="deepseek-coder:33b">DeepSeek Coder 33B</option>
            <option value="qwen2.5-coder:32b">Qwen 2.5 Coder 32B</option>
            <option value="starcoder2:15b">StarCoder2 15B</option>
            <option value="codellama:7b">CodeLlama 7B (Fast)</option>
          </select>
        </Field>
      </Section>

      {/* Polling */}
      <Section title="POLLING">
        <Field label={`Poll Interval: ${config.pollInterval} min`}>
          <input type="range" min={1} max={60} value={config.pollInterval}
            onChange={e => update('pollInterval', parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#3b82f6]"
            style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="flex justify-between text-[8px] font-mono mt-0.5" style={{ color: '#52525b' }}>
            <span>1 min</span><span>60 min</span>
          </div>
        </Field>
      </Section>

      {/* Behavior */}
      <Section title="BEHAVIOR">
        <ToggleField label="Auto-merge PRs" checked={config.autoMerge} onChange={v => update('autoMerge', v)} />
        <ToggleField label="Require tests to pass" checked={config.testRequired} onChange={v => update('testRequired', v)} />
        <ToggleField label="Dry-run mode" checked={config.dryRun} onChange={v => update('dryRun', v)} />
        <Field label="Branch prefix">
          <input type="text" value={config.branchPrefix} onChange={e => update('branchPrefix', e.target.value)}
            className={inputCls} style={inputStyle} placeholder="auto/" />
        </Field>
        <Field label={`Max concurrent issues: ${config.maxConcurrentIssues}`}>
          <input type="range" min={1} max={5} value={config.maxConcurrentIssues}
            onChange={e => update('maxConcurrentIssues', parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#3b82f6]"
            style={{ background: 'rgba(255,255,255,0.06)' }} />
        </Field>
      </Section>

      {/* Labels */}
      <Section title="LABELS TO MONITOR">
        <div className="flex flex-wrap gap-1.5">
          {config.labelsToMonitor.map(l => (
            <span key={l}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] font-mono font-bold cursor-pointer transition hover:opacity-70"
              style={{ color: labelColor(l), background: `${labelColor(l)}18`, border: `1px solid ${labelColor(l)}22` }}
              onClick={() => update('labelsToMonitor', config.labelsToMonitor.filter(x => x !== l))}>
              {l} ✕
            </span>
          ))}
          {['bug', 'enhancement', 'feature', 'ui', 'performance', 'i18n', 'documentation', 'tests']
            .filter(l => !config.labelsToMonitor.includes(l))
            .slice(0, 3)
            .map(l => (
              <span key={l}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] font-mono cursor-pointer transition border border-dashed hover:opacity-70"
                style={{ color: '#52525b', borderColor: 'rgba(255,255,255,0.1)' }}
                onClick={() => update('labelsToMonitor', [...config.labelsToMonitor, l])}>
                + {l}
              </span>
            ))}
        </div>
      </Section>

      {/* Save */}
      <button type="button" onClick={saveConfig} disabled={saving}
        className="rounded-lg border px-4 py-2.5 font-mono text-[11px] font-bold tracking-wider transition active:scale-95 disabled:opacity-50"
        style={{ borderColor: saved ? '#22c55e' : '#3b82f6', color: saved ? '#22c55e' : '#3b82f6', background: saved ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)' }}>
        {saving ? 'SAVING…' : saved ? '✓ SAVED' : 'SAVE CONFIG'}
      </button>
    </div>
  )
}

function StatsPanel({ stats }: { stats: AgentStats }) {
  const cards = [
    { label: 'TOTAL ISSUES', value: stats.totalProcessed.toString(), color: '#3b82f6', icon: '📊' },
    { label: 'SUCCESS RATE', value: `${stats.successRate.toFixed(1)}%`, color: stats.successRate >= 80 ? '#22c55e' : '#f59e0b', icon: '✓' },
    { label: 'AVG TIME', value: formatTimeElapsed(stats.avgTimePerIssue), color: '#f97316', icon: '⏱' },
    { label: 'LINES GENERATED', value: stats.linesGenerated.toLocaleString(), color: '#8b5cf6', icon: '📄' },
    { label: 'TESTS WRITTEN', value: stats.testsWritten.toString(), color: '#06b6d4', icon: '🧪' },
    { label: 'PRs CREATED', value: stats.prsCreated.toString(), color: '#22c55e', icon: '🔀' },
    { label: 'PRs MERGED', value: stats.prsMerged.toString(), color: '#22c55e', icon: '📦' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {cards.map(c => (
        <div key={c.label} className="rounded-lg border p-3" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px]">{c.icon}</span>
            <span className="text-[8px] font-mono tracking-widest" style={{ color: '#52525b' }}>{c.label}</span>
          </div>
          <div className="text-xl font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)' }}>
      <div className="text-[8px] font-mono tracking-widest mb-2" style={{ color: '#52525b' }}>{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9px] font-mono mb-1" style={{ color: '#71717a' }}>{label}</label>
      {children}
    </div>
  )
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] font-mono" style={{ color: '#a1a1aa' }}>{label}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className="relative w-9 h-5 rounded-full transition-colors"
        style={{ background: checked ? '#3b82f6' : 'rgba(255,255,255,0.12)' }}>
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = 'issues' | 'active' | 'history' | 'settings' | 'stats'

export interface AgentDashboardProps {
  /** External agent state — if provided, uses real data instead of mock */
  agentState?: AgentState | null
  /** Callback when start is clicked */
  onStart?: () => void
  /** Callback when stop is clicked */
  onStop?: () => void
  /** Callback when pause is clicked */
  onPause?: () => void
  /** Whether the component is embedded (smaller) vs full-page */
  embedded?: boolean
}

export default function AgentDashboard({ agentState, onStart, onStop, onPause, embedded }: AgentDashboardProps) {
  const [tab, setTab] = useState<Tab>('issues')
  const [uptime, setUptime] = useState(0)
  const [processIssueInput, setProcessIssueInput] = useState('')
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const state = agentState || null
  const status: AgentStatus = state?.status || 'IDLE'
  const issues = state?.issues || MOCK_ISSUES
  const activeTask = state?.activeTask || null
  const history = state?.history || MOCK_HISTORY
  const stats = state?.stats || MOCK_STATS
  const config = state?.config || MOCK_CONFIG

  const totalIssues = issues.length
  const completedIssues = issues.filter(i => i.status === 'completed').length
  const progressPct = totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0

  useEffect(() => {
    uptimeRef.current = setInterval(() => setUptime(u => u + 1), 1000)
    return () => { if (uptimeRef.current) clearInterval(uptimeRef.current) }
  }, [])

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'issues',   label: 'ISSUES',    icon: '📋' },
    { id: 'active',   label: 'ACTIVE',    icon: '⚡' },
    { id: 'history',  label: 'HISTORY',   icon: '📜' },
    { id: 'stats',    label: 'STATS',     icon: '📊' },
    { id: 'settings', label: 'SETTINGS',  icon: '⚙' },
  ]

  return (
    <>
      <style>{`@keyframes agentPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      <div className="flex flex-col h-full font-mono text-[10px] rounded-xl overflow-hidden"
        style={{ background: 'rgba(0,5,20,0.96)', border: '1px solid rgba(255,255,255,0.06)' }}>

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b flex-wrap"
        style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
        <StatusBadge status={status} />

        <div className="flex items-center gap-1.5">
          {status === 'IDLE' || status === 'PAUSED' || status === 'ERROR' ? (
            <button type="button" onClick={onStart}
              className="rounded px-2.5 py-1 border text-[9px] font-bold tracking-wider transition active:scale-95"
              style={{ borderColor: '#22c55e66', color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}>
              ▶ START
            </button>
          ) : (
            <>
              <button type="button" onClick={onPause}
                className="rounded px-2.5 py-1 border text-[9px] font-bold tracking-wider transition active:scale-95"
                style={{ borderColor: '#f59e0b66', color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}>
                ⏸ PAUSE
              </button>
              <button type="button" onClick={onStop}
                className="rounded px-2.5 py-1 border text-[9px] font-bold tracking-wider transition active:scale-95"
                style={{ borderColor: '#ef444466', color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}>
                ■ STOP
              </button>
            </>
          )}
        </div>

        <div className="ms-auto flex items-center gap-4">
          <div className="text-end">
            <div className="text-[8px] tracking-widest" style={{ color: '#52525b' }}>UPTIME</div>
            <div className="text-[11px] font-bold" style={{ color: '#a1a1aa' }}>{formatUptime(state?.uptime ?? uptime)}</div>
          </div>
          <div className="text-end min-w-[80px]">
            <div className="text-[8px] tracking-widest mb-0.5" style={{ color: '#52525b' }}>PROGRESS</div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${progressPct}%`, background: '#3b82f6' }} />
            </div>
            <div className="text-[8px] mt-0.5" style={{ color: '#71717a' }}>{completedIssues}/{totalIssues}</div>
          </div>
        </div>
      </div>

      {/* ── Quick action: process issue ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.1)' }}>
        <span className="text-[9px]" style={{ color: '#52525b' }}>PROCESS ISSUE #</span>
        <input type="number" value={processIssueInput}
          onChange={e => setProcessIssueInput(e.target.value)}
          className="w-16 rounded px-2 py-1 text-[10px] font-mono bg-black/40 border outline-none"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#e4e4e7' }}
          placeholder="0" min={0} />
        <button type="button"
          disabled={!processIssueInput || status === 'IDLE'}
          className="rounded px-2.5 py-1 border text-[9px] font-bold tracking-wider transition active:scale-95 disabled:opacity-30"
          style={{ borderColor: '#3b82f666', color: '#3b82f6', background: 'rgba(59,130,246,0.1)' }}>
          ⚡ GO
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className="shrink-0 flex items-center border-b overflow-x-auto"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {tabs.map(t => (
          <button key={t.id} type="button"
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[9px] font-bold tracking-wider border-b-2 transition whitespace-nowrap"
            style={{
              borderColor: tab === t.id ? '#3b82f6' : 'transparent',
              color: tab === t.id ? '#3b82f6' : '#52525b',
              background: tab === t.id ? 'rgba(59,130,246,0.06)' : 'transparent',
            }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-hidden p-4">
        {tab === 'issues' && <IssueQueuePanel issues={issues} />}
        {tab === 'active' && <ActiveTaskPanel task={activeTask} />}
        {tab === 'history' && <HistoryPanel history={history} />}
        {tab === 'settings' && <SettingsPanel config={config} />}
        {tab === 'stats' && <StatsPanel stats={stats} />}
      </div>
    </div>
    </>
  )
}
