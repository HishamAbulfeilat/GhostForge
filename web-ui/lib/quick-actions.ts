export interface QuickAction {
  id: string
  label: string
  prompt: string
  icon?: string
  scope?: string
  category?: string
  tool?: string | null
  params?: Record<string, string>
  /** Windows wording for actions that are mac-scoped by default (shown on Windows hosts). */
  winPrompt?: string
}

export const JARVIS_QUICK_ACTIONS: QuickAction[] = [
  { id: 'time',      label: '🕐 TIME',       prompt: 'What time is it?',                          icon: '🕐', category: 'system', tool: 'get_time', params: {} },
  { id: 'weather',   label: '🌤 WEATHER',    prompt: 'What is the weather today?',                icon: '🌤', category: 'system', tool: 'get_weather', params: {} },
  { id: 'search',    label: '🔍 SEARCH',     prompt: 'Search the web for: ',                      icon: '🔍', category: 'web' },
  { id: 'messages',  label: '💬 MESSAGES',   prompt: 'Read my latest messages',                   icon: '💬', category: 'communication' },
  { id: 'music',     label: '🎵 MUSIC',      prompt: 'Play some music',                           icon: '🎵', category: 'media' },
  { id: 'reminder',  label: '⏰ REMINDER',   prompt: 'Set a reminder for: ',                      icon: '⏰', category: 'system' },
  { id: 'apps',      label: '📱 APPS',       prompt: 'List my installed apps',                    icon: '📱', category: 'system', scope: 'mac', winPrompt: 'List my installed apps (use PowerShell Get-StartApps)' },
  { id: 'terminal',  label: '⬛ TERMINAL',   prompt: 'Open a terminal session',                   icon: '⬛', category: 'system', scope: 'mac', winPrompt: 'Open a PowerShell terminal session' },
  { id: 'screenshot',label: '📸 SCREENSHOT', prompt: 'Take a screenshot',                         icon: '📸', category: 'vision', scope: 'mac', tool: 'take_screenshot', params: {}, winPrompt: 'Take a screenshot of my screen' },
  { id: 'volume',    label: '🔊 VOLUME',     prompt: 'Adjust the system volume',                  icon: '🔊', category: 'system', scope: 'mac', winPrompt: 'Adjust the system volume' },
  { id: 'clipboard', label: '📋 CLIPBOARD',  prompt: 'What is on my clipboard?',                  icon: '📋', category: 'system', tool: 'get_clipboard', params: {} },
  { id: 'github',    label: '🐙 GITHUB',     prompt: 'Show my GitHub notifications',              icon: '🐙', category: 'web' },
  { id: 'discord',   label: '💬 DISCORD',    prompt: 'Check Discord messages',                    icon: '💬', category: 'communication' },
  { id: 'browser',   label: '🌐 BROWSER',    prompt: 'Open browser and search for: ',             icon: '🌐', category: 'web', scope: 'mac', winPrompt: 'Open my default browser and search for: ' },
  { id: 'youtube',   label: '▶️ YOUTUBE',    prompt: 'Search YouTube for: ',                      icon: '▶️', category: 'media' },
  { id: 'files',     label: '📁 FILES',      prompt: 'List files in my home directory',           icon: '📁', category: 'files', scope: 'mac', winPrompt: 'List files in my user profile folder' },
  { id: 'hardware',  label: '🖥 HARDWARE',   prompt: 'Show my hardware specs',                    icon: '🖥', category: 'system', scope: 'mac', winPrompt: 'Show my hardware specs (CPU, RAM, GPU, disk)' },
  { id: 'games',     label: '🎮 GAMES',      prompt: 'What games do I have installed?',           icon: '🎮', category: 'games', scope: 'mac', winPrompt: 'What games do I have installed? (check Steam and the Start menu)' },
  { id: 'calendar',  label: '📅 CALENDAR',   prompt: 'Show my calendar for today',                icon: '📅', category: 'system' },
  { id: 'translate', label: '🔄 TRANSLATE',  prompt: 'Translate this to Arabic: ',                 icon: '🔄', category: 'communication' },
  { id: 'email',     label: '📧 EMAIL',      prompt: 'Check my latest emails',                    icon: '📧', category: 'communication' },
  { id: 'notes',     label: '📝 NOTES',      prompt: 'Create a note: ',                           icon: '📝', category: 'files' },
  { id: 'code',      label: '💻 CODE',       prompt: 'Help me write code for: ',                  icon: '💻', category: 'system' },
  { id: 'ai',        label: '🤖 AI MODEL',   prompt: 'Switch to the best available AI model',     icon: '🤖', category: 'system' },
  { id: 'security',  label: '🔒 SECURITY',   prompt: 'Run a security scan on my system',          icon: '🔒', category: 'system', scope: 'mac', winPrompt: 'Check Windows Security status (Defender, firewall, updates)' },
  { id: 'voice',     label: '🎙 VOICE',      prompt: 'What voice engines are available?',         icon: '🎙', category: 'voice' },
  { id: 'vision',    label: '👁 VISION',      prompt: 'Look at my screen and describe what you see', icon: '👁', category: 'vision' },
  { id: 'memory',    label: '🧠 MEMORY',     prompt: 'What do you remember about me?',            icon: '🧠', category: 'memory' },
  { id: 'standup',   label: '📋 STANDUP',    prompt: 'Generate my daily standup summary',         icon: '📋', category: 'system' },
  { id: 'n8n',       label: '⚡ N8N',         prompt: 'List my n8n workflows',                     icon: '⚡', category: 'workflows' },
  { id: 'n8n-deploy',label: '🚀 N8N DEPLOY',  prompt: 'Trigger the n8n deploy workflow',           icon: '🚀', category: 'workflows' },
  { id: 'n8n-notify',label: '📢 N8N NOTIFY',  prompt: 'Send a notification via n8n',               icon: '📢', category: 'workflows' },
  { id: 'n8n-pr',    label: '🔀 N8N PR',      prompt: 'Review a pull request via n8n',             icon: '🔀', category: 'workflows' },
  { id: 'system',     label: '💻 SYSTEM',     prompt: 'Give me a system status report.',            icon: '💻', category: 'system', tool: 'get_system_info', params: {} },
  { id: 'lock',       label: '🔒 LOCK',       prompt: 'Lock the Mac screen.',                       icon: '🔒', category: 'system', scope: 'mac', tool: 'lock_screen', params: {}, winPrompt: 'Lock this PC.' },
  { id: 'dashboard',  label: '🌐 DASHBOARD',  prompt: 'Open the GhostForge dashboard in the browser.', icon: '🌐', category: 'web', tool: 'open_url', params: { url: 'http://localhost:3001/dashboard' } },
  { id: 'models',     label: '🧠 MODELS',     prompt: 'List installed local models.',              icon: '🧠', category: 'system', tool: 'list_local_models', params: {} },
  { id: 'screen_understand', label: '👁 UNDERSTAND SCREEN', prompt: 'What do you see on this screen? Describe the UI elements.', icon: '👁', category: 'vision', scope: 'mac', tool: 'understand_screen', params: {} },
  { id: 'find_button', label: '🔎 FIND BUTTON', prompt: 'Find a clickable button or link on the screen.', icon: '🔎', category: 'vision', scope: 'mac', tool: 'find_element', params: { description: 'button' } },
  { id: 'read_screen_text', label: '📖 READ SCREEN', prompt: 'Read all the text visible on screen.', icon: '📖', category: 'vision', scope: 'mac', tool: 'read_text_on_screen', params: {} },
]

export const QUICK_ACTION_CATEGORIES = [
  { id: 'system',        label: 'System',        icon: '⚙️'  },
  { id: 'voice',         label: 'Voice',         icon: '🎙'  },
  { id: 'vision',        label: 'Vision',        icon: '👁'  },
  { id: 'web',           label: 'Web',           icon: '🌐'  },
  { id: 'files',         label: 'Files',         icon: '📁'  },
  { id: 'games',         label: 'Games',         icon: '🎮'  },
  { id: 'communication', label: 'Communication', icon: '💬'  },
  { id: 'memory',        label: 'Memory',        icon: '🧠'  },
  { id: 'media',         label: 'Media',         icon: '🎵'  },
  { id: 'workflows',     label: 'Workflows',     icon: '⚡'  },
] as const

/**
 * Quick actions for a host platform. Mac-scoped actions are shown on macOS
 * (when the host can control the Mac) and, where a Windows wording exists,
 * on Windows too. Nothing macOS-only is offered on other hosts.
 */
export function getQuickActionsForHost(
  platform: string,
  caps: { macControl: boolean; browserControl: boolean } = { macControl: platform === 'darwin', browserControl: platform === 'darwin' },
): QuickAction[] {
  const out: QuickAction[] = []
  for (const action of JARVIS_QUICK_ACTIONS) {
    if (platform === 'win32' && action.winPrompt) {
      out.push({ ...action, prompt: action.winPrompt, scope: undefined })
      continue
    }
    if (action.scope === 'mac' && !caps.macControl) continue
    if (action.id === 'browser' && !caps.browserControl) continue
    out.push(action)
  }
  return out
}

/** Get a quick action by its ID — used by the JARVIS API route to resolve prompts */
export function getJarvisQuickAction(id: string): QuickAction | undefined {
  return JARVIS_QUICK_ACTIONS.find(a => a.id === id)
}

// ── Terminal Feature Groups ──────────────────────────────────────────────────

export interface TerminalFeatureEntry {
  label: string
  command: string
}

export interface TerminalFeatureGroup {
  label: string
  color: string
  commands: TerminalFeatureEntry[]
}

export const TERMINAL_FEATURE_GROUPS: TerminalFeatureGroup[] = [
  {
    label: '🌿 Carbon', color: 'emerald', commands: [
      { label: 'Status', command: 'ghostforge carbon status' },
      { label: 'Live', command: 'ghostforge carbon live' },
      { label: 'Weekly', command: 'ghostforge carbon weekly' },
      { label: 'Badge', command: 'ghostforge carbon badge' },
    ],
  },
  {
    label: '🏥 Health', color: 'sky', commands: [
      { label: 'Score', command: 'ghostforge health-score score' },
      { label: 'Dep Health', command: 'ghostforge dep-health check' },
      { label: 'Bundle', command: 'ghostforge bundle track' },
      { label: 'Coverage', command: 'ghostforge coverage snapshot' },
    ],
  },
  {
    label: '🤖 AI Tools', color: 'violet', commands: [
      { label: 'AI Review', command: 'ghostforge ai-review staged' },
      { label: 'Standup', command: 'ghostforge standup today' },
      { label: 'Explain Last', command: 'ghostforge explain last' },
      { label: 'Tech Debt', command: 'ghostforge tech-debt scan' },
    ],
  },
  {
    label: '⚙️ Git', color: 'amber', commands: [
      { label: 'Status', command: 'git status --short --branch' },
      { label: 'Release', command: 'ghostforge release status' },
      { label: 'PR Status', command: 'gh pr status' },
      { label: 'Git Hooks', command: 'ghostforge git-hooks-setup status' },
    ],
  },
  {
    label: '🔧 Generate', color: 'rose', commands: [
      { label: 'Components', command: 'ghostforge component-gen list' },
      { label: 'API Scan', command: 'ghostforge api-docs scan' },
      { label: 'Docker', command: 'ghostforge docker-gen generate' },
      { label: 'DB Schemas', command: 'ghostforge schema-viz list' },
    ],
  },
  {
    label: '🛠️ System', color: 'gray', commands: [
      { label: 'Marketplace', command: 'ghostforge marketplace list' },
      { label: 'Lighthouse', command: 'ghostforge lighthouse history' },
      { label: 'A11y Reports', command: 'ghostforge a11y report' },
      { label: 'Doctor', command: 'ghostforge doctor --json' },
    ],
  },
]
