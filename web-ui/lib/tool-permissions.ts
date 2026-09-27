/**
 * Maps JARVIS tool names to permission keys so non-admin users are gated.
 * Admin users implicitly pass all checks (see lib/auth.hasPermission).
 */

export const TOOL_PERMISSION: Record<string, string> = {
  // ── search & info ─────────────────────────────────────────────────────────
  get_time: 'chat',
  get_weather: 'weather',
  web_search: 'web_search',
  google_search: 'web_search',

  // ── files ─────────────────────────────────────────────────────────────────────
  get_files: 'file_read',
  read_file: 'file_read',
  open_file: 'file_read',
  create_file: 'file_write',
  write_file: 'file_write',
  edit_file: 'file_write',
  delete_file: 'file_write',
  file_processor: 'file_process',
  office_document: 'documents',
  career: 'career',
  job_hunter: 'job_hunter',
  read_text_on_screen: 'file_read',

  // ── messaging ────────────────────────────────────────────────────────────────
  send_imessage: 'send_message',
  send_message: 'send_message',
  send_user_message: 'user_message',
  email_list: 'email',
  email_send: 'email',
  email_read: 'email',
  email_reply: 'email',
  email_search: 'email',
  email_unread_count: 'email',
  email_mark_read: 'email',
  email_star: 'email',
  email_delete: 'email',

  // ── system & mac control ─────────────────────────────────────────────────────
  get_system_info: 'system_info',
  hardware_monitor: 'system_info',
  mac_control: 'mac_control',
  terminal_command: 'terminal',
  run_terminal: 'terminal',
  lock_screen: 'admin_tools',
  set_volume: 'admin_tools',
  system_control: 'admin_tools',
  open_app: 'mac_control',
  open_url: 'mac_control',
  browser_control: 'browser',
  browser_automate: 'browser',
  take_screenshot: 'screenshots',
  describe_screen: 'screenshots',
  understand_screen: 'screenshots',

  // ── productivity ─────────────────────────────────────────────────────────────
  set_reminder: 'reminders',
  reminder: 'reminders',
  calendar_events: 'calendar',
  calendar_free_slots: 'calendar',
  contacts_search: 'contacts',
  github_repos: 'github',
  youtube_control: 'youtube',
  game_manager: 'game_manager',
  clipboard_analyze: 'clipboard',
  n8n_workflow: 'n8n',

  // ── AI ───────────────────────────────────────────────────────────────────────
  llmfit_recommend: 'ai_models',
  list_local_models: 'ai_models',
  install_model: 'ai_models',
  copilot_ask: 'copilot',
  ai_studio_list: 'ai_studio',
  ai_studio_update: 'ai_studio',
  ai_studio_test: 'ai_studio',
  ai_studio_compare: 'ai_studio',
  ai_studio_models: 'ai_studio',
  execute_code: 'code_helper',
  code_helper: 'code_helper',
  flight_finder: 'web_search',
  remote: 'remote',

  // ── voice / memory / MCP / native ───────────────────────────────────────────
  voice_status: 'voice',
  voice_tts: 'voice',
  memory_remember: 'semantic_memory',
  memory_recall: 'semantic_memory',
  memory_stats: 'semantic_memory',
  mcp_call: 'mcp',
  mcp_status: 'mcp',
  native_desktop: 'native_desktop',
}

export function permissionForTool(tool: string): string | undefined {
  return TOOL_PERMISSION[tool]
}

/** Default permission allowed to all signed-in users (chat is the baseline) */
export const CHAT_BASELINE_PERMISSION = 'chat'