const JARVIS_QUICK_ACTIONS = [
  { id: 'time', label: '⏰ Time', prompt: 'What is the current time and date?', tool: 'get_time', params: {}, scope: 'all' },
  { id: 'weather', label: '🌤 Weather', prompt: 'What is the weather right now?', tool: 'get_weather', params: {}, scope: 'all' },
  { id: 'search', label: '🔍 Search', prompt: 'Search for the latest AI news.', tool: 'web_search', params: { query: 'latest AI news' }, scope: 'all' },
  { id: 'system', label: '💻 System', prompt: 'Give me a system status report.', tool: 'get_system_info', params: {}, scope: 'host' },
  { id: 'screenshot', label: '📸 Screenshot', prompt: 'Take a screenshot.', tool: 'take_screenshot', params: {}, scope: 'mac' },
  { id: 'lock', label: '🔒 Lock', prompt: 'Lock the Mac screen.', tool: 'lock_screen', params: {}, scope: 'mac' },
  { id: 'clipboard', label: '📋 Clipboard', prompt: 'Read the Mac clipboard.', tool: 'get_clipboard', params: {}, scope: 'mac' },
  { id: 'browser', label: '🌐 Browser', prompt: 'Open the GhostForge dashboard in the browser.', tool: 'open_url', params: { url: 'http://localhost:3001/dashboard' }, scope: 'host' },
  { id: 'models', label: '🧠 Models', prompt: 'List installed local models.', tool: 'list_local_models', params: {}, scope: 'host' },
  { id: 'screen_understand', label: '👁 Understand Screen', prompt: 'What do you see on this screen? Describe the UI elements.', tool: 'understand_screen', params: {}, scope: 'mac' },
  { id: 'find_button', label: '🔎 Find Button', prompt: 'Find a clickable button or link on the screen.', tool: 'find_element', params: { description: 'button' }, scope: 'mac' },
  { id: 'read_screen_text', label: '📖 Read Screen', prompt: 'Read all the text visible on screen.', tool: 'read_text_on_screen', params: {}, scope: 'mac' },
]

const TERMINAL_FEATURE_GROUPS = [
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

function getJarvisQuickAction(id) {
  return JARVIS_QUICK_ACTIONS.find(action => action.id === id) || null
}

module.exports = { JARVIS_QUICK_ACTIONS, TERMINAL_FEATURE_GROUPS, getJarvisQuickAction }
