/**
 * GhostForge permission catalog.
 *
 * Regular users get a subset of these permission keys. Admins implicitly hold
 * every permission (`*`). The catalog drives both the JARVIS tool gating and
 * the admin Users page permission editor UI.
 */

export interface PermissionDef {
  key: string
  label: string
  description: string
  group: 'core' | 'search' | 'files' | 'messaging' | 'system' | 'productivity' | 'ai'
}

export const PERMISSIONS: PermissionDef[] = [
  // ── core ─────────────────────────────────────────────────────────────────
  { key: 'chat', label: 'JARVIS Chat', description: 'Send messages to JARVIS and get replies.', group: 'core' },
  { key: 'conversation_history', label: 'Conversation history', description: 'Read and continue past sessions.', group: 'core' },

  // ── search ──────────────────────────────────────────────────────────────
  { key: 'web_search', label: 'Web search', description: 'Google/web search, news, lookups.', group: 'search' },
  { key: 'weather', label: 'Weather', description: 'Current weather and forecasts.', group: 'search' },

  // ── files ───────────────────────────────────────────────────────────────
  { key: 'file_read', label: 'Read files', description: 'List, read and inspect files.', group: 'files' },
  { key: 'file_write', label: 'Write files', description: 'Create, edit and save files.', group: 'files' },
  { key: 'file_process', label: 'File processor', description: 'Summarize and convert documents.', group: 'files' },
  { key: 'documents', label: 'Office documents', description: 'Generate and manage memos, minutes, reports, cover letters and contracts.', group: 'files' },
  { key: 'job_hunter', label: 'Job Hunter', description: 'Find matching jobs from your CV, tailor applications and auto-fill forms for approval.', group: 'productivity' },
  { key: 'career', label: 'Career tools', description: 'CV management, job application tracker, interview prep, LinkedIn content.', group: 'productivity' },
  { key: 'voice', label: 'Voice pipeline', description: 'Local offline speech-to-text / text-to-speech and voice status.', group: 'core' },
  { key: 'semantic_memory', label: 'Semantic memory', description: 'Long-term vector memory: remember and recall facts by meaning.', group: 'core' },
  { key: 'mcp', label: 'MCP tools', description: 'Call tools exposed by the bundled MCP server.', group: 'ai' },
  { key: 'native_desktop', label: 'Native desktop', description: 'nut.js / native mouse-keyboard automation.', group: 'system' },

  // ── messaging ───────────────────────────────────────────────────────────
  { key: 'send_message', label: 'Send messages', description: 'Send iMessage, email, Teams, WhatsApp, Slack.', group: 'messaging' },
  { key: 'user_message', label: 'Message other users', description: 'JARVIS can message other GhostForge users.', group: 'messaging' },
  { key: 'email', label: 'Email', description: 'Read, send, and manage email.', group: 'messaging' },

  // ── system ──────────────────────────────────────────────────────────────
  { key: 'system_info', label: 'System info', description: 'CPU, RAM, disk, battery, hardware stats.', group: 'system' },
  { key: 'mac_control', label: 'Mac control', description: 'Control the Mac: apps, windows, keyboard, clicks.', group: 'system' },
  { key: 'terminal', label: 'Terminal', description: 'Run terminal commands.', group: 'system' },
  { key: 'screenshots', label: 'Screenshots', description: 'Capture and describe the screen.', group: 'system' },
  { key: 'admin_tools', label: 'Admin tools', description: 'Lock screen, volume, system control, user management.', group: 'system' },

  // ── productivity ────────────────────────────────────────────────────────
  { key: 'reminders', label: 'Reminders', description: 'Create and manage reminders.', group: 'productivity' },
  { key: 'calendar', label: 'Calendar', description: 'View and manage calendar events.', group: 'productivity' },
  { key: 'contacts', label: 'Contacts', description: 'Search contacts.', group: 'productivity' },
  { key: 'github', label: 'GitHub', description: 'Browse repos, PRs, issues.', group: 'productivity' },
  { key: 'browser', label: 'Browser control', description: 'Open, navigate and automate the browser.', group: 'productivity' },
  { key: 'youtube', label: 'YouTube', description: 'Search, play and summarize videos.', group: 'productivity' },
  { key: 'game_manager', label: 'Games', description: 'Scan and update game libraries.', group: 'productivity' },
  { key: 'clipboard', label: 'Clipboard', description: 'Clipboard analysis and history.', group: 'productivity' },
  { key: 'n8n', label: 'Workflows', description: 'n8n workflow triggers and notifications.', group: 'productivity' },

  // ── AI ──────────────────────────────────────────────────────────────────
  { key: 'ai_models', label: 'AI model management', description: 'List, install and switch AI models.', group: 'ai' },
  { key: 'ai_studio', label: 'AI Studio', description: 'Google AI Studio test and compare.', group: 'ai' },
  { key: 'copilot', label: 'Copilot', description: 'GitHub Copilot questions.', group: 'ai' },
  { key: 'code_helper', label: 'Code helper', description: 'Write and debug code.', group: 'ai' },
  { key: 'remote', label: 'Remote access', description: 'Control the Mac remotely.', group: 'ai' },
]

export const PERMISSION_GROUPS = ['core', 'search', 'files', 'messaging', 'system', 'productivity', 'ai'] as const

export const PERMISSIONS_BY_GROUP: Record<string, PermissionDef[]> = PERMISSIONS.reduce(
  (acc, p) => {
    ;(acc[p.group] ||= []).push(p)
    return acc
  },
  {} as Record<string, PermissionDef[]>,
)

export function permissionLabel(key: string): string {
  return PERMISSIONS.find(p => p.key === key)?.label || key
}

/** Default permission set granted to a newly-created regular user */
export const DEFAULT_USER_PERMISSIONS = [
  'chat',
  'conversation_history',
  'web_search',
  'weather',
  'file_read',
  'file_process',
  'documents',
  'reminders',
  'calendar',
  'contacts',
  'youtube',
  'clipboard',
  'ai_models',
  'voice',
  'semantic_memory',
  'documents',
]

/** Full permission set — effectively what admins get */
export const ALL_PERMISSIONS = PERMISSIONS.map(p => p.key)
