import type { Provider, Session } from './types'

export const isClaude = (p: Provider) => p === 'claude-code'
export const providerLabel = (p: Provider) => (isClaude(p) ? 'Claude' : 'Copilot')

export function ago(iso?: string, now = Date.now()): string {
  const t = Date.parse(iso ?? '')
  if (!t) return '—'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function duration(ms?: number): string {
  if (!ms || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

export function compact(n?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) < 1000) return String(Math.round(n))
  const units = ['K', 'M', 'B', 'T']
  let v = n, i = -1
  while (Math.abs(v) >= 1000 && i < units.length - 1) { v /= 1000; i++ }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}${units[i]}`
}

export const usd = (n?: number) => (n === undefined ? '—' : n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)

/** "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5", others unchanged. */
export function modelShort(model?: string): string {
  if (!model) return 'model not reported'
  const m = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`
  return model
}

export function project(s: Pick<Session, 'cwd' | 'projectSlug'>): { name: string; path: string } {
  const p = s.cwd || (s.projectSlug ? s.projectSlug.replace(/^([A-Z])--/, '$1:/').replace(/-/g, '/') : '')
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return { name: parts.at(-1) || 'unknown', path: p || '—' }
}

/** What the session is doing right now, in a few words. */
export function activity(s: Session): string {
  if (s.health === 'rate-limited') return 'rate limited'
  if (s.health === 'stalled') return `stalled on ${s.lastTool?.name ?? 'a tool call'}`
  if (s.health === 'erroring') return 'hitting API errors'
  if (s.status === 'working') {
    const t = s.lastTool?.name
    if (!t) return s.provider === 'copilot-cli' ? 'responding' : 'thinking'
    return TOOL_VERBS[t] ?? `using ${t}`
  }
  if (s.status === 'active') return waitsOnYou(s) ? 'waiting for you' : 'finished its turn'
  return `idle · last ${ago(s.updatedAt)}`
}

/**
 * Only interactive sessions wait on a person: Claude Code run as the `cli`
 * entrypoint (not sdk-cli / headless agents) and Copilot sessions still open.
 */
export function waitsOnYou(s: Session): boolean {
  return s.provider === 'claude-code' ? s.entrypoint === 'cli' : !!s.open
}

const TOOL_VERBS: Record<string, string> = {
  Bash: 'running a command', PowerShell: 'running a command', Read: 'reading files', Edit: 'editing files',
  Write: 'writing a file', Grep: 'searching code', Glob: 'finding files', Agent: 'running a subagent',
  Task: 'running a subagent', WebFetch: 'reading the web', WebSearch: 'searching the web',
  AskUserQuestion: 'asking you a question', TodoWrite: 'planning', apply_patch: 'editing files',
  view: 'reading files', edit: 'editing files', create: 'creating a file',
}

export const healthLabel: Record<Session['health'], string> = {
  ok: 'healthy', stalled: 'stalled', 'rate-limited': 'rate limited', erroring: 'API errors',
}
