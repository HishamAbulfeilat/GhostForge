/**
 * Mark-LIV action registry — the web-UI mirror of the vendored engine's tools.
 *
 * The desktop engine (vendor/mark-liv) self-describes each action via a TOOL
 * dict in actions/*.py. This file mirrors that surface for the web JARVIS /
 * chat experience: every entry maps to a natural-language prompt that the
 * GhostForge AI executes through its tool system (or relays to the bridge for
 * machine-touching actions when the bridge is online).
 *
 * Keep ids in sync with vendor/mark-liv/actions/*.py (upstream tool names).
 */

export type MarkLivScope = 'local' | 'device'

export interface MarkLivAction {
  /** Stable id — matches the upstream action module name in actions/*.py */
  id: string
  label: string
  icon: string
  /** Short description shown in panels/tooltips (mirrors upstream TOOL.description) */
  description: string
  /** Prompt template the AI receives when the action is run */
  prompt: string
  category: string
  /** local = web/AI can fulfill; device = needs the bridge / desktop engine */
  scope: MarkLivScope
}

export const MARK_LIV_CATEGORIES = [
  { id: 'system',        label: 'System',        icon: '⚙️' },
  { id: 'web',           label: 'Web',           icon: '🌐' },
  { id: 'files',         label: 'Files',         icon: '📁' },
  { id: 'media',         label: 'Media',         icon: '🎬' },
  { id: 'communication', label: 'Communication', icon: '💬' },
  { id: 'automation',    label: 'Automation',    icon: '🤖' },
  { id: 'monitoring',    label: 'Monitoring',    icon: '📊' },
] as const

export const MARK_LIV_ACTIONS: MarkLivAction[] = [
  // ── actions/web_search.py ──
  {
    id: 'web_search', label: 'Web Search', icon: '🔍',
    description: 'Multi-mode web search (news / research / price / compare) — Gemini Grounded first, DuckDuckGo fallback.',
    prompt: 'Search the web for: ', category: 'web', scope: 'local',
  },
  {
    id: 'background_monitor', label: 'Topic Watch', icon: '👁️‍🗨️',
    description: 'Watch a topic and check for new headlines once a day, alerting naturally.',
    prompt: 'Watch this topic for me and alert me on new headlines: ', category: 'monitoring', scope: 'local',
  },
  // ── actions/browser_control.py ──
  {
    id: 'browser_control', label: 'Browser Control', icon: '🌐',
    description: 'Open URLs, navigate tabs and interact with the browser by voice.',
    prompt: 'Open my browser and go to: ', category: 'web', scope: 'device',
  },
  // ── actions/code_helper.py ──
  {
    id: 'code_helper', label: 'Code Helper', icon: '💻',
    description: 'Inline code review, debugging and generation.',
    prompt: 'Review and fix this code: ', category: 'automation', scope: 'local',
  },
  // ── actions/file_processor.py ──
  {
    id: 'file_processor', label: 'File Processor', icon: '📄',
    description: 'Read, summarize and answer questions about local files (PDF, DOCX, sheets).',
    prompt: 'Summarize the file: ', category: 'files', scope: 'device',
  },
  // ── actions/file_controller.py ──
  {
    id: 'file_controller', label: 'File Manager', icon: '🗂️',
    description: 'Move, rename, organize and clean up files — with undo support.',
    prompt: 'Organize my files: ', category: 'files', scope: 'device',
  },
  // ── actions/computer_control.py ──
  {
    id: 'computer_control', label: 'Computer Control', icon: '🖱️',
    description: 'Full mouse/keyboard automation — click, type, and operate the desktop.',
    prompt: 'Control my computer: ', category: 'automation', scope: 'device',
  },
  // ── actions/computer_settings.py ──
  {
    id: 'computer_settings', label: 'System Settings', icon: '🎚️',
    description: 'Change OS settings: volume, brightness, WiFi, power, appearance.',
    prompt: 'Change system setting: ', category: 'system', scope: 'device',
  },
  // ── actions/open_app.py ──
  {
    id: 'open_app', label: 'Open App', icon: '🚀',
    description: 'Launch any installed application by name.',
    prompt: 'Open the app: ', category: 'system', scope: 'device',
  },
  // ── actions/desktop.py ──
  {
    id: 'desktop', label: 'Desktop Control', icon: '🖥️',
    description: 'Taskbar, window management and desktop-level operations.',
    prompt: 'Manage my desktop: ', category: 'system', scope: 'device',
  },
  // ── actions/screen_processor.py ──
  {
    id: 'screen_processor', label: 'Screen & Camera', icon: '👁️',
    description: 'Screen capture and webcam vision — describe, read and analyze what it sees.',
    prompt: 'Look at my screen and describe what you see', category: 'monitoring', scope: 'device',
  },
  // ── actions/system_monitor.py ──
  {
    id: 'system_monitor', label: 'Hardware Monitor', icon: '📊',
    description: 'Continuous CPU, RAM, GPU and temperature telemetry with localized voice alerts.',
    prompt: 'Show my hardware status (CPU, RAM, GPU, temperature)', category: 'monitoring', scope: 'local',
  },
  // ── actions/weather_report.py ──
  {
    id: 'weather_report', label: 'Weather', icon: '🌤️',
    description: 'Live weather for your city, personalized from memory.',
    prompt: 'What is the weather today?', category: 'web', scope: 'local',
  },
  // ── actions/reminder.py ──
  {
    id: 'reminder', label: 'Smart Reminder', icon: '⏰',
    description: 'OS-native scheduled notifications (Task Scheduler / LaunchAgent / systemd).',
    prompt: 'Set a reminder for: ', category: 'automation', scope: 'device',
  },
  // ── actions/proactive.py ──
  {
    id: 'proactive', label: 'Proactive Check-in', icon: '🔔',
    description: 'Time-aware, context-aware check-ins — knows the time of day and your projects.',
    prompt: 'Give me a proactive briefing — time of day, my projects, and what we discussed', category: 'automation', scope: 'local',
  },
  // ── actions/dev_agent.py ──
  {
    id: 'dev_agent', label: 'Dev Agent', icon: '🧑‍💻',
    description: 'Autonomous high-level planning for complex multi-step development goals.',
    prompt: 'Plan and execute this dev task: ', category: 'automation', scope: 'local',
  },
  // ── actions/flight_finder.py ──
  {
    id: 'flight_finder', label: 'Flight Finder', icon: '✈️',
    description: 'Live flight price and availability lookup.',
    prompt: 'Find flights: ', category: 'web', scope: 'local',
  },
  // ── actions/game_updater.py ──
  {
    id: 'game_updater', label: 'Game Updater', icon: '🎮',
    description: 'Check and trigger game updates on Steam and Epic Games on demand.',
    prompt: 'Check for updates on my games', category: 'media', scope: 'device',
  },
  // ── actions/youtube_video.py ──
  {
    id: 'youtube_video', label: 'YouTube Control', icon: '▶️',
    description: 'Search, play and control YouTube playback by voice.',
    prompt: 'Search YouTube for: ', category: 'media', scope: 'local',
  },
  // ── actions/send_message.py ──
  {
    id: 'send_message', label: 'Send Message', icon: '📨',
    description: 'Compose and send messages through WhatsApp, Telegram and more.',
    prompt: 'Send a message via: ', category: 'communication', scope: 'device',
  },
]

/** Get a Mark-LIV action by id (used by /api/jarvis and quick-action chips). */
export function getMarkLivAction(id: string): MarkLivAction | undefined {
  return MARK_LIV_ACTIONS.find(a => a.id === id)
}

/** Human-readable status line for the vendored Mark-LIV engine. */
export function markLivStatus(): string {
  const device = MARK_LIV_ACTIONS.filter(a => a.scope === 'device').length
  return [
    `Mark-LIV engine (vendored at vendor/mark-liv): ${MARK_LIV_ACTIONS.length} actions registered`,
    `  • ${MARK_LIV_ACTIONS.length - device} run fully in the web/AI layer`,
    `  • ${device} touch the device via the bridge or the desktop engine`,
    'Desktop engine:  scripts/mark-liv.sh start   (deps: scripts/mark-liv.sh setup)',
    'Phone dashboard: scripts/mark-liv.sh dashboard  → http://localhost:8000',
  ].join('\n')
}

/** Describe how an action runs in the web context (used by the mark_liv tool). */
export function markLivActionHint(id: string): string | undefined {
  const a = getMarkLivAction(id)
  if (!a) return undefined
  if (a.scope === 'local') {
    return `${a.icon} ${a.label} (${a.id}, web/AI layer): ${a.description}\nPrompt the assistant: "${a.prompt}"`
  }
  return `${a.icon} ${a.label} (${a.id}, device action): ${a.description}\nRuns through the bridge or desktop engine — start the bridge from /dashboard or launch scripts/mark-liv.sh start.`
}

// ── Quick-action execution mapping ───────────────────────────────────────
// Maps a Mark-LIV action id to an existing GhostForge tool so the JARVIS
// quick-action path can execute it with the risk/confirmation/audit flow.
// Actions without a clean web-layer equivalent resolve to the `mark_liv`
// meta-tool, whose hint points at the bridge / desktop engine.

interface ToolResolution {
  tool: string
  toolParams: Record<string, string>
}

/** Extract the fill-in suffix the user typed after a "...: " prompt template. */
function fillInText(action: MarkLivAction, message: string): string {
  const idx = action.prompt.lastIndexOf(':')
  const prefix = idx >= 0 ? action.prompt.slice(0, idx + 1) : action.prompt
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : ''
}

const MARK_LIV_TOOL_MAP: Record<string, (t: string) => ToolResolution> = {
  web_search:        t => ({ tool: 'web_search', toolParams: { query: t } }),
  weather_report:    () => ({ tool: 'get_weather', toolParams: {} }),
  system_monitor:    () => ({ tool: 'hardware_monitor', toolParams: { report_type: 'full' } }),
  flight_finder:     () => ({ tool: 'flight_finder', toolParams: {} }),
  youtube_video:     t => ({ tool: 'youtube_control', toolParams: { action: 'search', query: t } }),
  game_updater:      t => ({ tool: 'game_manager', toolParams: { action: 'update', game_name: t } }),
  open_app:          t => ({ tool: 'open_app', toolParams: { app: t } }),
  browser_control:   t => (t ? { tool: 'browser_control', toolParams: { action: 'search', text: t } } : { tool: 'browser_control', toolParams: { action: 'open' } }) as ToolResolution,
  code_helper:       t => ({ tool: 'copilot_ask', toolParams: { question: t } }),
  dev_agent:         t => ({ tool: 'open_interpreter', toolParams: { prompt: t } }),
  computer_control:  t => ({ tool: 'open_interpreter', toolParams: { prompt: t } }),
  file_processor:    t => ({ tool: 'file_processor', toolParams: { action: 'read', file_path: t } }),
  file_controller:   t => ({ tool: 'get_files', toolParams: { path: t } }),
  screen_processor:  () => ({ tool: 'describe_screen', toolParams: {} }),
  reminder:          t => ({ tool: 'set_reminder', toolParams: { title: t } }),
  proactive:         () => ({ tool: 'web_search', toolParams: { query: 'latest news today', mode: 'news' } }),
  desktop:           () => ({ tool: 'native_desktop', toolParams: { action: 'status' } }),
}

/**
 * Resolve a Mark-LIV quick action to an executable GhostForge tool.
 * Returns undefined when the id is not a Mark-LIV action.
 */
export function resolveMarkLivTool(id: string, message: string): ToolResolution | undefined {
  const action = getMarkLivAction(id)
  if (!action) return undefined
  const text = fillInText(action, message)
  const mapped = MARK_LIV_TOOL_MAP[id]
  if (mapped) return mapped(text)
  // No web-layer equivalent — surface the engine hint instead.
  return { tool: 'mark_liv', toolParams: { action: 'run', id } }
}

/**
 * Prompt sent to the AI when a device-scoped action runs while the bridge is
 * offline — the AI should explain what it would do instead of pretending.
 */
export function markLivPromptFor(action: MarkLivAction, bridgeOnline: boolean): string {
  if (bridgeOnline || action.scope === 'local') return action.prompt
  return `[bridge offline — this action needs the desktop engine or bridge; explain what you would do and offer to start the bridge] ${action.prompt}`
}
