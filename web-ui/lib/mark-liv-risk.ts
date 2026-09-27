/**
 * Which Mark-LIV actions need a spoken/typed "confirm" before JARVIS runs them.
 * Opening apps, typing, clicking, searching and screenshots run immediately;
 * anything that deletes/moves files, sends messages, runs code, changes the
 * network or powers the machine down asks first.
 */
const RISKY_SETTINGS = new Set(['restart', 'shutdown', 'toggle_wifi', 'close_app'])
const RISKY_FILE_ACTIONS = new Set(['delete', 'move', 'rename'])
const RISKY_DESKTOP_ACTIONS = new Set(['organize', 'clean'])
const RISKY_CODE_ACTIONS = new Set(['run', 'build', 'auto'])
const RISKY_GAME_ACTIONS = new Set(['install', 'update', 'schedule'])

/**
 * Read a JARVIS `mark_liv` tool call: { tool, args } where args is a JSON
 * string (or object), plus any flat params the model put alongside.
 */
export function parseMarkLivCall(params: Record<string, unknown>): { name: string; parameters: Record<string, unknown> } {
  const name = String(params.tool ?? params.id ?? '').trim()
  let args: Record<string, unknown> = {}
  if (typeof params.args === 'string' && params.args.trim()) {
    try {
      const parsed = JSON.parse(params.args)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
    } catch { /* not JSON — ignore, flat params still apply */ }
  } else if (params.args && typeof params.args === 'object') {
    args = params.args as Record<string, unknown>
  }
  const flat = Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'tool' && k !== 'id' && k !== 'args'))
  return { name, parameters: { ...flat, ...args } }
}

/**
 * JARVIS's macOS tools, translated to the equivalent Mark-LIV action so the
 * same requests work on Windows/Linux. Returns null for tools with no mapping.
 */
export function macToolToMarkLiv(tool: string, p: Record<string, string>): { name: string; parameters: Record<string, unknown> } | null {
  switch (tool) {
    case 'open_app': return { name: 'open_app', parameters: { app_name: p.app || p.app_name || '' } }
    case 'set_volume': return { name: 'computer_settings', parameters: { action: 'volume_set', value: p.level || p.text || '50' } }
    case 'type_text': return { name: 'computer_control', parameters: { action: 'type', text: p.text || '' } }
    case 'mouse_click': {
      const action = p.button === 'right' ? 'right_click' : p.button === 'double' ? 'double_click' : 'click'
      return { name: 'computer_control', parameters: { action, x: Number(p.x), y: Number(p.y) } }
    }
    case 'key_combo': return { name: 'computer_control', parameters: { action: 'hotkey', keys: p.keys || '' } }
    case 'scroll': return { name: 'computer_control', parameters: { action: 'scroll', direction: p.direction || 'down', amount: Number(p.amount || 3) } }
    case 'take_screenshot': return { name: 'computer_settings', parameters: { action: 'screenshot' } }
    case 'lock_screen': return { name: 'computer_settings', parameters: { action: 'lock_screen' } }
    case 'play_music': return { name: 'youtube_video', parameters: { action: 'play', query: p.query || p.command || p.app || '' } }
    case 'youtube_control': return { name: 'youtube_video', parameters: { action: p.action || 'play', query: p.query || '', url: p.url || '' } }
    case 'send_whatsapp_message': return { name: 'send_message', parameters: { receiver: p.contact || '', message_text: p.message || '', platform: 'WhatsApp' } }
    default: return null
  }
}

/** Returns the reason a confirmation is needed, or null when the action is safe to run */
export function markLivRisk(tool: string, parameters: Record<string, unknown>): string | null {
  const action = String(parameters.action ?? '').toLowerCase().trim()
  switch (tool) {
    case 'send_message':
      return 'Sends a message on your behalf'
    case 'dev_agent':
      return 'Writes and runs code on this computer'
    case 'code_helper':
      return RISKY_CODE_ACTIONS.has(action || 'auto') ? 'May run code on this computer' : null
    case 'file_controller':
      return RISKY_FILE_ACTIONS.has(action) ? `Will ${action} files` : null
    case 'desktop_control':
      return RISKY_DESKTOP_ACTIONS.has(action) ? `Will ${action} files on your desktop` : null
    case 'computer_settings':
      return RISKY_SETTINGS.has(action) ? `System action: ${action.replace('_', ' ')}` : null
    case 'game_updater':
      return RISKY_GAME_ACTIONS.has(action) || parameters.shutdown_when_done ? 'Downloads/installs software' : null
    default:
      return null
  }
}
