export interface QuickAction {
  id: string
  label: string
  prompt: string
  icon?: string
  scope?: string
  category?: string
  tool?: string | null
  params?: Record<string, string>
}

export const JARVIS_QUICK_ACTIONS: QuickAction[] = [
  { id: 'time',      label: '🕐 TIME',       prompt: 'What time is it?',                          icon: '🕐', category: 'system' },
  { id: 'weather',   label: '🌤 WEATHER',    prompt: 'What is the weather today?',                icon: '🌤', category: 'system' },
  { id: 'search',    label: '🔍 SEARCH',     prompt: 'Search the web for: ',                      icon: '🔍', category: 'web' },
  { id: 'messages',  label: '💬 MESSAGES',   prompt: 'Read my latest messages',                   icon: '💬', category: 'communication' },
  { id: 'music',     label: '🎵 MUSIC',      prompt: 'Play some music',                           icon: '🎵', category: 'media' },
  { id: 'reminder',  label: '⏰ REMINDER',   prompt: 'Set a reminder for: ',                      icon: '⏰', category: 'system' },
  { id: 'apps',      label: '📱 APPS',       prompt: 'List my installed apps',                    icon: '📱', category: 'system', scope: 'mac' },
  { id: 'terminal',  label: '⬛ TERMINAL',   prompt: 'Open a terminal session',                   icon: '⬛', category: 'system', scope: 'mac' },
  { id: 'screenshot',label: '📸 SCREENSHOT', prompt: 'Take a screenshot',                         icon: '📸', category: 'vision', scope: 'mac' },
  { id: 'volume',    label: '🔊 VOLUME',     prompt: 'Adjust the system volume',                  icon: '🔊', category: 'system', scope: 'mac' },
  { id: 'clipboard', label: '📋 CLIPBOARD',  prompt: 'What is on my clipboard?',                  icon: '📋', category: 'system' },
  { id: 'github',    label: '🐙 GITHUB',     prompt: 'Show my GitHub notifications',              icon: '🐙', category: 'web' },
  { id: 'discord',   label: '💬 DISCORD',    prompt: 'Check Discord messages',                    icon: '💬', category: 'communication' },
  { id: 'browser',   label: '🌐 BROWSER',    prompt: 'Open browser and search for: ',             icon: '🌐', category: 'web', scope: 'mac' },
  { id: 'youtube',   label: '▶️ YOUTUBE',    prompt: 'Search YouTube for: ',                      icon: '▶️', category: 'media' },
  { id: 'files',     label: '📁 FILES',      prompt: 'List files in my home directory',           icon: '📁', category: 'files', scope: 'mac' },
  { id: 'hardware',  label: '🖥 HARDWARE',   prompt: 'Show my hardware specs',                    icon: '🖥', category: 'system', scope: 'mac' },
  { id: 'games',     label: '🎮 GAMES',      prompt: 'What games do I have installed?',           icon: '🎮', category: 'games', scope: 'mac' },
  { id: 'calendar',  label: '📅 CALENDAR',   prompt: 'Show my calendar for today',                icon: '📅', category: 'system' },
  { id: 'translate', label: '🔄 TRANSLATE',  prompt: 'Translate this to Arabic: ',                 icon: '🔄', category: 'communication' },
  { id: 'email',     label: '📧 EMAIL',      prompt: 'Check my latest emails',                    icon: '📧', category: 'communication' },
  { id: 'notes',     label: '📝 NOTES',      prompt: 'Create a note: ',                           icon: '📝', category: 'files' },
  { id: 'code',      label: '💻 CODE',       prompt: 'Help me write code for: ',                  icon: '💻', category: 'system' },
  { id: 'ai',        label: '🤖 AI MODEL',   prompt: 'Switch to the best available AI model',     icon: '🤖', category: 'system' },
  { id: 'security',  label: '🔒 SECURITY',   prompt: 'Run a security scan on my system',          icon: '🔒', category: 'system', scope: 'mac' },
  { id: 'voice',     label: '🎙 VOICE',      prompt: 'What voice engines are available?',         icon: '🎙', category: 'voice' },
  { id: 'vision',    label: '👁 VISION',      prompt: 'Look at my screen and describe what you see', icon: '👁', category: 'vision' },
  { id: 'memory',    label: '🧠 MEMORY',     prompt: 'What do you remember about me?',            icon: '🧠', category: 'memory' },
  { id: 'standup',   label: '📋 STANDUP',    prompt: 'Generate my daily standup summary',         icon: '📋', category: 'system' },
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
] as const

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
    label: 'System',
    color: 'emerald',
    commands: [
      { label: '📊 CPU', command: 'top -l 1 -n 0 | head -12' },
      { label: '💾 Memory', command: 'vm_stat' },
      { label: '🔋 Battery', command: 'pmset -g batt' },
      { label: '🌡 Temp', command: 'sudo powermetrics --samplers smc -n 1 -i 1000 | grep "CPU temp"' },
      { label: '🌐 IP', command: 'ifconfig | grep "inet " | grep -v 127.0.0.1' },
      { label: '⏱ Uptime', command: 'uptime' },
    ],
  },
  {
    label: 'Files',
    color: 'sky',
    commands: [
      { label: '📁 Home', command: 'ls -la ~' },
      { label: '📥 Downloads', command: 'ls -lt ~/Downloads | head -20' },
      { label: '🔍 Find', command: 'find ~ -maxdepth 3 -type f -name "*.ts" 2>/dev/null | head -20' },
      { label: '📊 Disk', command: 'df -h' },
    ],
  },
  {
    label: 'Git',
    color: 'violet',
    commands: [
      { label: '📋 Status', command: 'git status' },
      { label: '📜 Log', command: 'git log --oneline -10' },
      { label: '🌿 Branch', command: 'git branch -a' },
      { label: '📊 Diff', command: 'git diff --stat' },
    ],
  },
  {
    label: 'Network',
    color: 'amber',
    commands: [
      { label: '🌐 Ping', command: 'ping -c 3 8.8.8.8' },
      { label: '📡 DNS', command: 'nslookup google.com' },
      { label: '🔌 Ports', command: 'lsof -i -P | grep LISTEN | head -15' },
    ],
  },
  {
    label: 'Dev',
    color: 'rose',
    commands: [
      { label: '📦 NPM', command: 'npm ls --depth=0' },
      { label: '🐍 Python', command: 'python3 --version' },
      { label: '☕ Java', command: 'java -version 2>&1' },
      { label: '🐳 Docker', command: 'docker ps --format "table {{.Names}}\\t{{.Status}}"' },
    ],
  },
  {
    label: 'Quick',
    color: 'gray',
    commands: [
      { label: '🧹 Clear', command: 'clear' },
      { label: '📋 Paste', command: '' },
      { label: '🔄 History', command: 'history | tail -20' },
      { label: '🚪 Exit', command: 'exit' },
    ],
  },
]
