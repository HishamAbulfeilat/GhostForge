/**
 * GhostForge AI — Audit Log System
 * Logs all tool executions, access attempts, and security events.
 * Logs are stored at ~/.ghostforge/audit.log (JSONL format)
 */

import { appendFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const AUDIT_DIR  = join(homedir(), '.ghostforge')
const AUDIT_FILE = join(AUDIT_DIR, 'audit.log')

export type AuditLevel = 'info' | 'warn' | 'danger' | 'security' | 'access'

export interface AuditEntry {
  ts:       string
  level:    AuditLevel
  event:    string
  tool?:    string
  params?:  Record<string, unknown>
  result?:  string
  ip?:      string
  userAgent?: string
  risk?:    number  // 0-100
  blocked?: boolean
}

/** Append one audit entry to the JSONL log file */
export async function auditLog(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
  try {
    if (!existsSync(AUDIT_DIR)) await mkdir(AUDIT_DIR, { recursive: true })
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    await appendFile(AUDIT_FILE, line, 'utf8')
  } catch { /* never crash the main flow */ }
}

// ── Risk Assessment ───────────────────────────────────────────────────────────

/** Tools and patterns that require explicit user confirmation */
export const HIGH_RISK_TOOLS = new Set([
  'terminal_command', 'mac_control', 'execute_code', 'task_steps',
])

/** Patterns in params/commands that indicate extreme risk */
const DANGER_PATTERNS = [
  /rm\s+-rf/i,          // recursive delete
  /sudo\s+rm/i,
  /del\s+\/[fqs]/i,     // Windows del
  /format\s+(c:|\/dev)/i,
  /dd\s+if=\/dev\//i,   // disk wipe
  /mkfs\./i,
  /shred\s+/i,
  /:\(\)\{.*fork\s*bomb/i,
  /chmod\s+777\s+\//i,
  /chown\s+-R.*\//i,
  /launchctl\s+(unload|disable)/i,  // macOS service disable
  /csrutil\s+disable/i,              // SIP disable
  /nvram\s+.*erase/i,
]

/** Patterns that are medium risk (warn but allow) */
const WARN_PATTERNS = [
  /rm\s+/i,
  /uninstall/i,
  /delete/i,
  /reboot|shutdown|halt/i,
  /kill\s+-9/i,
  /systemctl\s+(stop|disable)/i,
  /brew\s+uninstall/i,
  /npm\s+uninstall/i,
]

export interface RiskAssessment {
  risk:     number     // 0-100
  level:    'safe' | 'warn' | 'danger' | 'blocked'
  reason:   string
  requires_confirmation: boolean
}

/** Assess risk of a tool call */
export function assessRisk(tool: string, params: Record<string, unknown>): RiskAssessment {
  const paramStr = JSON.stringify(params).toLowerCase()

  // Check for extreme danger patterns
  if (DANGER_PATTERNS.some(p => p.test(paramStr))) {
    return {
      risk: 95,
      level: 'danger',
      reason: 'Dangerous destructive command detected. This could permanently damage your system.',
      requires_confirmation: true,
    }
  }

  // Tool-specific risk
  if (tool === 'terminal_command' || tool === 'execute_code' || tool === 'task_steps') {
    if (WARN_PATTERNS.some(p => p.test(paramStr))) {
      return {
        risk: 60,
        level: 'warn',
        reason: 'Command may modify or delete files/apps. Review before executing.',
        requires_confirmation: true,
      }
    }
    return { risk: 30, level: 'warn', reason: 'Shell command execution', requires_confirmation: false }
  }

  if (tool === 'mac_control') {
    if (paramStr.includes('delete') || paramStr.includes('quit') || paramStr.includes('force')) {
      return { risk: 45, level: 'warn', reason: 'Mac control with destructive action', requires_confirmation: true }
    }
    return { risk: 20, level: 'safe', reason: 'Mac AppleScript automation', requires_confirmation: false }
  }

  if (tool === 'send_imessage' || tool === 'send_teams_message' || tool === 'send_slack_message' || tool === 'send_whatsapp_message') {
    return { risk: 25, level: 'warn', reason: 'Message will be sent to real contact', requires_confirmation: false }
  }

  if (tool === 'flight_finder') {
    return { risk: 10, level: 'safe', reason: 'Opens a read-only Google Flights search', requires_confirmation: false }
  }

  if (tool === 'browser_control') {
    return { risk: 15, level: 'safe', reason: 'Browser automation on the GhostForge host', requires_confirmation: false }
  }

  if (tool === 'vault_save' || tool === 'write_note' || tool === 'set_reminder' || tool === 'set_goal') {
    return { risk: 5, level: 'safe', reason: 'Saves data locally', requires_confirmation: false }
  }

  return { risk: 5, level: 'safe', reason: 'Low-risk information tool', requires_confirmation: false }
}

// ── Behavioral Auth ───────────────────────────────────────────────────────────

interface TypingProfile {
  avgWordLen:    number
  commonPhrases: string[]
  queryPatterns: string[]   // regex patterns of common queries
  sessionCount:  number
  lastSeen:      string
}

/** Very lightweight behavioral scoring — checks message patterns against stored profile */
export function behavioralScore(message: string, profile: TypingProfile | null): number {
  if (!profile || profile.sessionCount < 5) return 100 // Not enough data to judge

  let score = 100

  // Check average word length
  const words = message.split(/\s+/).filter(Boolean)
  const avgLen = words.reduce((s, w) => s + w.length, 0) / Math.max(words.length, 1)
  const lenDiff = Math.abs(avgLen - profile.avgWordLen)
  if (lenDiff > 3) score -= 20

  // Check for common phrases
  const lowerMsg = message.toLowerCase()
  const phraseMatches = profile.commonPhrases.filter(p => lowerMsg.includes(p)).length
  if (profile.commonPhrases.length > 0 && phraseMatches === 0) score -= 15

  return Math.max(0, score)
}

export function getAuditFilePath(): string { return AUDIT_FILE }
