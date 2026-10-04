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
  // NOTE: the vendored Mark-LIV `file_controller` *actions* (create_file,
  // write_file, edit_file, delete_file) are reached through the `mark_liv`
  // tool, not as top-level JARVIS tools — don't list them here or the gate
  // advertises tools the executor can't dispatch. File writes go through
  // /api/files, which checks file_write directly.
  get_files: 'file_read',
  read_file: 'file_read',
  open_file: 'file_read',
  file_processor: 'file_process',
  office_document: 'documents',
  career: 'career',
  job_hunter: 'job_hunter',
  // 'workflows' isn't a real permission key — the catalog calls this 'n8n' (see permissions.ts)
  workflow: 'n8n',
  read_text_on_screen: 'file_read',

  // ── messaging ────────────────────────────────────────────────────────────────
  send_message: 'send_message',
  send_imessage: 'send_message',
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

  // ── voice / memory / MCP / native ───────────────────────────────────────────
  voice_status: 'voice',
  voice_tts: 'voice',
  memory_remember: 'semantic_memory',
  memory_recall: 'semantic_memory',
  memory_stats: 'semantic_memory',
  mcp_call: 'mcp',
  mcp_status: 'mcp',
  native_desktop: 'native_desktop',

  // ── computer control (keyboard / mouse / windows) — same risk class as mac_control ──
  type_text: 'mac_control',
  key_combo: 'mac_control',
  mouse_click: 'mac_control',
  mouse_move: 'mac_control',
  drag_mouse: 'mac_control',
  scroll: 'mac_control',
  point_cursor: 'mac_control',
  find_and_click: 'mac_control',
  highlight_area: 'mac_control',
  focus_window: 'mac_control',
  get_windows: 'mac_control',
  get_frontmost_app: 'mac_control',
  play_music: 'mac_control',
  // Mark-LIV is the full computer-control bridge on Windows/Linux — gate like mac_control
  mark_liv: 'mac_control',

  // ── screen / vision ──────────────────────────────────────────────────────────
  get_screen_info: 'screenshots',
  find_element: 'screenshots',

  // ── code execution ───────────────────────────────────────────────────────────
  open_interpreter: 'code_helper',
  jsrepl_run: 'code_helper',

  // ── system administration ────────────────────────────────────────────────────
  mac_cleanup: 'admin_tools',
  install_on_device: 'admin_tools',
  setup_wizard: 'admin_tools',
  delegate_agent: 'admin_tools',

  // ── external messaging (server-configured channels) ──────────────────────────
  discord_message: 'send_message',
  send_slack_message: 'send_message',
  send_teams_message: 'send_message',
  send_whatsapp_message: 'send_message',

  // ── GitHub (server token) ────────────────────────────────────────────────────
  github_prs: 'github',
  github_issues: 'github',

  // ── clipboard / notes / contacts / vault ─────────────────────────────────────
  get_clipboard: 'clipboard',
  copy_to_clipboard: 'clipboard',
  write_note: 'file_write',
  apply_design_md: 'file_write',
  contacts_by_phone: 'contacts',
  vault_save: 'semantic_memory',

  // ── security scanners (run scans/commands) ───────────────────────────────────
  vigolium_scan: 'terminal',
  vigolium_agent: 'terminal',

  // ── productivity / info helpers ──────────────────────────────────────────────
  set_goal: 'reminders',
  list_goals: 'reminders',
  web_search_deep: 'web_search',
  list_design_md: 'chat',
  design_resources: 'chat',
  task_steps: 'chat',

  // ── team orchestration ───────────────────────────────────────────────────────
  agent_team: 'admin_tools',
}

export function permissionForTool(tool: string): string | undefined {
  // Own-property lookup: an inherited key like 'toString' or 'constructor' is
  // not a tool, and returning Object.prototype members would hand the caller a
  // non-string permission that silently fails every permission check.
  return Object.prototype.hasOwnProperty.call(TOOL_PERMISSION, tool)
    ? TOOL_PERMISSION[tool]
    : undefined
}

/** Default permission allowed to all signed-in users (chat is the baseline) */
export const CHAT_BASELINE_PERMISSION = 'chat'