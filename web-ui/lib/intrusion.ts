/**
 * GhostForge intrusion response.
 *
 * When an unauthorized access attempt is detected (forged session, disabled
 * account, brute-forced login, a non-owner touching user management, or a
 * restricted user reaching for a privileged tool) we:
 *   1. append a `security` / `unauthorized_access` entry to ~/.ghostforge/audit.log
 *   2. lock the host PC (Windows, macOS, Linux)
 *
 * Locking is throttled to once per LOCK_COOLDOWN_MS so a flood of requests
 * can't keep re-locking the machine, and can be disabled with
 * GF_LOCK_ON_UNAUTHORIZED=0.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { auditLog } from './audit'
import { isHostedMode } from './hosted'

const execFileAsync = promisify(execFile)

const LOCK_COOLDOWN_MS = 60_000
let lastLockAt = 0

/** Permissions whose denial counts as an intrusion (not just a polite refusal) */
export const PRIVILEGED_PERMISSIONS = new Set([
  'admin_tools',
  'terminal',
  'mac_control',
  'native_desktop',
  'remote',
  'file_write',
  'screenshots',
])

export function lockOnUnauthorizedEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false
  // Hosted mode: a friend's failed login must never lock the machine it runs on
  if (isHostedMode()) return false
  return process.env.GF_LOCK_ON_UNAUTHORIZED !== '0'
}

/**
 * A forged-looking token is only evidence of tampering when the signing secret
 * is stable. With a per-run dev secret, every pre-restart cookie looks forged.
 */
export function hasStableAuthSecret(): boolean {
  return Boolean(process.env.AUTH_SECRET) && process.env.GF_EPHEMERAL_AUTH_SECRET !== '1'
}

async function tryAll(commands: Array<[string, string[]]>): Promise<string | null> {
  for (const [cmd, args] of commands) {
    try {
      await execFileAsync(cmd, args, { timeout: 10_000, windowsHide: true })
      return `${cmd} ${args.join(' ')}`.trim()
    } catch { /* try next */ }
  }
  return null
}

/** Lock the host workstation. Returns the method used, or null if every method failed. */
export async function lockWorkstation(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (platform === 'win32') {
    return tryAll([['rundll32.exe', ['user32.dll,LockWorkStation']]])
  }
  if (platform === 'darwin') {
    return tryAll([
      ['/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession', ['-suspend']],
      ['osascript', ['-e', 'tell application "System Events" to keystroke "q" using {command down, control down}']],
      ['pmset', ['displaysleepnow']],
    ])
  }
  return tryAll([
    ['loginctl', ['lock-session']],
    ['xdg-screensaver', ['lock']],
    ['gnome-screensaver-command', ['--lock']],
    ['dm-tool', ['lock']],
  ])
}

export interface IntrusionReport {
  reason: string
  ip?: string
  userAgent?: string
  username?: string
  tool?: string
  /** Set false to log without locking (e.g. informational events) */
  lock?: boolean
}

/** Log an unauthorized access attempt and lock the PC (throttled). */
export async function reportUnauthorizedAccess(report: IntrusionReport): Promise<{ locked: boolean; method: string | null }> {
  const wantLock = report.lock !== false && lockOnUnauthorizedEnabled()
  const now = Date.now()
  const cooledDown = now - lastLockAt >= LOCK_COOLDOWN_MS

  let method: string | null = null
  if (wantLock && cooledDown) {
    lastLockAt = now
    method = await lockWorkstation().catch(() => null)
  }

  await auditLog({
    level: 'security',
    event: 'unauthorized_access',
    tool: report.tool,
    ip: report.ip,
    userAgent: report.userAgent,
    params: { reason: report.reason, ...(report.username ? { username: report.username } : {}) },
    result: method ? `pc_locked via ${method}` : wantLock && !cooledDown ? 'lock_skipped_cooldown' : wantLock ? 'lock_failed' : 'logged_only',
    risk: 95,
    blocked: true,
  })

  return { locked: Boolean(method), method }
}

// ── Failed-login tracking ────────────────────────────────────────────────────

const LOGIN_WINDOW_MS = 10 * 60_000
export const MAX_FAILED_LOGINS = 5
const failedLogins = new Map<string, number[]>()

/** Record a failed login; returns the number of failures in the current window. */
export function recordFailedLogin(key: string, now = Date.now()): number {
  const recent = (failedLogins.get(key) || []).filter(t => now - t < LOGIN_WINDOW_MS)
  recent.push(now)
  failedLogins.set(key, recent)
  return recent.length
}

/** True while `key` has hit MAX_FAILED_LOGINS within the window. */
export function isLoginBlocked(key: string, now = Date.now()): boolean {
  const recent = (failedLogins.get(key) || []).filter(t => now - t < LOGIN_WINDOW_MS)
  return recent.length >= MAX_FAILED_LOGINS
}

export function clearFailedLogins(key: string): void {
  failedLogins.delete(key)
}

/**
 * Per-account limit, independent of the IP: rotating addresses doesn't buy an
 * attacker more guesses at one username. Higher than the per-IP limit so a
 * friend mistyping on two devices isn't locked out at once.
 */
export const MAX_FAILED_LOGINS_PER_USER = 10
const userKey = (username: string) => `user:${username.trim().toLowerCase()}`

export function recordFailedUserLogin(username: string, now = Date.now()): number {
  return recordFailedLogin(userKey(username), now)
}

export function isUserLoginBlocked(username: string, now = Date.now()): boolean {
  const recent = (failedLogins.get(userKey(username)) || []).filter(t => now - t < LOGIN_WINDOW_MS)
  return recent.length >= MAX_FAILED_LOGINS_PER_USER
}

export function clearFailedUserLogins(username: string): void {
  failedLogins.delete(userKey(username))
}

export function _resetIntrusionState(): void {
  failedLogins.clear()
  lastLockAt = 0
}
