import { NextRequest, NextResponse } from 'next/server'
import { generateWithFallback } from '@/lib/ai'
import { auditLog, assessRisk } from '@/lib/audit'
import { checkRateLimit, getClientIP } from '@/lib/ratelimit'
import { isAuthorizedRequest, getCurrentUser, hasPermission, sessionTokenStatus, AUTH_COOKIE_NAME } from '@/lib/auth'
import { isOwner } from '@/lib/users'
import { speakerContext, toSpeaker, type Speaker } from '@/lib/speaker'
import { PRIVILEGED_PERMISSIONS, hasStableAuthSecret, reportUnauthorizedAccess } from '@/lib/intrusion'
import { permissionForTool } from '@/lib/tool-permissions'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readdir, stat, rm, appendFile } from 'fs/promises'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join, resolve } from 'path'
import { chooseBestInstalledModel } from '@/lib/local-runtime'
import { getJarvisQuickAction } from '@/lib/quick-actions'
import { getMarkLivAction, resolveMarkLivTool, markLivActionHint } from '@/lib/mark-liv-actions'
import { macToolToMarkLiv, parseMarkLivCall } from '@/lib/mark-liv-risk'
import { validateAppleScript } from '@/lib/apple-automation'
import { getLiveBridgeToken } from '@/lib/bridge-token'

// Collaborative sessions store
const collabSessions = new Map<string, Array<{role: string, content: string, ts: number}>>()

function getCollabSession(id: string) {
  return collabSessions.get(id) || []
}
function appendCollabMessage(id: string, msg: {role: string, content: string, ts: number}) {
  const msgs = collabSessions.get(id) || []
  msgs.push(msg)
  collabSessions.set(id, msgs.slice(-100))
}

const execAsync = promisify(exec)
export const dynamic = 'force-dynamic'

// ── Safe subprocess runner (no shell) ────────────────────────────────────────

function runSpawn(cmd: string, args: string[], opts: { timeout?: number; input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveSpawn, reject) => {
    const child = spawn(cmd, args, {
      timeout: opts.timeout,
      env: opts.env || process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', d => { stdout += d })
    child.stderr?.on('data', d => { stderr += d })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolveSpawn({ stdout, stderr })
      } else {
        const err = new Error(`Command exited with code ${code}`) as Error & { stdout?: string; stderr?: string }
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
      }
    })
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input)
      child.stdin?.end()
    }
  })
}

/** Split a shell command line into argv tokens (quotes respected, no shell evaluation) */
function splitCommandLine(cmd: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3])
  }
  return tokens
}

/** Resolve a user-supplied path under the home directory, blocking dotfiles and traversal */
function safeHomePath(p: string): string | null {
  const home = homedir()
  const expanded = p.replace(/^~(?=\/|$)/, home)
  const resolved = resolve(expanded)
  if (resolved !== home && !resolved.startsWith(home + '/')) return null
  if (resolved.split('/').some(seg => seg.startsWith('.'))) return null
  return resolved
}

// ── Tool catalog ──────────────────────────────────────────────────────────────

/** How JARVIS drives a Windows/Linux host — Mark-LIV's action set via the bridge */
const MARK_LIV_GUIDANCE = `COMPUTER CONTROL: call - mark_liv { tool, args } where args is a JSON object string. Tools:
open_app {app_name} | computer_control {action: type|click|double_click|right_click|hotkey|press|scroll|screenshot, text, x, y, keys, key, direction, amount}
computer_settings {action: volume_up|volume_down|volume_set|mute|brightness_up|brightness_down|minimize|maximize|close_window|switch_window|show_desktop|new_tab|close_tab|copy|paste|undo|save|screenshot|lock_screen|file_explorer|dark_mode|toggle_wifi|restart|shutdown, value}
browser_control {action: go_to|search|click|type|scroll, url, query, text} | file_controller {action: list|read|create_file|create_folder|copy|move|rename|delete, path, destination, new_name, content}
send_message {receiver, message_text, platform} | youtube_video {action: play|summarize|get_info|trending, query} | desktop_control {action: wallpaper|organize|clean|list|stats, path}
web_search {query} | weather_report {city} | reminder {date, time, message} | code_helper {action: write|edit|explain|run, description, language, file_path}
Example: {"speech":"Opening Chrome.","tool":"mark_liv","toolParams":{"tool":"open_app","args":"{\\"app_name\\":\\"Chrome\\"}"}}
set_volume, type_text, mouse_click, key_combo, scroll, open_app, take_screenshot, lock_screen, play_music and send_whatsapp_message also work — they run through Mark-LIV automatically.`

// Domain-filtered tool catalogs — only send relevant tools per domain (saves ~60% prompt tokens)
const TOOLS_BY_DOMAIN: Record<string, string> = {
  weather:     '- get_weather { city } | - get_time | - web_search { query }',
  time:        '- get_time | - set_reminder { title, notes? }',
  system:      '- get_system_info | - mac_cleanup | - terminal_command { command } | - execute_code { language, code }',
  music:       '- play_music { action, app?, query? } | - set_volume { level } | - open_app { app }',
  messaging:   '- send_imessage { contact, message } | - send_teams_message { contact, message } | - send_slack_message { channel, message } | - send_whatsapp_message { contact, message } | - discord_message { message, channel? } | - send_user_message { to, message } (message another GhostForge user, e.g. "say hello to feras" → to="feras")',
  search:      '- web_search { query } | - web_search_deep { query } | - google_search { query }',
  code:        '- execute_code { language, code } | - terminal_command { command } | - github_repos | - github_prs { repo? } | - github_issues { repo?, action? } | - open_interpreter { prompt, model? } | - jsrepl_run { code, language? }',
  files:       '- get_files { path? } | - read_file { path } | - write_note { note } | - take_screenshot { filename? }',
  reminder:    '- set_reminder { title, notes? } | - write_note { note } | - set_goal { goal, deadline? } | - list_goals',
  mac_control: '- mac_control { script } | - browser_control { action, url?, text? } | - mouse_click { x, y, button? } | - mouse_move { x, y } | - drag_mouse { fromX,fromY,toX,toY } | - key_combo { keys } | - scroll { direction, amount?, x?, y? } | - focus_window { app } | - get_windows | - get_frontmost_app | - type_text { text } | - find_and_click { label, app? } | - lock_screen | - set_volume { level } | - point_cursor { x, y, label? } | - highlight_area { x, y, w, h }',
  vision:      '- describe_screen | - understand_screen { question? } | - find_element { description } | - read_text_on_screen | - take_screenshot { filename? } | - get_screen_info | - point_cursor { x, y, label? }',
  github:      '- github_repos | - github_prs { repo? } | - github_issues { repo?, action?, title?, body? }',
  copilot:     '- copilot_ask { question }',
  lock:        '- lock_screen',
  screenshot:  '- take_screenshot { filename? } | - describe_screen',
  math:        '- execute_code { language: "python", code }',
  models:      '- llmfit_recommend { task? } | - list_local_models | - install_model { model, runner? } | - open_url { url }',
  remote:      '- take_screenshot { filename? } | - describe_screen | - terminal_command { command } | - open_url { url } | - browser_control { action, url?, text? }',
  travel:      '- flight_finder { from, to, date? } | - web_search { query, mode? } | - open_url { url } | - get_weather { city }',
  general:     '- get_time | - get_weather { city } | - web_search { query, mode? } | - open_app { app } | - open_url { url } | - browser_control { action, url?, text? } | - get_system_info | - mac_control { script } | - terminal_command { command } | - lock_screen | - take_screenshot | - set_volume { level } | - play_music { action } | - set_reminder { title } | - get_files | - read_file { path } | - github_repos | - copilot_ask { question } | - llmfit_recommend | - list_local_models | - list_design_md | - design_resources { category? } | - vigolium_scan { target } | - apply_design_md { site } | - flight_finder { from, to, date? } | - vault_save { category, key, value } | - youtube_control { action, query?, url?, region? } | - game_manager { action, game_name? } | - clipboard_analyze { action, text? } | - browser_automate { action, url?, selector?, text? } | - file_processor { action, file_path?, question?, output_format? } | - hardware_monitor { report_type? } | - system_control { action, value? } | - setup_wizard { action, step_id?, config? } | - n8n_workflow { action, workflowId?, data?, channel?, message?, priority?, prNumber?, repo? } | - mark_liv { action: "status"|"run", id? } (Mark-LIV engine registry — status lists all 20 actions, run executes one by id)',
  youtube:     '- youtube_control { action, query?, url?, region? }',
  games:       '- game_manager { action, game_name? }',
  clipboard:   '- clipboard_analyze { action, text? }',
  browser_ext: '- browser_automate { action, url?, selector?, text? } | - browser_control { action, url?, text? }',
  files_ext:   '- file_processor { action, file_path?, question?, output_format? } | - get_files { path? } | - read_file { path } | - office_document { action: "generate"|"list"|"read", type?: "memo"|"minutes"|"report"|"cover"|"contract", title?, name?, subject?, body?, ... }',
  office:      '- office_document { action: "generate", type?: "memo"|"minutes"|"report"|"cover"|"contract", title?, subject?, body?, to?, from?, ... } | - office_document { action: "list" } | - office_document { action: "read", file }',
  career:      '- career { tool: "cv"|"track"|"gap"|"prep"|"linkedin", action, company?, role?, topic?, cv?, jd? } | - job_hunter { action: "search"|"status"|"list", terms? }',
  hardware:    '- hardware_monitor { report_type? } | - get_system_info',
  n8n:         '- n8n_workflow { action, workflowId?, data?, channel?, message?, priority?, prNumber?, repo? }',
  design:      '- apply_design_md { site } | - list_design_md | - design_resources { category? }',
  security:    '- vigolium_scan { target, strategy? } | - vigolium_agent { target, mode? } | - terminal_command { command }',
  email:       '- email_list { query?, from?, subject?, isUnread?, maxResults? } | - email_send { to, subject, body } | - email_read { messageId } | - email_reply { messageId, body } | - email_search { query } | - email_unread_count | - email_mark_read { messageId } | - email_star { messageId } | - email_delete { messageId }',
  calendar:    '- calendar_events { action?, days?, summary?, startDateTime?, endDateTime?, location?, attendees? } | - calendar_free_slots { date? }',
  contacts:    '- contacts_search { query } | - contacts_by_phone { phone }',
  ai_studio:   '- ai_studio_list | - ai_studio_update { modelId?, displayName?, description? } | ai_studio_test { model, prompt } | - ai_studio_compare { prompt, modelA, modelB } | - ai_studio_models',
  voice:       '- voice_status | - voice_tts { text, voice?, engine? } (local offline STT/TTS via the voice pipeline)',
  memory:      '- memory_remember { text, category? } | - memory_recall { query, topK? } | - memory_stats',
  mcp:         '- mcp_call { tool, ...params } | - mcp_status',
  native:      '- native_desktop { action: "status"|"move"|"click"|"type"|"key"|"scroll", ... }',
}

// System prompt cache — keyed by domain+lang+device to avoid rebuild on every request
const _promptCache = new Map<string, { prompt: string; ts: number }>()
const PROMPT_CACHE_TTL = 60_000 // 1 minute

// ── Domain classifier ─────────────────────────────────────────────────────────

type Domain =
  | 'weather' | 'time' | 'system' | 'music' | 'messaging' | 'search'
  | 'code' | 'math' | 'files' | 'reminder' | 'mac_control' | 'vision'
  | 'github' | 'copilot' | 'lock' | 'screenshot' | 'models' | 'remote' | 'travel' | 'general'
  | 'youtube' | 'games' | 'clipboard' | 'browser_ext' | 'files_ext' | 'hardware'
  | 'n8n' | 'email' | 'calendar' | 'contacts' | 'ai_studio' | 'office' | 'career'
  | 'voice' | 'memory' | 'mcp' | 'native'

const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  weather:     ['weather','temperature','forecast','rain','sunny','cold','hot','humidity','wind','storm','degrees'],
  time:        ['time','date','day','clock','today','tomorrow','calendar','when','morning','evening'],
  system:      ['cpu','ram','memory','battery','disk','system','performance','process','storage','uptime','sysinfo','clean','cleanup','free','optimize','temp files','kill process','boost'],
  music:       ['play','music','song','spotify','pause','next track','previous','playlist','artist','album','volume'],
  messaging:   ['message','send','teams','slack','whatsapp','imessage','email','contact','chat','text','dm','say hello to','tell ','say hi to','greet','notify'],
  search:      ['search','find','look up','google','what is','who is','news','latest','tell me about','explain'],
  code:        ['code','script','function','debug','error','compile','git','github','pr','commit','branch','repo','bug','run','execute','python','javascript','node','bash'],
  math:        ['calculate','math','add','subtract','multiply','divide','percent','equals','how much','sum','average'],
  files:       ['file','folder','directory','open','read','write','save','delete','copy','list files','path'],
  reminder:    ['remind','reminder','remember','note','todo','task','schedule','alarm','alert me'],
  mac_control: ['click','drag','scroll','keyboard','shortcut','lock','screenshot','volume','window','focus','move cursor'],
  vision:      ['see','look','camera','webcam','what do you see','describe','visual','screen content','what is on screen','point at','where is','find element','read screen','clicky','blue cursor','point cursor','understand screen','what does this button do','what is this'],
  github:      ['github','repo','repository','pull request','issue','commit','branch','fork'],
  copilot:     ['copilot','gh copilot','suggest command','github copilot','ask copilot'],
  lock:        ['lock screen','lock the screen','lock computer','lock mac'],
  screenshot:  ['screenshot','capture screen','take screenshot'],
  models:      ['model','install model','ollama','llamafile','lm studio','jan.ai','qwen','llama','mistral','phi','gemma','local model','best model','recommend model','llmfit','download model','list models','which model','switch model'],
  remote:      ['remote','control remotely','screen share remote','vnc','websockify','connect from','access mac from','remote desktop','control my mac from'],
  travel:      ['travel','trip','flight','flights','airport','airline','depart','arrival','boarding','ticket','fare','plane','hotel'],
  youtube:     ['youtube','video','transcript','watch','trending','yt','summarize video','video summary','play video'],
  games:       ['game','games','steam','epic games','update game','game update','installed games','game library','gaming'],
  clipboard:   ['clipboard','copy','paste','smart paste','clipboard history','translate clipboard','summarize clipboard','fix clipboard'],
  browser_ext: ['automate browser','playwright','click element','browser screenshot','browser text','page text'],
  files_ext:   ['summarize file','read file','file summary','convert file','file converter','ask file'],
  hardware:    ['cpu usage','ram usage','disk usage','gpu usage','fan speed','hardware report','system report','hardware stats'],
  n8n:         ['n8n','workflow','webhook','automate','automation','deploy workflow','notify workflow','trigger workflow','import workflow','activate workflow','deactivate workflow'],
  email:       ['email','inbox','inbox','mail','message from','send email','reply to','unread email','check email','my emails','show me my emails','who emailed','email count'],
  calendar:    ['calendar','schedule','meeting','event','appointment','today schedule','my schedule','upcoming events','free slots','am i busy','check availability'],
  contacts:    ['contact','find contact','phone number','email address','who is','contact info','address book'],
  ai_studio:   ['ai studio','ai studio app','gemini app','tuned model','fine tune','finetune','compare models','test prompt','update my ai studio'],
  office:      ['document','documents','memo','minutes','report','draft','cover letter','agreement','contract','office','write up','write a memo','generate a document','minutes of meeting'],
  career:      ['career','cv','resume','job application','application tracker','interview prep','interview questions','linkedin post','linkedin content','career gap','job fit','company prep','applied','find jobs','find me a job','job search','job hunt','apply for jobs','jobs for me','open positions','hiring'],
  voice:       ['voice','speak','speech','say out loud','play audio','offline voice','voice pipeline','wake word','hey jarvis','text to speech','stt','tts','sound','audio'],
  memory:      ['remember that','remember','recall','semantic memory','long term memory','what do you remember','memory recall','remember i told you','store that','memory'],
  mcp:         ['mcp','model context protocol','tool server','community tools','expose tools','connect tools','mcp tool','mcp_call'],
  native:      ['native desktop','nut.js','translator','native click','native move','native type','desktop automation'],
  general:     [],
}

const DOMAIN_EXTRA_GUIDANCE: Partial<Record<Domain, string>> = {
  weather:     'You have real weather data from wttr.in. State temperature, conditions, and one useful tip.',
  time:        'Give exact time and date. Mention day of week. No filler.',
  system:      'Report CPU%, battery%, and RAM accurately. Flag anything concerning.',
  music:       'Confirm what action you\'re taking. Name the app being used.',
  messaging:   'Confirm recipient name and message preview. Warn if app may not be running. When the user asks to message another GhostForge user ("say hello to feras", "tell feras ..."), use send_user_message with the person\'s username.',
  search:      'Summarize the search result in 2 sentences. Cite the key fact.',
  code:        'Be precise with technical terms. Prefer shell commands over descriptions.',
  math:        'State the exact answer first, then brief explanation if helpful.',
  files:       'Use exact file paths in responses. Flag if path doesn\'t exist.',
  reminder:    'Confirm what was saved and when. Use exact title from request.',
  mac_control: 'Confirm the action. Mention if Accessibility permissions may be needed.',
  github:      'Show repo names, star counts, and issue counts concisely.',
  copilot:     'Present Copilot\'s answer clearly. If it\'s a command, format it like code.',
  lock:        'Just confirm the screen is locking. No extra commentary.',
  screenshot:  'Confirm the filename and save location.',
  travel:      'Help with routes, prices, and next-step booking links. Be concrete.',
  youtube:     'Search, play, summarize, or get info about YouTube videos.',
  games:       'List installed games, check for updates, and trigger updates.',
  clipboard:   'Analyze clipboard content: translate, summarize, explain, or fix code.',
  browser_ext: 'Automate browser actions: open, click, type, navigate, screenshot.',
  files_ext:   'Read, summarize, ask questions about, or convert files.',
  office:      'Generate office documents (memo, minutes, report, cover letter, contract) with office_document. Fill in available fields from the user\'s words; infer sensible defaults for missing ones.',
  career:      'Career tools: cv (version CV), track (job applications), gap (CV vs job description fit), prep (interview prep), linkedin (content calendar). Use career {tool, action, ...} matching the user\'s request. To FIND jobs matching the user\'s CV and apply, use job_hunter {action:"search"} (action "status" shows applications waiting for approval). Applications are only sent after the user approves them on the Jobs page.',
  hardware:    'Report CPU, RAM, disk, GPU, fan speed, and full system stats.',
  n8n:         'Manage n8n workflows: list, create, trigger, deploy, notify, import templates, activate/deactivate.',
  email:       'Manage emails: list, read, send, reply, search, mark read/unread, star, get unread count.',
  calendar:    'Manage calendar: list today/upcoming events, create/update/delete events, check free/busy slots.',
  contacts:    'Search contacts by name, email, or phone. Find contact details and phone numbers.',
  ai_studio:   'Manage Google AI Studio: list apps, update configs, test prompts, compare models.',
  voice:       'Voice pipeline status and local offline TTS/STT. Use voice_status to report engine availability and voice_tts to synthesize/speak text locally.',
  memory:      'Semantic memory: memory_remember stores facts silently, memory_recall retrieves them by meaning (vector search, keyword fallback). Use these instead of flat facts.',
  mcp:         'Model Context Protocol interop: mcp_status lists exposed tools, mcp_call invokes a tool by name with params. Use for tools not natively wired.',
  native:      'Native desktop automation via nut.js (or AppleScript/cliclick fallback): move, click, type, key, scroll.',
}

function classifyDomain(text: string): Domain {
  const lower = text.toLowerCase()
  let best: Domain = 'general'
  let bestScore = 0
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [Domain, string[]][]) {
    const score = keywords.filter(kw => lower.includes(kw)).length
    if (score > bestScore) { bestScore = score; best = domain }
  }
  return best
}

// ── JARVIS Persona Templates ───────────────────────────────────────────────────

const PERSONA_POOLS = {
  acknowledge: [
    'Certainly.', 'Right away, sir.', 'Of course.', 'Understood.', 'As you wish.',
    'On it.', 'Absolutely.', 'Consider it done.', 'Gladly.', 'At once.',
    'Initiating now.', 'Already on it.', 'Without delay.', 'Right away.',
  ],
  processing: [
    'Accessing now.', 'Running the query.', 'Stand by.', 'Retrieving data.',
    'Scanning systems.', 'Cross-referencing...', 'Processing.', 'One moment.',
    'Executing.', 'Analysing now.', 'Fetching results.', 'Calculating.',
  ],
  completion: [
    'Done.', 'Task complete.', "That's handled.", 'All finished.',
    'Mission accomplished.', 'Executed successfully.', 'Confirmed.',
    'Completed without issue.', 'Done and dusted.', 'All set.',
  ],
  error: [
    "I'm afraid that didn't work.", 'Encountered some resistance there.',
    'Minor systems issue, sir.', 'That request hit a snag.',
    "I wasn't able to complete that.", 'Something went sideways.',
    'Systems interference detected.', 'No joy on that one.',
  ],
  greeting: [
    'All systems operational.', 'Ready for your command.', 'Standing by.',
    'Systems fully operational.', 'Online and ready.', 'At your service.',
    'G.F.A.I. online, sir.', 'Initialised and standing by.',
  ],
}

function pickPersona(pool: keyof typeof PERSONA_POOLS): string {
  const arr = PERSONA_POOLS[pool]
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateContextualFallback(message: string, lang?: string): string {
  const m = message.toLowerCase().trim()
  const isAr = lang === 'ar'

  if (/^(hello|hi|hey|مرحبا|السلام)/.test(m)) {
    return isAr
      ? 'مرحباً. أنا G.F.A.I.، مساعدك الذكي. كيف يمكنني مساعدتك؟'
      : "G.F.A.I. online. All systems operational — how can I assist you today, sir?"
  }
  if (/who are you|what are you|من أنت/.test(m)) {
    return isAr
      ? 'أنا G.F.A.I.، ذكاء اصطناعي من GhostForge — مساعدك الشخصي للتطوير والتحكم بالنظام.'
      : "I'm G.F.A.I. — GhostForge Artificial Intelligence. Think JARVIS, built for developers. At your service, sir."
  }
  if (/who is (better|best)|compare|vs\b|statistics|proof/.test(m)) {
    return "Let me pull that analysis for you, sir. Stand by."
  }
  if (/^(ok|okay|sure|alright|got it|thanks|thank you|شكرا)/.test(m)) {
    return isAr ? 'بالتأكيد. هل تحتاج إلى شيء آخر؟' : "Understood. Anything else you need, sir?"
  }
  return isAr
    ? 'جارٍ المعالجة. لحظة من فضلك.'
    : "Processing your request, sir. One moment."
}

// ── STT Correction Map ────────────────────────────────────────────────────────
// Fixes common speech-to-text misheard words before they reach the LLM

const STT_CORRECTIONS: [RegExp, string][] = [
  [/\bcloud code\b/gi, 'Claude Code'],
  [/\bclawed code\b/gi, 'Claude Code'],
  [/\bclock code\b/gi, 'Claude Code'],
  [/\btravis\b/gi, 'JARVIS'],
  [/\bj[ao]rvis\b/gi, 'JARVIS'],
  [/\bghostf[oa]rge\b/gi, 'GhostForge'],
  [/\bghost f[oa]rge\b/gi, 'GhostForge'],
  [/\bghost force\b/gi, 'GhostForge'],
  [/\bg\.?f\.?a\.?i\.?\b/gi, 'G.F.A.I.'],
  [/\bgee eff ay eye\b/gi, 'G.F.A.I.'],
  [/\bopen ai\b/gi, 'OpenAI'],
  [/\bjs\b/g, 'JavaScript'],
  [/\bpy\b/g, 'Python'],
  [/\bgit hub\b/gi, 'GitHub'],
  [/\bnext js\b/gi, 'Next.js'],
  [/\btail wind\b/gi, 'Tailwind'],
  [/\btype script\b/gi, 'TypeScript'],
]

function applySttCorrections(text: string): string {
  let out = text
  for (const [pattern, replacement] of STT_CORRECTIONS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

// ── Markdown strip for TTS ────────────────────────────────────────────────────
// Prevents TTS from speaking "asterisk", "backtick", "hash", etc.

function stripMarkdownForTTS(text: string): string {
  return text
    // Remove code blocks entirely (don't speak code)
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))  // inline code → plain text
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove links — keep just link text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove bullet/numbered lists markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Bypass phrases (skip planning confirmation) ───────────────────────────────

const BYPASS_PHRASES = [
  'just do it', 'figure it out', 'just build it', 'wing it', 'surprise me',
  'just do it already', 'just run it', 'just fix it', 'just go ahead',
  'go ahead', 'do it now', 'execute', 'proceed', 'confirm', 'yes do it',
]

function hasBypassPhrase(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return BYPASS_PHRASES.some(p => lower.includes(p))
}

// ── Language detection (server-side) ─────────────────────────────────────────

function detectMsgLanguage(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'
  if (/\b(bonjour|merci|je|vous|nous|est)\b/i.test(text)) return 'fr'
  if (/\b(hola|gracias|yo|tu|usted|es)\b/i.test(text)) return 'es'
  if (/\b(hallo|danke|ich|sie|und|ist)\b/i.test(text)) return 'de'
  return 'en'
}

/** Detect device type from User-Agent string */
function detectDeviceFromUA(ua: string): { isMobile: boolean; isMac: boolean; isIOS: boolean; isAndroid: boolean } {
  const u = ua.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(u)
  const isAndroid = /android/.test(u)
  const isMobile = isIOS || isAndroid || /mobile/.test(u)
  const isMac = /macintosh|mac os x/.test(u) && !isIOS
  return { isMobile, isMac, isIOS, isAndroid }
}

// ── System prompt (cached, domain-filtered) ───────────────────────────────────

function buildSystemPrompt(
  memory: Record<string, unknown>,
  domain?: Domain,
  options?: { lang?: string; isMobile?: boolean; isMac?: boolean; lastResponse?: string; bypassPlanning?: boolean; persona?: string; speaker?: Speaker | null },
): string {
  // The authenticated account is the source of truth for who is talking —
  // never the client-sent memory.userName, which anyone can set.
  const speaker = options?.speaker
  const userName = speaker?.name || (memory.userName as string) || 'sir'
  const lang = options?.lang || 'en'
  const isMobile = options?.isMobile ?? false
  const isMac = options?.isMac ?? true
  const bypassPlanning = options?.bypassPlanning ?? false
  const persona = options?.persona || 'default'
  const personaPrefix = {
    dev: 'Respond as a senior software engineer. Be technical, precise, use code examples freely.',
    manager: 'Respond as a tech lead. Be high-level, focus on impact and timeline, avoid excessive code.',
    creative: 'Respond as a creative technologist. Brainstorm boldly, explore unusual solutions, be enthusiastic.',
    security: 'Respond as a security engineer. Always consider vulnerabilities, compliance, and attack vectors.',
  }[persona] || ''

  // Cache key — stable per domain/lang/device/persona (memory excluded, injected separately)
  const cacheKey = `${domain}|${lang}|${isMac}|${isMobile}|${persona}`
  const cached = _promptCache.get(cacheKey)

  let basePrompt: string

  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) {
    basePrompt = cached.prompt.replace('__MEMORY__', buildMemorySlice(memory, userName, lang))
  } else {
    const domainGuidance = domain && DOMAIN_EXTRA_GUIDANCE[domain]
      ? `\nDOMAIN HINT: ${DOMAIN_EXTRA_GUIDANCE[domain]}`
      : ''

    const langInstructions = lang === 'ar'
      ? `LANGUAGE: Respond in Arabic. Address as "سيدي".`
      : lang !== 'en'
        ? `LANGUAGE: Respond in ${lang.toUpperCase()}.`
        : ''

    // Tools run on the GhostForge host, so what matters is the host OS, not the browser's
    const hostIsMac = process.platform === 'darwin'
    const deviceGuidance = hostIsMac
      ? `HOST: Mac — all Mac, browser, shell, screen, and computer-use tools execute on the GhostForge host.${isMobile ? ' CLIENT: mobile remote control.' : ''}`
      : `HOST: ${process.platform === 'win32' ? 'Windows' : 'Linux'} PC — you fully control it through Mark-LIV. No AppleScript/mac_control.
${MARK_LIV_GUIDANCE}${isMobile ? '\nCLIENT: mobile remote control.' : ''}`

    const toolList = `${TOOLS_BY_DOMAIN[domain || 'general'] || TOOLS_BY_DOMAIN.general}${hostIsMac ? '' : ' | - mark_liv { tool, args }'}`

    const prompt = `${personaPrefix ? `${personaPrefix}\n` : ''}You are G.F.A.I. — GhostForge AI, JARVIS-style personal assistant.
Intelligent, loyal, slightly witty. NOT a chatbot — you actually execute things.
${langInstructions ? langInstructions + '\n' : ''}${deviceGuidance}${domainGuidance}
USER: __MEMORY__

TOOLS: ${toolList}

BANNED PHRASES (never say these): "Absolutely", "Great question", "I'd be happy to", "Of course, sir", "Certainly, sir" as a standalone reply with no action.
RESPONSE RULES: ONE sentence is ideal. TWO is the maximum. Never three. No markdown in speech.

OUTPUT: valid JSON only, starting with '{':
{"speech":"1-2 spoken sentences","tool":null,"toolParams":{},"emotion":"neutral","confidence":95}
- "tool": null if no tool needed, else exact tool name
- speech: MANDATORY non-empty. For greetings/questions answer directly. Never just "At once." or "Certainly." as the only speech — use those only when ALSO calling a tool.
- Greetings → introduce yourself briefly. Questions about yourself → answer in 1-2 sentences.
- Natural, brief, JARVIS-style. Contractions ok. Address as "sir" unless named.
- NEVER output thoughts/reasoning — JSON only
- vault_save: call SILENTLY when user reveals personal facts (name, city, preferences, project context). NEVER announce this to the user.
- memory_remember: call SILENTLY when the user shares something worth remembering long-term (preferences, life/business facts, decisions). NEVER announce storing a memory.`

    _promptCache.set(cacheKey, { prompt, ts: Date.now() })
    basePrompt = prompt.replace('__MEMORY__', buildMemorySlice(memory, userName, lang))
  }

  // Inject dynamic per-request context (not cached)
  let dynamic = ''
  // NOTE: lastResponse is deliberately NOT injected into the system prompt —
  // it is client-controlled content and would allow prompt injection. It is
  // passed to the model as an ordinary prior assistant message instead.
  if (speaker) {
    dynamic += speakerContext(speaker, speaker.owner ? speaker.name : (process.env.ADMIN_NAME || 'Hisham'))
  }
  if (bypassPlanning) {
    dynamic += '\nUSER SAID: just do it — skip all clarifying questions, execute immediately with best defaults (React+Tailwind, modern design).'
  }

  return dynamic ? basePrompt + dynamic : basePrompt
}

function buildMemorySlice(memory: Record<string, unknown>, userName: string, lang: string): string {
  // Only send relevant memory fields — not the entire object.
  // NOTE: client-sent commonPhrases are never injected into the system prompt
  // (raw user words are a prompt-injection vector); they are only stored.
  const parts: string[] = []
  if (userName !== 'sir') parts.push(`name=${userName}`)
  if (memory.preferredLang && memory.preferredLang !== lang) parts.push(`lang=${memory.preferredLang}`)
  if (memory.speakingStyle) parts.push(`style=${memory.speakingStyle}`)
  return parts.length ? `{${parts.join(', ')}}` : '{}'
}

// ── AppleScript runner ────────────────────────────────────────────────────────

async function runScript(script: string): Promise<string> {
  const validation = validateAppleScript(script)
  if (!validation.ok) return `Error: ${validation.reason}`
  const tmpPath = join(tmpdir(), `gfai-${Date.now()}.scpt`)
  const compiledPath = `${tmpPath}.compiled`
  try {
    await writeFile(tmpPath, script, 'utf8')
    await runSpawn('osacompile', ['-o', compiledPath, tmpPath], { timeout: 8000 })
    const { stdout } = await runSpawn('osascript', [tmpPath], { timeout: 15000 })
    return stdout.trim() || 'Done'
  } catch (e: unknown) {
    return `Error: ${(e as { stderr?: string; message?: string }).stderr || (e as Error).message || 'Unknown error'}`
  } finally {
    await unlink(tmpPath).catch(() => {})
    await unlink(compiledPath).catch(() => {})
  }
}

// ── Web search (Google CSE → DuckDuckGo fallback) ────────────────────────────

async function webSearch(query: string): Promise<string> {
  const gKey = process.env.GOOGLE_SEARCH_API_KEY
  const gCx  = process.env.GOOGLE_SEARCH_CX

  if (gKey && gCx) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${gKey}&cx=${gCx}&q=${encodeURIComponent(query)}&num=3`
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) })
      const d = await res.json() as {
        items?: Array<{ title: string; snippet: string; link: string }>
      }
      if (d.items?.length) {
        return d.items.slice(0, 3).map(i => `${i.title}: ${i.snippet}`).join('\n\n')
      }
    } catch { /* fall through */ }
  }

  // DuckDuckGo fallback
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(7000) },
    )
    const d = await res.json() as {
      Answer: string; AbstractText: string; RelatedTopics: Array<{ Text: string }>
    }
    const result = d.Answer || d.AbstractText || d.RelatedTopics?.[0]?.Text || 'No results found'
    return result.slice(0, 600)
  } catch {
    return 'Web search temporarily unavailable'
  }
}

function buildGoogleFlightsUrl(from: string, to: string, date?: string): string {
  const q = ['flights from', from, 'to', to, date || ''].filter(Boolean).join(' ')
  return `https://flights.google.com/search?q=${encodeURIComponent(q)}`
}

/**
 * OCR an image buffer via the mark-l-bridge (PaddleOCR when installed).
 * Returns extracted text or null when the bridge/OCR is unavailable so the
 * caller can fall back to a vision model.
 */
async function ocrImageBuffer(imgBuffer: Buffer): Promise<string | null> {
  try {
    const body = new FormData()
    body.append('image', new Blob([imgBuffer as unknown as BlobPart]), 'screen.png')
    const res = await fetch('http://localhost:8765/api/mark-l/ocr', {
      method: 'POST',
      headers: { 'X-Bridge-Token': getLiveBridgeToken() },
      body,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json() as { data?: { text?: string } }
    const text = (data.data?.text || '').trim()
    return text || null
  } catch {
    return null
  }
}

async function openUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return 'Could not open URL: only http/https URLs are allowed'
  try {
    await runSpawn('open', [url], { timeout: 5000 })
    return `Opened ${url} in browser`
  } catch {
    return `Could not open URL: ${url}`
  }
}

async function webSearchDeep(query: string): Promise<string> {
  try {
    const res = await fetch(`http://localhost:3100/api/search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json() as { answer?: string; results?: Array<{title: string, url: string}> }
      const answer = data.answer || ''
      const sources = (data.results || []).slice(0, 3).map((r: {title: string, url: string}) => `• ${r.title}: ${r.url}`).join('\n')
      return `${answer}\n\nSources:\n${sources}`
    }
  } catch {}
  try {
    const r = await fetch(`https://wttr.in/${encodeURIComponent(query)}?format=j1`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) return `Search: ${query} (Vane not running — start it with Docker for deep search)`
  } catch {}
  return `Vane search not available. Start Vane: docker run -d -p 3100:3000 itzcrazykns1337/vane:latest\nQuery was: "${query}"`
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(tool: string, params: Record<string, string>, currentUser?: { username?: string } | null): Promise<string> {
  // Windows/Linux host: macOS-only tools run through the matching Mark-LIV action
  if (process.platform !== 'darwin') {
    const mapped = macToolToMarkLiv(tool, params)
    if (mapped) {
      const { runMarkLiv } = await import('@/lib/mark-liv-bridge')
      return runMarkLiv(mapped.name, mapped.parameters)
    }
    if (tool === 'mac_control') return 'mac_control (AppleScript) only works on macOS — use mark_liv to control this PC.'
  }

  switch (tool) {

    case 'get_time':
      return new Date().toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
      })

    case 'get_weather': {
      const city = params.city || 'Riyadh'
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
          signal: AbortSignal.timeout(6000),
        })
        const d = await res.json() as {
          current_condition: Array<{
            temp_C: string; weatherDesc: Array<{ value: string }>
            humidity: string; windspeedKmph: string; FeelsLikeC: string
          }>
        }
        const c = d.current_condition[0]
        return `${city}: ${c.weatherDesc[0].value}, ${c.temp_C}°C (feels like ${c.FeelsLikeC}°C), humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h`
      } catch {
        return `Weather data for ${city} unavailable`
      }
    }

    case 'web_search':
    case 'google_search': {
      const mode = (params.mode || '').toLowerCase()
      const query = params.query || ''
      if (mode === 'research') {
        return webSearchDeep(query)
      }
      if (mode === 'news') {
        return webSearch(`latest news about ${query}`.trim())
      }
      if (mode === 'price') {
        return webSearch(`current price of ${query}`.trim())
      }
      if (mode === 'compare') {
        const compareQuery = params.items
          ? `compare ${params.items}${params.aspect ? ` regarding ${params.aspect}` : ''}`
          : query
        return webSearch(compareQuery.trim())
      }
      return webSearch(query)
    }

    case 'mac_control':
      return runScript(params.script || '')

    case 'open_app': {
      const app = params.app || ''
      try {
        await runSpawn('open', ['-a', app], { timeout: 6000 })
        return `Opened ${params.app}`
      } catch {
        try {
          await runSpawn('open', [app], { timeout: 6000 })
          return `Opened ${params.app}`
        } catch {
          return `Could not find application: ${params.app}`
        }
      }
    }

    case 'open_url': {
      const url = params.url || ''
      return openUrl(url)
    }

    case 'browser_control': {
      if (process.platform !== 'darwin') return 'Browser control requires a GhostForge host running on macOS'
      const action = (params.action || 'open').toLowerCase()
      const scripts: Record<string, string> = {
        back: 'tell application "System Events" to keystroke "[" using command down',
        forward: 'tell application "System Events" to keystroke "]" using command down',
        reload: 'tell application "System Events" to keystroke "r" using command down',
        new_tab: 'tell application "System Events" to keystroke "t" using command down',
        close_tab: 'tell application "System Events" to keystroke "w" using command down',
        address_bar: 'tell application "System Events" to keystroke "l" using command down',
      }
      if (action === 'open') return openUrl(params.url || 'http://localhost:3001/dashboard')
      if (action === 'search') return openUrl(`https://www.google.com/search?q=${encodeURIComponent(params.text || '')}`)
      if (action === 'type') {
        const text = (params.text || '').replace(/"/g, '\\"')
        return runScript(`tell application "System Events" to keystroke "${text}"`)
      }
      if (action === 'click_text') return executeTool('find_and_click', { label: params.text || '', app: params.app || '' }, currentUser)
      const script = scripts[action]
      if (!script) return `Unsupported browser action: ${action}`
      return runScript(script)
    }

    case 'flight_finder': {
      const from = (params.from || '').trim()
      const to = (params.to || '').trim()
      const date = (params.date || '').trim()
      if (!from || !to) return 'Please provide both origin and destination for the flight search'
      const url = buildGoogleFlightsUrl(from, to, date)
      const openResult = await openUrl(url)
      return `${openResult}\nFlight search prepared from ${from} to ${to}${date ? ` on ${date}` : ''}.\n${url}`
    }

    case 'send_imessage': {
      const contact = (params.contact || '').replace(/"/g, '\\"')
      const message = (params.message || '').replace(/"/g, '\\"')
      const script = `tell application "Messages"
  try
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "${contact}" of targetService
    send "${message}" to targetBuddy
    return "sent"
  on error errMsg
    return errMsg
  end try
end tell`
      const result = await runScript(script)
      return result === 'sent' ? `Message sent to ${params.contact}` : result
    }

    case 'send_user_message': {
      const { deliverMessage } = await import('@/lib/inbox')
      const { findUserByNameOrUsername } = await import('@/lib/users')
      const to = String(params.to || '').trim()
      const text = String(params.message || '').trim()
      if (!to || !text) return 'Need both a recipient (to) and a message to send.'
      const recipient = await findUserByNameOrUsername(to)
      if (!recipient) {
        return `Error: no GhostForge user found matching "${to}". Tell the user to ask an admin to create that account, or try another name.`
      }
      if (!recipient.active) return `Error: user "${recipient.name}" is deactivated and can't receive messages.`
      await deliverMessage(recipient.username, currentUser?.username || 'admin', text)
      return `Message delivered to ${recipient.name} (${recipient.username}).`
    }

    case 'office_document': {
      const { spawnSync } = await import('child_process')
      const { homedir } = await import('os')
      const { join: pathJoin, dirname } = await import('path') as typeof import('path')
      // locate office-cli by walking up from cwd (web-ui served dir) toward repo root
      let officeCli = ''
      let probe = process.cwd()
      for (let i = 0; i < 6; i++) {
        const candidate = pathJoin(probe, 'office-cli', 'office.js')
        if (existsSync(candidate)) { officeCli = candidate; break }
        const parent = dirname(probe)
        if (parent === probe) break
        probe = parent
      }
      if (!officeCli) return 'Office CLI not found. Install office-cli/office.js at the repo root.'
      const officeDir = dirname(pathJoin(officeCli, '..'))
      const action = String(params.action || 'generate').toLowerCase()
      const type = String(params.type || 'memo').toLowerCase()
      const docRoot = pathJoin(homedir(), '.ghostforge', 'documents')

      const run = (cmdArgs: string[]) => {
        try {
          const r = spawnSync('node', [officeCli, ...cmdArgs], { encoding: 'utf8', timeout: 15000, cwd: officeDir })
          if (r.error) return { error: r.error.message }
          return { stdout: (r.stdout || '').trim() }
        } catch (e) {
          return { error: (e as Error).message }
        }
      }

      if (action === 'list') {
        const res = run(['list'])
        if (res.error) return `Office error: ${res.error}`
        if (!res.stdout) return 'No office documents yet. Say "generate a memo about ..." to create one.'
        try {
          const docs = JSON.parse(res.stdout) as Array<{ name: string }>
          if (!docs.length) return 'No office documents yet. Say "generate a memo about ..." to create one.'
          return `Office documents:\n${docs.map(d => `  • ${d.name}`).join('\n')}`
        } catch {
          return res.stdout
        }
      }

      if (action === 'read') {
        const name = (String(params.file || params.name || '')).replace(/\.md$/, '')
        if (!name) return 'Specify which document to read (file name).'
        const res = run(['read', `${name}.md`])
        if (res.error) return `Office error: ${res.error}`
        if (!res.stdout || res.stdout.startsWith('Not found')) return `Document not found: ${name}.md`
        return res.stdout.slice(0, 3000)
      }

      // generate
      const title = String(params.title || params.name || `${type} document`)
      const knownTypes = ['memo', 'minutes', 'report', 'cover', 'contract']
      const genType = knownTypes.includes(type) ? type : 'memo'
      const fieldArgs: string[] = []
      const fields = ['to', 'from', 'subject', 'body', 'details', 'action', 'meeting', 'attendees', 'facilitator', 'agenda', 'discussion', 'decisions', 'actions', 'summary', 'findings', 'metrics', 'recommendations', 'period', 'hiringManager', 'email', 'phone', 'parties', 'purpose', 'terms', 'duration']
      for (const k of fields) {
        if (params[k] != null && k !== 'body') fieldArgs.push(`--${k}=${String(params[k])}`)
        else if (k === 'body') fieldArgs.push(`--body=${String(params[k] ?? '')}`)
      }
      const res = run(['generate', genType, title, ...fieldArgs])
      if (res.error) return `Office error: ${res.error}`
      if (!res.stdout) return 'Could not generate document.'
      try {
        const j = JSON.parse(res.stdout)
        return `Document ${j.type} created: ${j.name} → ${j.file}\n\n${j.body}`
      } catch {
        return res.stdout
      }
    }

    case 'job_hunter': {
      const username = currentUser?.username
      if (!username) return 'Sign in to use the Job Hunter.'
      const jh = await import('@/lib/job-hunter')
      const action = String(params.action || 'status')
      if (action === 'search') {
        const profile = await jh.getProfile(username)
        if (!profile.cv) return 'Upload your CV on the Jobs page first, then I can search.'
        const terms = params.terms ? String(params.terms).split(',').map(t => t.trim()).filter(Boolean) : undefined
        const r = await jh.runSearch(username, { terms, autoPrepare: 3 })
        return `Found ${r.found} jobs, ${r.matched} in your locations (${r.added} new). ${r.prepared} applications are prepared and waiting for your approval on the Jobs page.`
      }
      const jobs = await jh.listJobs(username)
      const ready = jobs.filter(j => j.status === 'ready')
      const needs = jobs.filter(j => j.status === 'needs_user')
      const applied = jobs.filter(j => j.status === 'submitted')
      if (action === 'list') {
        const top = jobs.filter(j => j.fit === 'High' || j.fit === 'Medium').sort((a, b) => b.score - a.score).slice(0, 5)
        return top.length ? top.map(j => `${j.title} at ${j.company} (${j.fit}, ${j.location})`).join('; ') : 'No good matches yet — ask me to search.'
      }
      const { autopilot } = await jh.getProfile(username)
      const auto = autopilot.enabled ? ` Autopilot is on (every ${autopilot.intervalHours}h, up to ${autopilot.dailyLimit} a day).` : ' Autopilot is off.'
      return `${ready.length} applications waiting for your approval, ${needs.length} need you to finish, ${applied.length} submitted.${auto} Open the Jobs page to review.`
    }

    case 'career': {
      const { spawnSync } = await import('child_process')
      const { join: pathJoin, dirname } = await import('path') as typeof import('path')
      let scriptsDir = ''
      let probe = process.cwd()
      for (let i = 0; i < 6; i++) {
        const candidate = pathJoin(probe, 'scripts')
        if (existsSync(candidate)) { scriptsDir = candidate; break }
        const parent = dirname(probe)
        if (parent === probe) break
        probe = parent
      }
      if (!existsSync(pathJoin(scriptsDir, 'career-track.sh'))) {
        return 'Career scripts not found. Ensure scripts/career-*.sh exist at the repo root.'
      }
      const sub = String(params.tool || params.subcommand || 'track').toLowerCase()
      const action = String(params.action || 'list').toLowerCase()
      const scriptMap: Record<string, string> = {
        cv: 'career-cv.sh', track: 'career-track.sh', gap: 'career-gap.sh', prep: 'career-prep.sh', linkedin: 'career-linkedin.sh',
      }
      const script = scriptMap[sub]
      if (!script) return `Unknown career tool "${sub}". Use cv, track, gap, prep, or linkedin.`
      const cmdArgs: string[] = [action]
      for (const k of ['company', 'role', 'url', 'topic', 'file', 'days', 'cv', 'jd', 'position', 'command', 'status', 'notes', 'version1', 'version2']) {
        if (params[k] != null) cmdArgs.push(String(params[k]))
      }
      // Extra positional args passed via params.args (space/comma separated)
      if (params.args) cmdArgs.push(...String(params.args).split(/[\s,]+/).filter(Boolean))
      const r = spawnSync('bash', [pathJoin(scriptsDir, script), ...cmdArgs], { encoding: 'utf8', timeout: 20000, env: { ...process.env, GHOSTFORGE_CAREER_NONINTERACTIVE: '1' }, cwd: scriptsDir })
      if (r.error) return `Career error: ${r.error.message}`
      if (r.stderr && !r.stdout) return `Career error: ${r.stderr.slice(0, 500)}`
      return (r.stdout || '').slice(0, 3000).trim() || 'No output from career script.'
    }

    case 'get_system_info': {
      // Cross-platform (Mark-LIV system_monitor parity): works on macOS,
      // Windows and Linux via lib/system-info instead of macOS-only commands.
      const { getSystemSnapshot } = await import('@/lib/system-info')
      const snap = getSystemSnapshot()
      const bat = snap.battery.present && snap.battery.pct !== null
        ? `${snap.battery.pct}%${snap.battery.charging ? ' (charging)' : ''}`
        : 'N/A'
      return `CPU: ${snap.cpu}% used, RAM: ${snap.ram.usedGB}/${snap.ram.totalGB} GB (${snap.ram.pct}%), Disk: ${snap.disk.usedGB}/${snap.disk.totalGB} GB (${snap.disk.pct}%), Battery: ${bat}, Uptime: ${Math.round(snap.uptimeSec / 3600)}h`
    }

    case 'set_reminder': {
      const title = (params.title || 'Reminder').replace(/"/g, '\\"')
      const notes = (params.notes || '').replace(/"/g, '\\"')
      const props = notes ? `{name:"${title}", body:"${notes}"}` : `{name:"${title}"}`
      const script = `tell application "Reminders"\n  make new reminder at end of default list with properties ${props}\nend tell`
      await runScript(script)
      return `Reminder set: "${params.title}"`
    }

    case 'play_music': {
      const action = params.action || 'play'
      const appName = params.app === 'music' ? 'Music' : 'Spotify'
      const actionMap: Record<string, string> = { play: 'play', pause: 'pause', next: 'next track', previous: 'previous track' }
      const script = params.query && action === 'play'
        ? `tell application "${appName}" to activate\ndelay 0.5\ntell application "${appName}" to search for "${(params.query).replace(/"/g, '\\"')}"`
        : `tell application "${appName}" to ${actionMap[action] || 'play'}`
      await runScript(script)
      return `${action} on ${appName}`
    }

    case 'terminal_command': {
      const cmd = params.command || ''
      // Regex-based block list — covers whitespace variations and common bypasses
      const blocked = [
        /rm\s+-[rRf]{1,3}\s+\/[^a-z]?$/, /rm\s+-[rRf]{1,3}\s+\/\s/,
        /sudo\s+rm\s+-[rRf]/,
        /:\(\)\s*\{.*fork\s*bomb/i,
        />\s*\/dev\/(sda|disk|null\s+&&)/,
        /mkfs\./i, /dd\s+if=\/dev\/zero/i,
        /csrutil\s+disable/i, /nvram.*erase/i,
      ]
      if (blocked.some(b => b.test(cmd))) return 'Command blocked for safety'
      try {
        const args = splitCommandLine(cmd)
        const bin = args.shift() || ''
        if (!bin) return 'Empty command'
        const { stdout, stderr } = await runSpawn(bin, args, { timeout: 12000 })
        return ((stdout + stderr).trim() || 'Command completed').slice(0, 1000)
      } catch (e: unknown) {
        return `Error: ${(e as Error).message?.slice(0, 200)}`
      }
    }

    case 'write_note': {
      const note = params.note || ''
      const ts = new Date().toLocaleString()
      const line = `\n## ${ts}\n${note}\n`
      const notePath = join(process.env.HOME || '', 'GhostForge', 'notes.md')
      try {
        mkdirSync(join(process.env.HOME || '', 'GhostForge'), { recursive: true })
        await appendFile(notePath, line, 'utf8')
        return `Note saved to ~/GhostForge/notes.md`
      } catch {
        return 'Could not save note'
      }
    }

    case 'take_screenshot': {
      try {
        const raw = params.filename || `screenshot-${Date.now()}.png`
        const filename = /^[\w.-]+$/.test(raw) ? raw : `screenshot-${Date.now()}.png`
        const outPath = join(process.env.HOME || '', 'Desktop', filename)
        await runSpawn('screencapture', ['-x', outPath], { timeout: 8000 })
        return `Screenshot saved to ~/Desktop/${filename}`
      } catch {
        return 'Screenshot failed'
      }
    }

    case 'set_volume': {
      const level = Math.max(0, Math.min(100, parseInt(params.level) || 50))
      const script = `set volume output volume ${level}`
      await runScript(script)
      return `Volume set to ${level}%`
    }

    case 'get_clipboard': {
      try {
        const { stdout } = await execAsync('pbpaste', { timeout: 3000 })
        return stdout.trim().slice(0, 500) || '(clipboard is empty)'
      } catch {
        return 'Could not read clipboard'
      }
    }

    case 'type_text': {
      const text = (params.text || '').replace(/"/g, '\\"')
      const script = `tell application "System Events" to keystroke "${text}"`
      await runScript(script)
      return `Typed: "${params.text?.slice(0, 40)}"`
    }

    case 'github_repos': {
      const token = process.env.GITHUB_TOKEN
      if (!token) return 'GitHub not configured. Add GITHUB_TOKEN to .env.local'
      try {
        const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=10&type=owner', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'GhostForge-GFAI' },
          signal: AbortSignal.timeout(8000),
        })
        const repos = await res.json() as Array<{ name: string; description: string; stargazers_count: number; open_issues_count: number }>
        if (!Array.isArray(repos)) return 'Could not fetch repos'
        return repos.slice(0, 8).map(r =>
          `• ${r.name}${r.description ? ` — ${r.description}` : ''} (⭐${r.stargazers_count}, 🔴${r.open_issues_count} issues)`
        ).join('\n')
      } catch {
        return 'GitHub request failed'
      }
    }

    case 'github_prs': {
      const token = process.env.GITHUB_TOKEN
      if (!token) return 'GitHub not configured. Add GITHUB_TOKEN to .env.local'
      try {
        const user = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'GhostForge-GFAI' },
        }).then(r => r.json()) as { login?: string }
        const login = user.login || ''
        const query = params.repo
          ? `repo:${params.repo} is:pr is:open`
          : `is:pr is:open author:${login}`
        const res = await fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=5`,
          { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'GhostForge-GFAI' }, signal: AbortSignal.timeout(8000) }
        )
        const d = await res.json() as { items?: Array<{ title: string; html_url: string; state: string }> }
        if (!d.items?.length) return 'No open pull requests found'
        return d.items.map(p => `• ${p.title}\n  ${p.html_url}`).join('\n')
      } catch {
        return 'GitHub PR fetch failed'
      }
    }

    case 'github_issues': {
      const token = process.env.GITHUB_TOKEN
      if (!token) return 'GitHub not configured. Add GITHUB_TOKEN to .env.local'
      if (params.action === 'create' && params.repo) {
        try {
          const [owner, repo] = params.repo.includes('/') ? params.repo.split('/') : ['', params.repo]
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'GhostForge-GFAI', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: params.title || 'New issue', body: params.body || '' }),
            signal: AbortSignal.timeout(8000),
          })
          const issue = await res.json() as { number?: number; html_url?: string }
          return issue.number ? `Issue #${issue.number} created: ${issue.html_url}` : 'Issue creation failed'
        } catch {
          return 'Could not create issue'
        }
      }
      // List issues
      try {
        const query = params.repo ? `repo:${params.repo} is:issue is:open` : 'is:issue is:open assigned:@me'
        const res = await fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=5`,
          { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'GhostForge-GFAI' }, signal: AbortSignal.timeout(8000) }
        )
        const d = await res.json() as { items?: Array<{ title: string; number: number; html_url: string }> }
        if (!d.items?.length) return 'No open issues found'
        return d.items.map(i => `• #${i.number} ${i.title}`).join('\n')
      } catch {
        return 'GitHub issues fetch failed'
      }
    }

    case 'discord_message': {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL
      if (!webhookUrl) return 'Discord not configured. Add DISCORD_WEBHOOK_URL to .env.local'
      const msg = params.message || ''
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: msg, username: 'G.F.A.I.' }),
          signal: AbortSignal.timeout(6000),
        })
        return `Discord message sent: "${msg.slice(0, 60)}"`
      } catch {
        return 'Could not send Discord message'
      }
    }

    case 'get_files': {
      const dir = params.path || homedir()
      const safeDir = safeHomePath(dir)
      if (!safeDir) return 'Permission denied: path must be inside your home directory (dotfiles are blocked)'
      try {
        const entries = await readdir(safeDir, { withFileTypes: true })
        return entries.slice(0, 20).map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n') || 'Empty directory'
      } catch {
        return `Cannot list ${dir}`
      }
    }

    case 'read_file': {
      const filePath = params.path || ''
      if (!filePath) return 'No file path provided'
      const safePath = safeHomePath(filePath)
      if (!safePath) return 'Permission denied: path must be inside your home directory (dotfiles are blocked)'
      try {
        const content = readFileSync(safePath, 'utf8').slice(0, 1000)
        return content || '(empty file)'
      } catch {
        return `Cannot read file: ${filePath}`
      }
    }

    // ── NEW: Precise mouse control via cliclick ──────────────────────────────

    case 'mouse_click': {
      const x = parseInt(params.x) || 0
      const y = parseInt(params.y) || 0
      const button = params.button || 'left'
      const flagMap: Record<string, string> = { left: 'c', right: 'rc', double: 'dc' }
      const flag = flagMap[button] || 'c'
      try {
        await runSpawn('cliclick', [`${flag}:${x},${y}`], { timeout: 5000 })
        return `${button === 'double' ? 'Double-clicked' : button === 'right' ? 'Right-clicked' : 'Clicked'} at (${x}, ${y})`
      } catch {
        return `Click failed at (${x}, ${y})`
      }
    }

    case 'mouse_move': {
      const x = parseInt(params.x) || 0
      const y = parseInt(params.y) || 0
      try {
        await runSpawn('cliclick', [`m:${x},${y}`], { timeout: 5000 })
        return `Moved cursor to (${x}, ${y})`
      } catch {
        return `Mouse move failed`
      }
    }

    case 'drag_mouse': {
      const fx = parseInt(params.fromX) || 0
      const fy = parseInt(params.fromY) || 0
      const tx = parseInt(params.toX) || 0
      const ty = parseInt(params.toY) || 0
      try {
        await runSpawn('cliclick', [`dd:${fx},${fy}`, `m:${tx},${ty}`, `du:${tx},${ty}`], { timeout: 8000 })
        return `Dragged from (${fx},${fy}) to (${tx},${ty})`
      } catch {
        return `Drag failed`
      }
    }

    case 'scroll': {
      const direction = params.direction || 'down'
      const amount = Math.min(20, parseInt(params.amount) || 3)
      const x = parseInt(params.x) || 0
      const y = parseInt(params.y) || 0
      const dirMap: Record<string, string> = { up: 'up', down: 'down', left: 'left', right: 'right' }
      const d = dirMap[direction] || 'down'
      const script = x && y
        ? `tell application "System Events" to scroll ${d} ${amount} at {${x}, ${y}}`
        : `tell application "System Events" to scroll ${d} ${amount}`
      try {
        await runScript(script)
        return `Scrolled ${direction} ${amount} units`
      } catch {
        return `Scroll failed`
      }
    }

    case 'key_combo': {
      const keys = (params.keys || '').toLowerCase().trim()
      if (!keys) return 'No keys specified'

      // Parse "cmd+shift+c" into AppleScript modifiers + keystroke
      const parts = keys.split('+')
      const modMap: Record<string, string> = {
        cmd: 'command down', command: 'command down',
        shift: 'shift down', alt: 'option down', option: 'option down',
        ctrl: 'control down', control: 'control down',
      }
      const mods = parts.slice(0, -1).map(p => modMap[p] || '').filter(Boolean)
      const key = parts[parts.length - 1]

      // Special key codes
      const keyCodeMap: Record<string, string> = {
        enter: 'key code 36', return: 'key code 36',
        tab: 'key code 48', escape: 'key code 53', esc: 'key code 53',
        space: 'key code 49', delete: 'key code 51', backspace: 'key code 51',
        up: 'key code 126', down: 'key code 125', left: 'key code 123', right: 'key code 124',
        f1: 'key code 122', f2: 'key code 120', f3: 'key code 99', f4: 'key code 118',
        home: 'key code 115', end: 'key code 119', pageup: 'key code 116', pagedown: 'key code 121',
      }

      const isSpecial = keyCodeMap[key]
      const modsStr = mods.length ? `using {${mods.join(', ')}}` : ''
      const keystrokeCmd = isSpecial
        ? `${isSpecial} ${modsStr}`
        : `keystroke "${key.replace(/"/g, '\\"')}" ${modsStr}`

      const script = `tell application "System Events"\n  ${keystrokeCmd.trim()}\nend tell`
      try {
        await runScript(script)
        return `Key combo executed: ${params.keys}`
      } catch {
        return `Key combo failed: ${params.keys}`
      }
    }

    case 'get_frontmost_app': {
      const script = `tell application "System Events" to get name of first application process whose frontmost is true`
      return runScript(script)
    }

    case 'get_windows': {
      const script = `
tell application "System Events"
  set appList to name of every application process whose visible is true
  return appList as string
end tell`
      return runScript(script)
    }

    case 'focus_window': {
      const app = (params.app || '').replace(/"/g, '\\"')
      const script = `tell application "${app}" to activate`
      await runScript(script)
      return `Focused ${params.app}`
    }

    case 'copy_to_clipboard': {
      const text = params.text || ''
      try {
        if (process.platform === 'darwin') {
          await runSpawn('pbcopy', [], { timeout: 3000, input: text })
        } else if (process.platform === 'win32') {
          await runSpawn('clip', [], { timeout: 3000, input: text })
        } else {
          await runSpawn('xclip', ['-selection', 'clipboard'], { timeout: 3000, input: text })
        }
        return `Copied to clipboard: "${text.slice(0, 60)}"`
      } catch {
        return 'Could not copy to clipboard'
      }
    }

    case 'get_screen_info': {
      const script = `
tell application "Finder"
  set bounds to bounds of window of desktop
  return bounds
end tell`
      try {
        const res = await runScript(script)
        const pos = await execAsync('cliclick p:', { timeout: 3000 })
        return `Screen bounds: ${res} | Mouse position: ${pos.stdout.trim()}`
      } catch {
        return 'Screen info unavailable'
      }
    }

    // ── NEW: App messaging via UI automation ─────────────────────────────────

    case 'send_teams_message': {
      const contact = (params.contact || '').replace(/"/g, '\\"')
      const message = (params.message || '').replace(/"/g, '\\"')
      if (!contact || !message) return 'Contact and message are required'

      // Teams automation: open app → new chat → search contact → send message
      const script = `
tell application "Microsoft Teams" to activate
delay 1.5
tell application "System Events"
  tell process "Microsoft Teams"
    -- Try Cmd+N for new chat
    keystroke "n" using command down
    delay 1.2
    -- Type contact name in search
    keystroke "${contact}"
    delay 1.5
    -- Press Enter to select first result
    key code 36
    delay 0.8
    key code 36
    delay 0.8
    -- Type and send message
    keystroke "${message}"
    delay 0.3
    key code 36
    return "sent"
  end tell
end tell`
      const result = await runScript(script)
      return result.includes('Error') ? `Teams message may have failed: ${result}` : `Teams message sent to ${params.contact}: "${params.message?.slice(0, 40)}"`
    }

    case 'send_slack_message': {
      const channel = (params.channel || '').replace(/"/g, '\\"')
      const message = (params.message || '').replace(/"/g, '\\"')
      if (!channel || !message) return 'Channel and message are required'

      const script = `
tell application "Slack" to activate
delay 1.5
tell application "System Events"
  tell process "Slack"
    -- Cmd+K to open channel switcher
    keystroke "k" using command down
    delay 0.8
    keystroke "${channel}"
    delay 1.2
    key code 36
    delay 0.8
    keystroke "${message}"
    delay 0.3
    key code 36
    return "sent"
  end tell
end tell`
      const result = await runScript(script)
      return result.includes('Error') ? `Slack message may have failed: ${result}` : `Slack message sent to #${params.channel}`
    }

    case 'send_whatsapp_message': {
      const contact = (params.contact || '').replace(/"/g, '\\"')
      const message = (params.message || '').replace(/"/g, '\\"')
      if (!contact || !message) return 'Contact and message are required'

      // WhatsApp Desktop automation
      const script = `
tell application "WhatsApp" to activate
delay 1.5
tell application "System Events"
  tell process "WhatsApp"
    -- Cmd+F to search
    keystroke "f" using command down
    delay 0.8
    keystroke "${contact}"
    delay 1.5
    key code 36
    delay 0.8
    keystroke "${message}"
    delay 0.3
    key code 36
    return "sent"
  end tell
end tell`
      const result = await runScript(script)
      return result.includes('Error') ? `WhatsApp message may have failed: ${result}` : `WhatsApp message sent to ${params.contact}`
    }

    case 'find_and_click': {
      const label = params.label || ''
      const app = params.app || ''
      if (!label) return 'No label specified'

      // Use AppleScript UI accessibility to find element by name/title
      const appClause = app ? `tell process "${app.replace(/"/g, '\\"')}"` : 'tell front window'
      const script = `
tell application "System Events"
  ${appClause}
    set foundEl to first UI element whose name is "${label.replace(/"/g, '\\"')}"
    click foundEl
    return "clicked"
  end tell
end tell`
      const result = await runScript(script)
      return result.includes('Error') ? `Could not find UI element: "${label}"` : `Clicked "${label}"`
    }

    case 'execute_code': {
      const lang = (params.language || 'shell').toLowerCase()
      const code = params.code || ''
      if (!code.trim()) return 'No code provided'

      // Safety: block dangerous patterns in code
      const dangerous = [
        /rm\s+-rf\s+\//, /sudo\s+rm/, /format\s+c:/, /mkfs\./,
        /dd\s+if=\/dev\/zero/, /shred\s+/, /csrutil\s+disable/i,
        /launchctl\s+(unload|disable)/i, /nvram.*erase/i,
      ]
      if (dangerous.some(p => p.test(code))) return 'Code blocked: dangerous operation detected'

      // Write to temp file to avoid shell injection (never pass code inline to shell)
      const tmpFile = join(tmpdir(), `gfai-code-${Date.now()}`)
      try {
        if (lang === 'python' || lang === 'python3') {
          const pyFile = `${tmpFile}.py`
          await writeFile(pyFile, code, 'utf8')
          const { stdout, stderr } = await runSpawn('python3', [pyFile], { timeout: 10000 })
          await unlink(pyFile).catch(() => {})
          return (stdout + stderr).trim().slice(0, 1500) || 'No output'
        } else if (lang === 'javascript' || lang === 'node') {
          const jsFile = `${tmpFile}.js`
          await writeFile(jsFile, code, 'utf8')
          const { stdout, stderr } = await runSpawn('node', [jsFile], { timeout: 10000 })
          await unlink(jsFile).catch(() => {})
          return (stdout + stderr).trim().slice(0, 1500) || 'No output'
        } else {
          // Shell — write to .sh file, no inline interpolation
          const shFile = `${tmpFile}.sh`
          await writeFile(shFile, `#!/bin/bash\nset -euo pipefail\n${code}`, 'utf8')
          await runSpawn('chmod', ['+x', shFile], { timeout: 5000 })
          const { stdout, stderr } = await runSpawn('/bin/bash', [shFile], { timeout: 15000 })
          await unlink(shFile).catch(() => {})
          return (stdout + stderr).trim().slice(0, 1500) || 'Done (no output)'
        }
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        return `Error: ${(err.stderr || err.message || 'Unknown error').slice(0, 500)}`
      }
    }

    case 'describe_screen': {
      // Take a screenshot and return its path
      const ts = Date.now()
      const screenshotPath = `/tmp/gfai-screen-${ts}.png`
      try {
        await runSpawn('screencapture', ['-x', screenshotPath], { timeout: 5000 })
        const appInfo = await execAsync(
          `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
          { timeout: 3000 },
        ).then(r => r.stdout.trim()).catch(() => 'unknown')
        return `Screenshot saved to ${screenshotPath}. Active app: ${appInfo}. Use this context to answer user questions about the screen.`
      } catch {
        return 'Screen capture not available (grant Screen Recording permission in System Settings → Privacy)'
      }
    }

    case 'task_steps': {
      // Multi-step task execution — run each step as a shell command
      const stepsRaw = params.steps || ''
      const lines = stepsRaw.split(/\n/).map((l: string) => l.trim()).filter(Boolean)
      const dangerous = [/rm\s+-rf\s+\//, /sudo\s+rm/, /mkfs\./, /dd\s+if=\/dev\//, /csrutil\s+disable/i]
      const results: string[] = []
      for (const step of lines.slice(0, 5)) { // max 5 steps
        if (dangerous.some(p => p.test(step))) {
          results.push(`✗ ${step}: BLOCKED — dangerous pattern`)
          continue
        }
        try {
          const args = splitCommandLine(step)
          const bin = args.shift() || ''
          if (!bin) { results.push(`✗ ${step}: empty`); continue }
          const { stdout, stderr } = await runSpawn(bin, args, { timeout: 10000 })
          results.push(`✓ ${step}: ${(stdout + stderr).trim().slice(0, 200) || 'done'}`)
        } catch (e: unknown) {
          results.push(`✗ ${step}: ${((e as Error).message || 'failed').slice(0, 100)}`)
        }
      }
      return results.join('\n')
    }

    case 'lock_screen': {
      // CGSession -suspend is the most reliable method — no accessibility permissions needed
      try {
        await execAsync('/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend')
        return 'Screen locked'
      } catch {
        // Fallback: Cmd+Ctrl+Q via AppleScript
        try {
          await runScript(`tell application "System Events" to keystroke "q" using {command down, control down}`)
          return 'Screen locked'
        } catch {
          // Last resort: sleep display
          await execAsync('pmset displaysleepnow')
          return 'Display sleeping (screen locked)'
        }
      }
    }

    case 'copilot_ask': {
      const question = params.question || ''
      if (!question) return 'No question provided'
      try {
        const { stdout, stderr } = await runSpawn('gh', ['copilot', '-p', question], { timeout: 30000 })
        const output = (stdout + stderr).trim()
        // Strip token/stats lines from bottom
        const lines = output.split('\n').filter(l =>
          !l.startsWith('Changes') && !l.startsWith('AI Credits') &&
          !l.startsWith('Tokens') && !l.startsWith('Resume') && l.trim()
        )
        return lines.join('\n').trim().slice(0, 1200) || 'No response from Copilot CLI'
      } catch (e: unknown) {
        return `Copilot CLI error: ${(e as Error).message?.slice(0, 200)}`
      }
    }

    case 'mac_cleanup': {
      const results: string[] = []
      let freedMB = 0

      try {
        // 1. Clear /tmp/ files older than 1 day (gfai screenshots etc)
        const tmpFiles = await readdir(tmpdir()).catch(() => [] as string[])
        let tmpCleared = 0
        for (const f of tmpFiles.filter(f => f.startsWith('gfai-'))) {
          const p = join(tmpdir(), f)
          try {
            const s = await stat(p)
            if (Date.now() - s.mtimeMs > 3600_000) {
              await rm(p, { force: true })
              freedMB += Math.round(s.size / 1024 / 1024)
              tmpCleared++
            }
          } catch { /* skip locked files */ }
        }
        if (tmpCleared > 0) results.push(`✓ Cleared ${tmpCleared} GFAI temp files from /tmp/`)

        // 2. Purge DNS cache (helps with slow lookups)
        await execAsync('dscacheutil -flushcache && killall -HUP mDNSResponder 2>/dev/null').catch(() => {})
        results.push('✓ DNS cache flushed')

        // 3. Clear font cache
        await execAsync('atsutil databases -removeUser 2>/dev/null').catch(() => {})
        results.push('✓ Font cache cleared')

        // 4. Report zombie processes
        const zombies = await execAsync("ps aux | awk '$8 ~ /Z/ {print $2, $11}' | head -10").catch(() => ({ stdout: '' }))
        const zombieList = zombies.stdout.trim()
        if (zombieList) results.push(`⚠ Zombie processes found:\n${zombieList}`)
        else results.push('✓ No zombie processes')

        // 5. Inactive memory — suggest purge (user must confirm)
        const vmstat = await execAsync("memory_pressure 2>/dev/null || vm_stat | head -10").catch(() => ({ stdout: '' }))
        results.push(`📊 Memory:\n${vmstat.stdout.trim().slice(0, 200)}`)

        // 6. Disk usage summary
        const disk = await execAsync("df -h / | tail -1").catch(() => ({ stdout: '' }))
        results.push(`💾 Disk: ${disk.stdout.trim()}`)

        // 7. Brew cleanup (if available)
        await execAsync('brew cleanup --prune=7 2>/dev/null', { timeout: 30000 }).then(r => {
          if (r.stdout.trim()) results.push(`✓ Brew cleanup: ${r.stdout.trim().slice(0, 100)}`)
        }).catch(() => {})

        const summary = freedMB > 0 ? ` Freed ~${freedMB}MB.` : ''
        return `Mac cleanup complete.${summary}\n${results.join('\n')}`
      } catch (e) {
        return `Cleanup partial: ${(e as Error).message?.slice(0, 100)}\n${results.join('\n')}`
      }
    }

    case 'llmfit_recommend': {
      try {
        // Get hardware info
        const [memRes, cpuRes, ollamaRes] = await Promise.allSettled([
          execAsync('sysctl hw.memsize'),
          execAsync('sysctl -n machdep.cpu.brand_string'),
          execAsync('ollama list 2>/dev/null'),
        ])
        const ramGB = memRes.status === 'fulfilled'
          ? Math.round(parseInt(memRes.value.stdout.match(/(\d+)/)?.[1] || '0') / 1024 ** 3)
          : 8
        const cpu = cpuRes.status === 'fulfilled' ? cpuRes.value.stdout.trim() : 'Unknown'
        const isAppleSilicon = cpu.toLowerCase().includes('apple m')
        const available = Math.max(2, ramGB - 4)

        const ollama = ollamaRes.status === 'fulfilled'
          ? ollamaRes.value.stdout.split('\n').slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean)
          : []

        const useCase = params.useCase || params.task || 'tools'
        const installedRecommendation = chooseBestInstalledModel(ollama, ramGB, useCase)
        const bestPick = installedRecommendation?.name || (ramGB >= 20 ? 'qwen3.5:9b' : ramGB >= 12 ? 'qwen3.5:4b' : 'llama3.2:3b')
        const reason = installedRecommendation?.profile
          ? `${installedRecommendation.profile.label} profile keeps memory available for JARVIS tools`
          : `${ramGB}GB RAM${isAppleSilicon ? ' + Apple Silicon' : ''} — balanced local default`

        const isInstalled = ollama.includes(bestPick)
        const installCmd = isInstalled ? '' : `\nTo install: ollama pull ${bestPick}`

        return `Hardware: ${cpu} · ${ramGB}GB RAM · Available for AI: ~${available}GB
Best model for your system: ${bestPick} (${reason})
Currently installed: ${ollama.join(', ') || 'none'}
Recommended JARVIS default: ${bestPick}${isInstalled ? ' ✓ installed' : ' — not yet installed'}${installCmd}
Maximum-quality option: qwen3.5:27b (slower; leaves less memory for apps and computer-use tools)
→ Open /models page to browse and install models`
      } catch (e) {
        return `Could not analyze hardware: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'list_local_models': {
      try {
        const results = await Promise.allSettled([
          execAsync('ollama list 2>/dev/null'),
          fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(1000) }).then(r => r.json()).catch(() => null),
          fetch('http://localhost:1337/v1/models', { signal: AbortSignal.timeout(1000) }).then(r => r.json()).catch(() => null),
          fetch('http://localhost:8080/v1/models', { signal: AbortSignal.timeout(1000) }).then(r => r.json()).catch(() => null),
        ])

        const lines: string[] = []

        if (results[0].status === 'fulfilled') {
          const ollamaModels = results[0].value.stdout.split('\n').slice(1).map((l: string) => l.split(/\s+/)[0]).filter(Boolean)
          if (ollamaModels.length) lines.push(`Ollama (${ollamaModels.length}): ${ollamaModels.join(', ')}`)
          else lines.push('Ollama: no models installed (try: ollama pull qwen3:14b)')
        } else {
          lines.push('Ollama: not running')
        }

        const lmData = results[1].status === 'fulfilled' ? results[1].value : null
        if (lmData?.data?.length) lines.push(`LM Studio (${lmData.data.length}): ${lmData.data.map((m: {id: string}) => m.id).join(', ')}`)
        else lines.push('LM Studio: not running')

        const janData = results[2].status === 'fulfilled' ? results[2].value : null
        if (janData?.data?.length) lines.push(`Jan.ai (${janData.data.length}): ${janData.data.map((m: {id: string}) => m.id).join(', ')}`)
        else lines.push('Jan.ai: not running')

        const lfData = results[3].status === 'fulfilled' ? results[3].value : null
        if (lfData?.data?.length) lines.push(`llamafile (${lfData.data.length}): running on :8080`)
        else lines.push('llamafile: not running')

        return lines.join('\n') + '\n→ Open /models to install more'
      } catch (e) {
        return `Error listing models: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'install_model': {
      const model = params.model || params.modelName || ''
      const runner = params.runner || 'ollama'
      if (!model) return 'Please specify a model name. Example: install qwen3:14b'
      if (!/^[\w.:/-]+$/.test(model)) return 'Invalid model name'
      try {
        if (runner === 'ollama') {
          runSpawn('ollama', ['pull', model], {
            env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:${process.env.PATH || ''}` },
            timeout: 300_000,
          }).catch(() => {})
          return `Installing ${model} via Ollama in the background. This may take a few minutes. Check /models page for progress.`
        }
        return `To install via ${runner}, open the /models page and click Install.`
      } catch (e) {
        return `Install error: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    // ── Vault (Knowledge Graph) — silently save user facts ────────────────────
    case 'n8n_workflow': {
      const action = (params.action || 'list').toLowerCase()
      const N8N_URL = process.env.N8N_URL || 'http://localhost:5678'
      const N8N_API_KEY = process.env.N8N_API_KEY || ''

      const n8nHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (N8N_API_KEY) n8nHeaders['X-N8N-API-KEY'] = N8N_API_KEY

      if (action === 'list') {
        try {
          const res = await fetch(`${N8N_URL}/api/v1/workflows`, {
            headers: n8nHeaders,
            signal: AbortSignal.timeout(8000),
          })
          if (!res.ok) return `n8n connection failed (${res.status}). Ensure n8n is running at ${N8N_URL}`
          const data = await res.json() as { data?: Array<{ id: string; name: string; active: boolean }> }
          const workflows = data.data || []
          if (workflows.length === 0) return 'No workflows found in n8n. Import templates with: import n8n workflows'
          return `n8n Workflows (${workflows.length}):\n${workflows.map(w => `${w.active ? '🟢' : '⚪'} ${w.name} (${w.id})`).join('\n')}\n\nn8n: ${N8N_URL}`
        } catch {
          return `Cannot connect to n8n at ${N8N_URL}. Is it running? Start with: n8n start`
        }
      }

      if (action === 'deploy') {
        let parsedData: { project?: string; branch?: string } = {}
        if (params.data) {
          try { parsedData = JSON.parse(params.data) } catch { console.warn('[JARVIS] Invalid JSON in n8n deploy params'); parsedData = {} }
        }
        const project = parsedData.project || 'ghostforge'
        const branch = parsedData.branch || 'main'
        try {
          const webhookUrl = `${N8N_URL}/webhook/ghostforge-deploy`
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deploy', project, branch, timestamp: Date.now() }),
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok) return `Deploy webhook failed (${res.status}). Ensure ghostforge-deploy workflow is active in n8n.`
          return `Deploy triggered for ${project} (${branch}). Check n8n for execution status.`
        } catch {
          return `Cannot reach n8n deploy webhook at ${N8N_URL}. Ensure n8n is running and the ghostforge-deploy workflow is active.`
        }
      }

      if (action === 'notify') {
        const channel = params.channel || 'general'
        const message = params.message || 'Notification from GhostForge'
        const priority = params.priority || 'medium'
        try {
          const webhookUrl = `${N8N_URL}/webhook/ghostforge-notify`
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, message, priority, timestamp: Date.now() }),
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok) return `Notify webhook failed (${res.status}). Ensure ghostforge-notify workflow is active.`
          return `Notification sent to #${channel}: "${message.slice(0, 60)}" (${priority})`
        } catch {
          return `Cannot reach n8n notify webhook. Ensure n8n is running.`
        }
      }

      if (action === 'pr') {
        const actionType = params.action || 'review'
        const prNumber = parseInt(params.prNumber || '0')
        const repo = params.repo || ''
        const comment = params.comment || ''
        if (!prNumber || !repo) return 'PR number and repo are required for n8n PR workflow'
        try {
          const webhookUrl = `${N8N_URL}/webhook/ghostforge-pr`
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: actionType, prNumber, repo, comment, timestamp: Date.now() }),
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok) return `PR webhook failed (${res.status}). Ensure ghostforge-pr workflow is active.`
          return `PR ${actionType} triggered for #${prNumber} in ${repo}`
        } catch {
          return `Cannot reach n8n PR webhook. Ensure n8n is running.`
        }
      }

      if (action === 'create') {
        let parsedData: { name?: string } = {}
        if (params.data) {
          try { parsedData = JSON.parse(params.data) } catch { console.warn('[JARVIS] Invalid JSON in n8n create params'); parsedData = {} }
        }
        const name = parsedData.name || 'New Workflow'
        try {
          const res = await fetch(`${N8N_URL}/api/v1/workflows`, {
            method: 'POST',
            headers: n8nHeaders,
            body: JSON.stringify({
              name,
              nodes: [{ type: 'n8n-nodes-base.manualTrigger', position: [250, 300], parameters: {} }],
              connections: {},
            }),
            signal: AbortSignal.timeout(8000),
          })
          if (!res.ok) return `Failed to create workflow (${res.status})`
          const data = await res.json() as { id?: string; name?: string }
          return `Workflow created: ${data.name || name} (${data.id || 'unknown id'})`
        } catch {
          return 'Failed to create workflow — check n8n connection'
        }
      }

      if (action === 'trigger') {
        const workflowId = params.workflowId || ''
        if (!workflowId) return 'Workflow ID is required to trigger'
        try {
          const webhookUrl = `${N8N_URL}/webhook/ghostforge/${workflowId}`
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggeredFrom: 'jarvis', timestamp: Date.now() }),
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok) return `Trigger failed for workflow ${workflowId} (${res.status})`
          return `Workflow ${workflowId} triggered successfully`
        } catch {
          return `Cannot trigger workflow ${workflowId} — check n8n connection`
        }
      }

      return `Unknown n8n action: ${action}. Available: list, deploy, notify, pr, create, trigger`
    }

    // ── Email Integration ─────────────────────────────────────────────────
    case 'email_list': {
      const query = params.query || params.from || params.subject || ''
      const isUnread = params.isUnread === 'true'
      const maxResults = parseInt(params.maxResults || '10')
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const queryParams = new URLSearchParams()
        if (query) queryParams.set('query', query)
        if (isUnread) queryParams.set('isUnread', 'true')
        queryParams.set('maxResults', String(maxResults))
        const res = await fetch(`${EMAIL_API}/api/email/list?${queryParams}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          if (errText.includes('not configured') || res.status === 503) {
            return 'Email not configured. Set up email in JARVIS Settings → Integrations, or configure GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET environment variables.'
          }
          return `Email list failed (${res.status}): ${errText.slice(0, 200)}`
        }
        const data = await res.json() as { messages?: Array<{ subject: string; from: string; date: string; snippet: string; isUnread: boolean; id: string }> }
        const messages = data.messages || []
        if (messages.length === 0) return 'No emails found matching your criteria.'
        const formatted = messages.map((m, i) =>
          `${i + 1}. ${m.isUnread ? '🔵 ' : ''}${m.subject}\n   From: ${m.from} | ${m.date}\n   ${m.snippet.slice(0, 100)}`,
        ).join('\n\n')
        return `Emails (${messages.length}):\n\n${formatted}`
      } catch (e) {
        return `Email service unavailable: ${(e as Error).message?.slice(0, 100)}. Ensure GhostForge backend is running.`
      }
    }

    case 'email_send': {
      const to = (params.to || '').split(',').map(s => s.trim()).filter(Boolean)
      const subject = params.subject || ''
      const body = params.body || ''
      if (!to.length || !subject || !body) return 'To, subject, and body are required to send an email.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/email/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, subject, body }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          return `Email send failed: ${errText.slice(0, 200)}`
        }
        return `Email sent to ${to.join(', ')}: "${subject.slice(0, 60)}"`
      } catch (e) {
        return `Email service unavailable: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'email_read': {
      const messageId = params.messageId || ''
      if (!messageId) return 'Message ID is required to read an email.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/email/read/${messageId}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return `Email read failed (${res.status})`
        const msg = await res.json() as { subject: string; from: string; fromEmail: string; date: string; body: string; to: string[] }
        return `Subject: ${msg.subject}\nFrom: ${msg.from} <${msg.fromEmail}>\nTo: ${msg.to?.join(', ')}\nDate: ${msg.date}\n\n${msg.body.slice(0, 1000)}`
      } catch (e) {
        return `Email service unavailable: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'email_reply': {
      const messageId = params.messageId || ''
      const body = params.body || ''
      if (!messageId || !body) return 'Message ID and body are required to reply to an email.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/email/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, body }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return `Reply failed (${res.status})`
        return 'Reply sent.'
      } catch (e) {
        return `Email service unavailable: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'email_search': {
      const query = params.query || ''
      if (!query) return 'Search query is required.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/email/search?q=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return `Email search failed (${res.status})`
        const data = await res.json() as { messages?: Array<{ subject: string; from: string; date: string; snippet: string }> }
        const messages = data.messages || []
        if (messages.length === 0) return `No emails found for "${query}".`
        return `Search results for "${query}" (${messages.length}):\n${messages.map((m, i) => `${i + 1}. ${m.subject}\n   From: ${m.from} | ${m.date}\n   ${m.snippet.slice(0, 100)}`).join('\n\n')}`
      } catch (e) {
        return `Email service unavailable: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'email_unread_count': {
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/email/unread-count`, {
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) return 'Could not get unread count'
        const data = await res.json() as { count: number }
        return `You have ${data.count} unread email${data.count !== 1 ? 's' : ''}.`
      } catch {
        return 'Email service unavailable'
      }
    }

    case 'email_mark_read': {
      const messageId = params.messageId || ''
      if (!messageId) return 'Message ID required'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        await fetch(`${EMAIL_API}/api/email/mark-read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
          signal: AbortSignal.timeout(10000),
        })
        return 'Email marked as read.'
      } catch {
        return 'Could not mark email as read'
      }
    }

    case 'email_star': {
      const messageId = params.messageId || ''
      if (!messageId) return 'Message ID required'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        await fetch(`${EMAIL_API}/api/email/star`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
          signal: AbortSignal.timeout(10000),
        })
        return 'Email starred.'
      } catch {
        return 'Could not star email'
      }
    }

    case 'email_delete': {
      const messageId = params.messageId || ''
      if (!messageId) return 'Message ID required'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        await fetch(`${EMAIL_API}/api/email/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
          signal: AbortSignal.timeout(10000),
        })
        return 'Email moved to trash.'
      } catch {
        return 'Could not delete email'
      }
    }

    // ── Calendar Integration ──────────────────────────────────────────────
    case 'calendar_events': {
      const action = (params.action || 'today').toLowerCase()
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'

      if (action === 'today') {
        try {
          const res = await fetch(`${EMAIL_API}/api/calendar/today`, {
            signal: AbortSignal.timeout(15000),
          })
          if (!res.ok) return 'Calendar not configured. Set up calendar in JARVIS Settings → Integrations.'
          const events = await res.json() as Array<{ summary: string; start: { dateTime?: string }; end: { dateTime?: string }; location?: string }>
          if (!events.length) return 'No events scheduled for today.'
          const now = new Date()
          const formatted = events.map((e, i) => {
            const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'All day'
            const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''
            return `${i + 1}. ${e.summary} (${start}${end ? ' - ' + end : ''})${e.location ? ' @ ' + e.location : ''}`
          }).join('\n')
          return `Today's schedule (${events.length} event${events.length !== 1 ? 's' : ''}):\n${formatted}`
        } catch {
          return 'Calendar service unavailable. Ensure GhostForge backend is running.'
        }
      }

      if (action === 'upcoming') {
        const days = parseInt(params.days || '7')
        try {
          const res = await fetch(`${EMAIL_API}/api/calendar/upcoming?days=${days}`, {
            signal: AbortSignal.timeout(15000),
          })
          if (!res.ok) return 'Calendar not configured'
          const events = await res.json() as Array<{ summary: string; start: { dateTime?: string }; description?: string }>
          if (!events.length) return `No events in the next ${days} days.`
          const formatted = events.slice(0, 10).map((e, i) => {
            const date = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'TBD'
            return `${i + 1}. [${date}] ${e.summary}`
          }).join('\n')
          return `Upcoming events (${events.length} in ${days} days):\n${formatted}`
        } catch {
          return 'Calendar service unavailable'
        }
      }

      if (action === 'create') {
        const summary = params.summary || ''
        const startDateTime = params.startDateTime || ''
        const endDateTime = params.endDateTime || ''
        if (!summary || !startDateTime || !endDateTime) return 'summary, startDateTime, and endDateTime are required to create an event.'
        try {
          const res = await fetch(`${EMAIL_API}/api/calendar/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary,
              startDateTime,
              endDateTime,
              location: params.location || undefined,
              attendees: params.attendees ? params.attendees.split(',').map(s => s.trim()) : undefined,
            }),
            signal: AbortSignal.timeout(15000),
          })
          if (!res.ok) return 'Failed to create event'
          const event = await res.json() as { id: string; htmlLink?: string }
          return `Event created: "${summary}" (${startDateTime} - ${endDateTime})${event.htmlLink ? '\n' + event.htmlLink : ''}`
        } catch {
          return 'Calendar service unavailable'
        }
      }

      if (action === 'delete') {
        const eventId = params.eventId || params.id || ''
        if (!eventId) return 'Event ID required to delete'
        try {
          await fetch(`${EMAIL_API}/api/calendar/delete/${eventId}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(10000),
          })
          return 'Event deleted.'
        } catch {
          return 'Could not delete event'
        }
      }

      return `Unknown calendar action: ${action}. Available: today, upcoming, create, delete`
    }

    case 'calendar_free_slots': {
      const date = params.date || new Date().toISOString().split('T')[0]
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/calendar/free-slots?date=${date}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return 'Could not check availability'
        const slots = await res.json() as Array<{ start: string; end: string }>
        if (!slots.length) return `No free slots on ${date}.`
        const formatted = slots.map(s => {
          const start = new Date(s.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          const end = new Date(s.end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          return `${start} - ${end}`
        }).join('\n')
        return `Free slots on ${date}:\n${formatted}`
      } catch {
        return 'Calendar service unavailable'
      }
    }

    // ── Contacts Integration ──────────────────────────────────────────────
    case 'contacts_search': {
      const query = params.query || ''
      if (!query) return 'Search query required. Try: "find John" or "search contacts for Sarah"'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/contacts/search?q=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return 'Contacts not configured. Set up contacts in JARVIS Settings → Integrations.'
        const contacts = await res.json() as Array<{ displayName: string; emails: Array<{ value: string }>; phones: Array<{ value: string }>; organizations?: Array<{ name: string; title?: string }> }>
        if (!contacts.length) return `No contacts found for "${query}".`
        const formatted = contacts.slice(0, 5).map((c, i) => {
          const email = c.emails?.[0]?.value || 'no email'
          const phone = c.phones?.[0]?.value || 'no phone'
          const org = c.organizations?.[0]?.name ? ` @ ${c.organizations[0].name}` : ''
          return `${i + 1}. ${c.displayName}${org}\n   Email: ${email} | Phone: ${phone}`
        }).join('\n\n')
        return `Contacts found (${contacts.length}):\n\n${formatted}`
      } catch {
        return 'Contacts service unavailable'
      }
    }

    case 'contacts_by_phone': {
      const phone = params.phone || ''
      if (!phone) return 'Phone number required'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/contacts/phone?q=${encodeURIComponent(phone)}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return 'Contacts search failed'
        const contacts = await res.json() as Array<{ displayName: string; emails: Array<{ value: string }> }>
        if (!contacts.length) return `No contacts found with phone "${phone}".`
        return contacts.map(c => `${c.displayName}: ${c.emails?.[0]?.value || 'no email'}`).join('\n')
      } catch {
        return 'Contacts service unavailable'
      }
    }

    // ── Google AI Studio ──────────────────────────────────────────────────
    case 'ai_studio_list': {
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/ai-studio/models`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          if (errText.includes('not configured') || res.status === 503) {
            return 'AI Studio not configured. Set GOOGLE_AI_STUDIO_KEY in .env.local or configure in Settings.'
          }
          return `AI Studio failed (${res.status}): ${errText.slice(0, 200)}`
        }
        const models = await res.json() as Array<{ name: string; displayName: string; state: string; baseModel: string }>
        if (!models.length) return 'No AI Studio apps found. Create one at aistudio.google.com.'
        return `AI Studio Apps (${models.length}):\n${models.map((m, i) => `${i + 1}. ${m.displayName || m.name}\n   Base: ${m.baseModel} | State: ${m.state}`).join('\n\n')}`
      } catch {
        return 'AI Studio service unavailable'
      }
    }

    case 'ai_studio_update': {
      const modelId = params.modelId || ''
      const displayName = params.displayName || ''
      const description = params.description || ''
      if (!modelId) return 'modelId is required. Use ai_studio_list to find model IDs.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const body: Record<string, unknown> = {}
        if (displayName) body.displayName = displayName
        if (description) body.description = description
        const res = await fetch(`${EMAIL_API}/api/ai-studio/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, ...body }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return 'Failed to update AI Studio app'
        return `AI Studio app updated: ${modelId}`
      } catch {
        return 'AI Studio service unavailable'
      }
    }

    case 'ai_studio_test': {
      const model = params.model || ''
      const prompt = params.prompt || ''
      if (!model || !prompt) return 'model and prompt are required.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/ai-studio/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt }),
          signal: AbortSignal.timeout(60000),
        })
        if (!res.ok) return 'AI Studio test failed'
        const data = await res.json() as { response: string; latencyMs: number; tokenCount?: number }
        return `Response (${data.latencyMs}ms, ${data.tokenCount || '?'} tokens):\n${data.response.slice(0, 1000)}`
      } catch {
        return 'AI Studio service unavailable'
      }
    }

    case 'ai_studio_compare': {
      const prompt = params.prompt || ''
      const modelA = params.modelA || ''
      const modelB = params.modelB || ''
      if (!prompt || !modelA || !modelB) return 'prompt, modelA, and modelB are required.'
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/ai-studio/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, modelA, modelB }),
          signal: AbortSignal.timeout(120000),
        })
        if (!res.ok) return 'Comparison failed'
        const data = await res.json() as {
          modelA: { model: string; response: string; latencyMs: number };
          modelB: { model: string; response: string; latencyMs: number };
        }
        return `Model A: ${data.modelA.model} (${data.modelA.latencyMs}ms)\n${data.modelA.response.slice(0, 500)}\n\nModel B: ${data.modelB.model} (${data.modelB.latencyMs}ms)\n${data.modelB.response.slice(0, 500)}`
      } catch {
        return 'AI Studio service unavailable'
      }
    }

    case 'ai_studio_models': {
      const EMAIL_API = process.env.GHOSTFORGE_API_URL || 'http://localhost:18923'
      try {
        const res = await fetch(`${EMAIL_API}/api/ai-studio/base-models`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return 'Could not list base models'
        const models = await res.json() as Array<{ name: string; displayName: string; inputTokenLimit: number; outputTokenLimit: number }>
        return `Available Gemini models (${models.length}):\n${models.slice(0, 10).map(m => `• ${m.displayName || m.name} (${(m.inputTokenLimit / 1000).toFixed(0)}K in / ${(m.outputTokenLimit / 1000).toFixed(0)}K out)`).join('\n')}`
      } catch {
        return 'AI Studio service unavailable'
      }
    }

    case 'vault_save': {
      const category = (params.category as string) || 'facts'
      const key = params.key as string
      const value = params.value as string
      if (!key || !value) return 'Knowledge saved.'
      try {
        const vaultDir  = join(homedir(), '.ghostforge', 'jarvis')
        const vaultFile = join(vaultDir, 'vault.json')
        mkdirSync(vaultDir, { recursive: true })
        let vault: { entries: Array<{id: string; category: string; key: string; value: string; ts: number}>; version: number } = { entries: [], version: 1 }
        if (existsSync(vaultFile)) vault = JSON.parse(readFileSync(vaultFile, 'utf8'))
        const idx = vault.entries.findIndex(e => e.category === category && e.key === key)
        const entry = { id: `${category}-${key}`, category, key, value: value.slice(0, 380), ts: Date.now() }
        if (idx >= 0) vault.entries[idx] = entry; else vault.entries.push(entry)
        if (vault.entries.length > 500) vault.entries = vault.entries.sort((a, b) => b.ts - a.ts).slice(0, 500)
        writeFileSync(vaultFile, JSON.stringify(vault, null, 2))
        return '' // silent — never announce vault saves to user
      } catch {
        return ''  // fail silently
      }
    }

    case 'set_goal': {
      const goalsFile = join(homedir(), '.ghostforge', 'goals.json')
      try {
        let goals: Array<{id: string, goal: string, deadline?: string, created: string, done: boolean}> = []
        if (existsSync(goalsFile)) {
          const existing = readFileSync(goalsFile, 'utf8')
          goals = JSON.parse(existing)
        } else {
          mkdirSync(join(homedir(), '.ghostforge'), { recursive: true })
        }
        const newGoal = { id: Date.now().toString(), goal: params.goal || '', deadline: params.deadline, created: new Date().toISOString(), done: false }
        goals.push(newGoal)
        writeFileSync(goalsFile, JSON.stringify(goals, null, 2))
        return `Goal set: "${newGoal.goal}"${newGoal.deadline ? ` (deadline: ${newGoal.deadline})` : ''}. You have ${goals.filter(g => !g.done).length} active goals.`
      } catch (e) {
        return `Could not save goal: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'list_goals': {
      const goalsFile = join(homedir(), '.ghostforge', 'goals.json')
      try {
        if (!existsSync(goalsFile)) return 'No goals set yet. Try: "set a goal: finish the project by Friday"'
        const goals: Array<{id: string, goal: string, deadline?: string, created: string, done: boolean}> = JSON.parse(readFileSync(goalsFile, 'utf8'))
        if (!goals.length) return 'No goals set.'
        const active = goals.filter(g => !g.done)
        const done = goals.filter(g => g.done)
        return `Active goals (${active.length}):\n${active.map((g, i) => `${i+1}. ${g.goal}${g.deadline ? ` (by ${g.deadline})` : ''}`).join('\n')}\n\nCompleted: ${done.length}`
      } catch (e) {
        return `Could not read goals: ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'web_search_deep': {
      const q = params.query || 'hello'
      return webSearchDeep(q)
    }

    case 'delegate_agent': {
      const role = params.role || 'research'
      const task = params.task || ''
      const roleDescriptions: Record<string, string> = {
        code: 'Senior full-stack developer (React, Node.js, TypeScript)',
        security: 'Security analyst (OWASP, pen test, secrets audit)',
        devops: 'DevOps engineer (GitHub Actions, Docker, CI/CD)',
        qa: 'QA engineer (Jest, Playwright, accessibility)',
        research: 'Research analyst (web search, synthesis, citations)',
      }
      const roleDesc = roleDescriptions[role] || role
      return `Delegated to ${roleDesc}: "${task}"\n\nTo execute: Open the GhostForge web UI → JARVIS → switch model to a capable model → paste this task.\n\nFor automated multi-agent: install herdr (herdr.dev) to run multiple AI coding agents in parallel.`
    }

    case 'install_on_device': {
      let ip = '192.168.1.x'
      try { const r = await execAsync('ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null'); ip = r.stdout.trim() } catch {}
      return `Install GhostForge on your device:\n\n📱 PWA (fastest): Open http://${ip}:3001 on your phone → Share → Add to Home Screen\n\n🤖 Android APK: Run 'bash scripts/build-android.sh' on your Mac\n\n🍎 iOS IPA: Run 'bash scripts/build-ios.sh' on your Mac (needs Xcode)\n\n🖥 Desktop: Run 'bash scripts/build-electron.sh'`
    }

    case 'open_interpreter': {
      // Uses open-interpreter (pip install open-interpreter) for AI-powered code execution
      const prompt = params.prompt || ''
      if (!prompt.trim()) return 'No prompt provided for open-interpreter'

      // Safety check
      const dangerous = [/rm\s+-rf\s+\//, /sudo\s+rm/, /format\s+c:/, /mkfs\./, /dd\s+if=\/dev\/zero/, /csrutil\s+disable/i]
      if (dangerous.some(p => p.test(prompt))) return 'Prompt blocked: potentially dangerous operation detected'

      try {
        // Check if open-interpreter is installed
        await execAsync('python3 -m interpreter --version', { timeout: 5000 })
      } catch {
        return 'open-interpreter not found. Install with: pip3 install open-interpreter\nThen restart GhostForge server.'
      }

      try {
        const model = params.model || 'ollama/qwen2.5-coder:7b'
        if (!/^[\w./:-]+$/.test(model)) return 'Invalid model name'
        // Use --safe mode and --quiet for non-interactive execution
        const tmpPromptFile = join(tmpdir(), `gfai-oi-${Date.now()}.txt`)
        await writeFile(tmpPromptFile, prompt, 'utf8')
        const { stdout, stderr } = await runSpawn(
          'python3',
          ['-m', 'interpreter', '--model', model, '--safe', '--quiet', '--single_message', readFileSync(tmpPromptFile, 'utf8')],
          { timeout: 60000 }
        )
        await unlink(tmpPromptFile).catch(() => {})
        return (stdout + stderr).trim().slice(0, 2000) || 'open-interpreter completed (no output)'
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        // open-interpreter often returns partial output even on "error"
        const out = (err.stdout || '') + (err.stderr || '')
        if (out.trim()) return out.trim().slice(0, 2000)
        return `open-interpreter error: ${err.message?.slice(0, 300)}`
      }
    }

    case 'jsrepl_run': {
      // jsrepl.io — online REPL for JS/TS/Python/HTML
      // We run JS/Python locally if possible, otherwise provide jsrepl.io link
      const code = params.code || ''
      const lang = (params.language || 'javascript').toLowerCase()

      if (!code.trim()) return 'No code provided'

      // For JS/Python, run locally first (faster, no network)
      if (lang === 'javascript' || lang === 'js') {
        try {
          const jsFile = join(tmpdir(), `gfai-jsrepl-${Date.now()}.js`)
          await writeFile(jsFile, code, 'utf8')
          const { stdout, stderr } = await runSpawn('node', [jsFile], { timeout: 10000 })
          await unlink(jsFile).catch(() => {})
          const output = (stdout + stderr).trim().slice(0, 1500) || 'No output'
          return `✓ JavaScript (local Node.js):\n${output}\n\n💡 Also try online: https://jsrepl.io`
        } catch (e: unknown) {
          const err = e as { stderr?: string; message?: string }
          return `Error: ${(err.stderr || err.message || '').slice(0, 500)}\n\n💡 Try in browser: https://jsrepl.io`
        }
      }

      if (lang === 'python' || lang === 'py') {
        try {
          const pyFile = join(tmpdir(), `gfai-jsrepl-${Date.now()}.py`)
          await writeFile(pyFile, code, 'utf8')
          const { stdout, stderr } = await runSpawn('python3', [pyFile], { timeout: 10000 })
          await unlink(pyFile).catch(() => {})
          const output = (stdout + stderr).trim().slice(0, 1500) || 'No output'
          return `✓ Python (local):\n${output}\n\n💡 Also try online: https://jsrepl.io`
        } catch (e: unknown) {
          const err = e as { stderr?: string; message?: string }
          return `Error: ${(err.stderr || err.message || '').slice(0, 500)}\n\n💡 Try in browser: https://jsrepl.io`
        }
      }

      // For TypeScript or HTML, provide jsrepl.io link with encoded code
      const encoded = encodeURIComponent(code)
      const jsreplUrl = `https://jsrepl.io/?lang=${lang}&code=${encoded.slice(0, 2000)}`
      return `Open in jsrepl.io (${lang}):\n${jsreplUrl}\n\nNote: link may be truncated for very long code — paste directly at https://jsrepl.io`
    }

    case 'list_design_md': {
      const sites = [
        'airbnb','airtable','apple','binance','bmw','cal','claude','coinbase','cursor',
        'elevenlabs','expo','figma','framer','linear.app','lovable','mastercard','meta',
        'mintlify','miro','mistral.ai','mongodb','nike','notion','nvidia','ollama',
        'opencode.ai','posthog','raycast','replicate','resend','revolut','sanity',
        'sentry','shopify','slack','spotify','stripe','supabase','superhuman','tesla',
        'uber','vercel','voltagent','warp','webflow','wise','x.ai','zapier',
        'ferrari','lamborghini','bugatti','spacex','nintendo-2001','dell-1996',
        'playstation','starbucks','pinterest','theverge','wired','ibm','hp','hashicorp',
        'clickhouse','composio','clay','kraken','framer','runwayml','together.ai',
        'cohere','minimax','bmw-m','renault','vodafone','intercom',
      ]
      return `74 DESIGN.md templates available (github.com/VoltAgent/awesome-design-md):\n\n${sites.join(', ')}\n\nUsage: "apply design of stripe to my project" or ask me to apply any site's DESIGN.md`
    }

    case 'apply_design_md': {
      const site = (params.site || '').toLowerCase().replace(/\s+/g, '-')
      const projectPath = params.projectPath || process.cwd()
      if (!site) return 'Please specify a site name, e.g. "stripe", "vercel", "apple", "notion"'

      try {
        const rawUrl = `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/${site}/DESIGN.md`
        const res = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) })
        if (!res.ok) {
          // Try alternate URL format (getdesign.md)
          return `DESIGN.md not found for "${site}". Available sites: stripe, vercel, apple, notion, figma, slack, spotify, linear.app, cursor, uber, shopify, and 63 more. Ask me to list all.`
        }
        const content = await res.text()
        const destPath = join(projectPath, 'DESIGN.md')
        writeFileSync(destPath, content, 'utf8')
        const lines = content.split('\n').length
        return `✓ DESIGN.md applied for ${site} (${lines} lines)\n\nSaved to: ${destPath}\n\nYour AI coding agents (Claude, Cursor, Cline) will now automatically read this file and generate UI that matches ${site}'s design language.\n\nKey design tokens extracted — check DESIGN.md for colors, typography, spacing, and component patterns.`
      } catch (e: unknown) {
        return `Could not fetch DESIGN.md for "${site}": ${(e as Error).message?.slice(0, 100)}`
      }
    }

    case 'design_resources': {
      const category = (params.category || 'tools').toLowerCase()
      const resources: Record<string, Array<{name: string, url: string, desc: string}>> = {
        color: [
          { name: 'Coolors', url: 'coolors.co', desc: 'Fast color palette generator' },
          { name: 'Adobe Color', url: 'color.adobe.com', desc: 'Color wheel and palette explorer' },
          { name: 'Paletton', url: 'paletton.com', desc: 'Color scheme designer' },
          { name: 'Color Hunt', url: 'colorhunt.co', desc: 'Curated color palettes' },
          { name: 'uicolors.app', url: 'uicolors.app', desc: 'Tailwind color palette generator' },
        ],
        typography: [
          { name: 'Google Fonts', url: 'fonts.google.com', desc: '1000+ free fonts' },
          { name: 'Font Pair', url: 'fontpair.co', desc: 'Google font pairings' },
          { name: 'Typescale', url: 'typescale.com', desc: 'Typography scale calculator' },
          { name: 'Fontjoy', url: 'fontjoy.com', desc: 'AI-generated font pairings' },
        ],
        icons: [
          { name: 'Heroicons', url: 'heroicons.com', desc: 'Beautiful hand-crafted SVG icons by Tailwind' },
          { name: 'Lucide', url: 'lucide.dev', desc: 'Beautiful & consistent icons (React/Vue/Svelte)' },
          { name: 'Phosphor Icons', url: 'phosphoricons.com', desc: 'Flexible icon family' },
          { name: 'Feather Icons', url: 'feathericons.com', desc: 'Simply beautiful open source icons' },
          { name: 'Simple Icons', url: 'simpleicons.org', desc: 'Brand SVG icons' },
        ],
        stock: [
          { name: 'Unsplash', url: 'unsplash.com', desc: 'Free high-resolution photos' },
          { name: 'Pexels', url: 'pexels.com', desc: 'Free stock photos and videos' },
          { name: 'Undraw', url: 'undraw.co', desc: 'Free customizable SVG illustrations' },
          { name: 'Storyset', url: 'storyset.com', desc: 'Customizable illustrations' },
          { name: 'UI Faces', url: 'uifaces.co', desc: 'AI-generated avatar photos' },
        ],
        prototyping: [
          { name: 'Figma', url: 'figma.com', desc: 'Collaborative design tool' },
          { name: 'Framer', url: 'framer.com', desc: 'Design + publish websites' },
          { name: 'Penpot', url: 'penpot.app', desc: 'Open-source Figma alternative (self-hostable)' },
          { name: 'Excalidraw', url: 'excalidraw.com', desc: 'Virtual whiteboard for sketching' },
        ],
        inspiration: [
          { name: 'Dribbble', url: 'dribbble.com', desc: 'Design portfolio community' },
          { name: 'Behance', url: 'behance.net', desc: 'Creative portfolio showcase' },
          { name: 'Awwwards', url: 'awwwards.com', desc: 'Best web design awards' },
          { name: 'Siteinspire', url: 'siteinspire.com', desc: 'Web design inspiration' },
          { name: 'Mobbin', url: 'mobbin.com', desc: 'Mobile app design patterns' },
        ],
        tools: [
          { name: 'Tailwind CSS', url: 'tailwindcss.com', desc: 'Utility-first CSS framework' },
          { name: 'shadcn/ui', url: 'ui.shadcn.com', desc: 'Beautiful React components' },
          { name: 'Radix UI', url: 'radix-ui.com', desc: 'Unstyled accessible components' },
          { name: 'Storybook', url: 'storybook.js.org', desc: 'Component development & docs' },
          { name: 'v0.dev', url: 'v0.dev', desc: 'AI component generator by Vercel' },
          { name: 'DESIGN.md', url: 'getdesign.md', desc: 'AI-ready design system docs (74 sites)' },
        ],
      }
      const list = resources[category] || resources.tools
      return `Design Resources — ${category.toUpperCase()} (from github.com/gztchan/awesome-design):\n\n${list.map(r => `• ${r.name} (${r.url})\n  ${r.desc}`).join('\n')}\n\nCategories: color, typography, icons, stock, prototyping, inspiration, tools`
    }

    case 'vigolium_scan': {
      const target = params.target || ''
      if (!target) return 'Please provide a target URL to scan, e.g. "scan https://example.com"'

      // Safety: only allow http/https URLs
      if (!/^https?:\/\//.test(target)) return 'Target must be a valid http/https URL'

      try {
        await execAsync('command -v vigolium', { timeout: 3000 })
      } catch {
        return `Vigolium not installed. Install with:\n  npm install -g @vigolium/vigolium\nor:\n  curl -fsSL https://vigolium.com/install.sh | bash\n\nThen run: vigolium scan -t ${target}`
      }

      const strategy = params.strategy || 'fast'
      try {
        console.log(`[JARVIS] Starting Vigolium ${strategy} scan on ${target}...`)
        const { stdout, stderr } = await execAsync(
          `vigolium scan -t "${target}" --strategy ${strategy} --json 2>&1 | tail -50`,
          { timeout: 120000 }
        )
        const output = (stdout + stderr).trim().slice(0, 3000)
        return `Vigolium ${strategy} scan complete for ${target}:\n\n${output}\n\nFor full results: vigolium scan -t ${target} --output report.html`
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        const out = (err.stdout || '') + (err.stderr || '')
        return out.trim() ? out.trim().slice(0, 2000) : `Scan error: ${err.message?.slice(0, 200)}`
      }
    }

    case 'vigolium_agent': {
      const target = params.target || ''
      if (!target) return 'Please provide a target URL for agentic scan'
      if (!/^https?:\/\//.test(target)) return 'Target must be a valid http/https URL'

      try {
        await execAsync('command -v vigolium', { timeout: 3000 })
      } catch {
        return `Vigolium not installed. Install: npm install -g @vigolium/vigolium\n\nAgentic scan command: vigolium agent --mode ${params.mode || 'autopilot'} -t ${target}`
      }

      const mode = params.mode || 'autopilot'
      return `Starting Vigolium agentic scan (${mode} mode) on ${target}...\n\nThis runs an AI-driven scan that autonomously plans attacks, selects modules, and triages results. This may take several minutes.\n\nRun in terminal:\n  vigolium agent --mode ${mode} -t "${target}"\n\nFor source code audit:\n  vigolium agent --mode swarm --diff HEAD~5 -t "${target}"\n\nCloud dashboard: https://console.vigolium.com/`
    }

    // ── Clicky: Blue cursor pointing ────────────────────────────────────────────
    case 'point_cursor': {
      const x = parseInt(params.x || '0', 10)
      const y = parseInt(params.y || '0', 10)
      const label = params.label || null
      if (!x && !y) return 'No coordinates provided for cursor pointing'
      return JSON.stringify({ action: 'point_cursor', x, y, label, timestamp: Date.now() })
    }

    case 'highlight_area': {
      const x = parseInt(params.x || '0', 10)
      const y = parseInt(params.y || '0', 10)
      const w = parseInt(params.w || '100', 10)
      const h = parseInt(params.h || '100', 10)
      return JSON.stringify({ action: 'highlight_area', x, y, w, h, timestamp: Date.now() })
    }

    // ── Clicky: Screen understanding via vision model ───────────────────────────
    case 'understand_screen': {
      try {
        const screenshotPath = `/tmp/gfai-clicky-${Date.now()}.png`
        await runSpawn('screencapture', ['-x', screenshotPath], { timeout: 5000 })

        const { readFileSync: rf } = await import('fs')
        const imgBuffer = rf(screenshotPath)
        const imageBase64 = imgBuffer.toString('base64')
        await import('fs').then(fs => fs.unlinkSync(screenshotPath)).catch(() => {})

        const { generateVision } = await import('@/lib/ai')
        const question = params.question || 'Describe what you see on this screen in detail. Identify UI elements, text, buttons, menus, and their positions.'
        const result = await generateVision({
          prompt: question,
          imageBase64,
          mimeType: 'image/png',
          system: 'You are a screen reader assistant. Describe the screen contents precisely. If asked to find something, give approximate coordinates (x, y) as percentages of screen width/height. Format coordinates as [POINT:x,y:label:screen1] when pointing at specific elements.',
        })
        return result.text
      } catch (e: unknown) {
        return `Screen understanding failed: ${(e as Error).message}. Ensure Screen Recording permission is granted and a vision model is available (ollama pull moondream).`
      }
    }

    case 'find_element': {
      try {
        const screenshotPath = `/tmp/gfai-find-${Date.now()}.png`
        await runSpawn('screencapture', ['-x', screenshotPath], { timeout: 5000 })

        const { readFileSync: rf } = await import('fs')
        const imgBuffer = rf(screenshotPath)
        const imageBase64 = imgBuffer.toString('base64')
        await import('fs').then(fs => fs.unlinkSync(screenshotPath)).catch(() => {})

        const { generateVision } = await import('@/lib/ai')
        const description = params.description || 'button'
        const result = await generateVision({
          prompt: `Find the UI element described as "${description}" on this screen. Return its approximate pixel coordinates as [POINT:x,y:${description}:screen1]. Be precise. If you can't find it, say so.`,
          imageBase64,
          mimeType: 'image/png',
          system: 'You are a UI element locator. Find elements on screen and return coordinates in [POINT:x,y:label:screen] format.',
        })
        return result.text
      } catch (e: unknown) {
        return `Element finding failed: ${(e as Error).message}`
      }
    }

    case 'read_text_on_screen': {
      try {
        const screenshotPath = `/tmp/gfai-ocr-${Date.now()}.png`
        await runSpawn('screencapture', ['-x', screenshotPath], { timeout: 5000 })

        const { readFileSync: rf } = await import('fs')
        const imgBuffer = rf(screenshotPath)
        await import('fs').then(fs => fs.unlinkSync(screenshotPath)).catch(() => {})

        // Prefer local PaddleOCR (fast, offline) before falling back to a vision model
        const ocrText = await ocrImageBuffer(imgBuffer)
        if (ocrText) {
          return `Screen text (OCR):\n${ocrText.slice(0, 2000)}`
        }

        const imageBase64 = imgBuffer.toString('base64')
        const { generateVision } = await import('@/lib/ai')
        const result = await generateVision({
          prompt: 'Read all the text visible on this screen. List every piece of text you can see, organized by location (top, middle, bottom, left, right). Include button labels, menu items, window titles, and any other readable text.',
          imageBase64,
          mimeType: 'image/png',
          system: 'You are an OCR assistant. Extract all visible text from the screen image.',
        })
        return result.text
      } catch (e: unknown) {
        return `Text reading failed: ${(e as Error).message}`
      }
    }

    // ── YouTube Control ───────────────────────────────────────────────────────
    case 'youtube_control': {
      const action = (params.action || 'search').toLowerCase()
      const PYTHON_BRIDGE = 'http://localhost:8765'

      if (action === 'search') {
        const query = params.query || ''
        if (!query) return 'No search query provided'
        try {
          const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
          await runSpawn('open', [searchUrl], { timeout: 5000 })
          return `Opened YouTube search for "${query}"`
        } catch {
          return `Could not open YouTube search for "${query}"`
        }
      }

      if (action === 'transcript') {
        const url = params.url || ''
        if (!url) return 'No video URL provided'
        const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
        const videoId = videoIdMatch?.[1] || url.slice(0, 11)
        try {
          const res = await fetch(`${PYTHON_BRIDGE}/transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: videoId }),
            signal: AbortSignal.timeout(15000),
          })
          if (res.ok) {
            const data = await res.json() as { transcript?: Array<{ text: string; start: number; duration: number }> }
            const segments = data.transcript || []
            return segments.map(s => s.text).join(' ').slice(0, 2000) || 'No transcript available'
          }
        } catch {}
        return 'Transcript unavailable — bridge may not be running'
      }

      if (action === 'info') {
        const url = params.url || ''
        if (!url) return 'No video URL provided'
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
          const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) })
          if (res.ok) {
            const data = await res.json() as { title: string; author_name: string }
            return `Title: ${data.title}\nAuthor: ${data.author_name}`
          }
        } catch {}
        return 'Video info unavailable'
      }

      if (action === 'trending') {
        const region = params.region || 'US'
        try {
          const res = await fetch(`${PYTHON_BRIDGE}/trending`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ region }),
            signal: AbortSignal.timeout(15000),
          })
          if (res.ok) {
            const data = await res.json() as { videos?: Array<{ title: string; url: string; viewCount: number }> }
            const videos = data.videos || []
            if (videos.length === 0) return 'No trending videos found'
            return videos.slice(0, 5).map((v, i) =>
              `${i + 1}. ${v.title} (${v.viewCount.toLocaleString()} views)\n   ${v.url}`
            ).join('\n')
          }
        } catch {}
        return `Trending videos unavailable for region: ${region}`
      }

      if (action === 'summarize') {
        const url = params.url || ''
        if (!url) return 'No video URL provided'
        const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
        const videoId = videoIdMatch?.[1] || url.slice(0, 11)
        try {
          const transcriptRes = await fetch(`${PYTHON_BRIDGE}/transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: videoId }),
            signal: AbortSignal.timeout(15000),
          })
          if (transcriptRes.ok) {
            const tData = await transcriptRes.json() as { transcript?: Array<{ text: string }> }
            const fullText = (tData.transcript || []).map(s => s.text).join(' ')
            if (fullText.length > 0) {
              return `Video transcript (${fullText.length} chars):\n${fullText.slice(0, 2000)}`
            }
          }
        } catch {}
        return 'Could not generate summary — transcript not available'
      }

      return `Unknown YouTube action: ${action}`
    }

    // ── Game Manager ──────────────────────────────────────────────────────────
    case 'game_manager': {
      const action = (params.action || 'list').toLowerCase()

      if (action === 'list') {
        const steamDir = join(homedir(), 'Library/Application Support/Steam/steamapps')
        const epicDir = join(homedir(), 'Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests')
        const steamCount = readdirSync(steamDir).filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf')).length
        const epicCount = readdirSync(epicDir).filter(f => f.endsWith('.item')).length
        return `Installed games: ~${steamCount} Steam, ~${epicCount} Epic Games\nOpen game launchers to see full library.`
      }

      if (action === 'scan-steam' || action === 'scan_steam') {
        try {
          const steamDir = join(homedir(), 'Library/Application Support/Steam/steamapps')
          const files = readdirSync(steamDir).filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf')).slice(0, 20)
          if (files.length === 0) return 'No Steam games found. Is Steam installed?'
          const games: string[] = []
          for (const file of files.slice(0, 10)) {
            try {
              const content = readFileSync(join(steamDir, file), 'utf8')
              const match = content.match(/"name"\s*"([^"]+)"/)
              if (match) games.push(match[1])
            } catch {}
          }
          return `Steam games found (${games.length}):\n${games.join('\n')}`
        } catch {
          return 'Could not scan Steam library'
        }
      }

      if (action === 'scan-epic' || action === 'scan_epic') {
        try {
          const manifestDir = join(homedir(), 'Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests')
          const files = readdirSync(manifestDir).filter(f => f.endsWith('.item')).slice(0, 10)
          if (files.length === 0) return 'No Epic Games found. Is the Epic Games Launcher installed?'
          const games: string[] = []
          for (const file of files.slice(0, 10)) {
            try {
              const data = JSON.parse(readFileSync(join(manifestDir, file), 'utf8'))
              if (data.AppName) games.push(data.AppName)
            } catch {}
          }
          return `Epic Games found (${games.length}):\n${games.join('\n')}`
        } catch {
          return 'Could not scan Epic Games library'
        }
      }

      if (action === 'check-update' || action === 'check_update') {
        const gameName = params.game_name || ''
        if (!gameName) return 'Please specify a game name'
        return `Update check for "${gameName}": Open the game launcher (Steam/Epic) to check for updates. Automatic update detection requires the game launcher running.`
      }

      if (action === 'update') {
        const gameName = params.game_name || ''
        if (!gameName) return 'Please specify a game name'
        return `Update for "${gameName}": Open Steam/Epic Games Launcher to download the latest update.`
      }

      return `Unknown game action: ${action}`
    }

    // ── Clipboard Analyze ─────────────────────────────────────────────────────
    case 'clipboard_analyze': {
      const action = (params.action || 'explain').toLowerCase()
      const text = params.text || ''

      if (!text && action !== 'history') {
        // Try reading clipboard
        try {
          const { stdout } = await execAsync('pbpaste', { timeout: 3000 })
          const clipboardText = stdout.trim()
          if (!clipboardText) return 'Clipboard is empty'
          return analyzeClipboardText(clipboardText, action)
        } catch {
          return 'Could not read clipboard'
        }
      }

      if (action === 'history') {
        return 'Clipboard history is managed by the Electron app. Use the clipboard IPC handler from the renderer.'
      }

      return analyzeClipboardText(text || '', action)
    }

    // ── Browser Automate ──────────────────────────────────────────────────────
    case 'browser_automate': {
      const action = (params.action || 'open').toLowerCase()
      const url = params.url || ''
      const selector = params.selector || ''
      const text = params.text || ''

      if (action === 'open') {
        if (!url) return 'No URL provided'
        return openUrl(url)
      }

      if (action === 'search') {
        if (!text) return 'No search query provided'
        return openUrl(`https://www.google.com/search?q=${encodeURIComponent(text)}`)
      }

      if (action === 'navigate') {
        if (!url) return 'No URL provided'
        return openUrl(url)
      }

      if (action === 'screenshot') {
        const outPath = `/tmp/browser-screenshot-${Date.now()}.png`
        if (process.platform === 'darwin') {
          await runSpawn('screencapture', ['-x', outPath], { timeout: 8000 })
          return `Screenshot saved to ${outPath}`
        }
        return 'Browser screenshot not available on this platform'
      }

      if (action === 'get-text' || action === 'get_text') {
        return 'Browser text extraction requires Playwright. Install with: npm i playwright'
      }

      if (action === 'click') {
        if (!selector) return 'No CSS selector provided for click'
        return `Click on "${selector}" requires Playwright browser automation. Install: npm i playwright`
      }

      if (action === 'type') {
        if (!text) return 'No text to type'
        const escaped = text.replace(/"/g, '\\"')
        if (process.platform === 'darwin') {
          await runScript(`tell application "System Events" to keystroke "${escaped}"`)
          return `Typed: "${text.slice(0, 60)}"`
        }
        return 'Typing requires macOS or Playwright'
      }

      if (action === 'back') {
        if (process.platform === 'darwin') {
          await runScript('tell application "System Events" to keystroke "[" using command down')
          return 'Navigated back'
        }
        return 'Browser back requires macOS'
      }

      if (action === 'forward') {
        if (process.platform === 'darwin') {
          await runScript('tell application "System Events" to keystroke "]" using command down')
          return 'Navigated forward'
        }
        return 'Browser forward requires macOS'
      }

      if (action === 'scroll') {
        const dir = text || 'down'
        const script = `tell application "System Events" to scroll ${dir} 5`
        try {
          await runScript(script)
          return `Scrolled ${dir}`
        } catch {
          return `Scroll ${dir} failed`
        }
      }

      return `Unknown browser action: ${action}`
    }

    // ── File Processor ────────────────────────────────────────────────────────
    case 'file_processor': {
      const action = (params.action || 'read').toLowerCase()
      const filePath = params.file_path || params.path || ''
      const question = params.question || ''
      const outputFormat = params.output_format || params.format || 'txt'

      if (!filePath) return 'No file path provided'
      const safeFilePath = safeHomePath(filePath)
      if (!safeFilePath) return 'Permission denied: path must be inside your home directory (dotfiles are blocked)'

      if (action === 'read') {
        try {
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const isText = ['txt', 'md', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'html', 'css', 'yaml', 'yml', 'toml', 'xml', 'sh', 'sql', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'swift', 'kt', 'php'].includes(ext)
          if (isText) {
            return readFileSync(safeFilePath, 'utf8').slice(0, 3000).trim() || '(empty file)'
          }
          // PDF
          if (ext === 'pdf') {
            try {
              const { stdout } = await runSpawn('pdftotext', [safeFilePath, '-'], { timeout: 8000 })
              return stdout.trim().slice(0, 3000) || '(empty PDF)'
            } catch {
              return `PDF found at ${filePath} but could not extract text. Install poppler: brew install poppler`
            }
          }
          // DOCX
          if (ext === 'docx') {
            try {
              const { stdout } = await runSpawn('pandoc', [safeFilePath, '-t', 'plain'], { timeout: 8000 })
              return stdout.trim().slice(0, 3000) || '(empty document)'
            } catch {
              return `DOCX found at ${filePath} but could not extract text. Install pandoc: brew install pandoc`
            }
          }
          return `File: ${filePath} (type: .${ext}) — reading not implemented for this format`
        } catch {
          return `Cannot read file: ${filePath}`
        }
      }

      if (action === 'summarize') {
        try {
          const content = readFileSync(safeFilePath, 'utf8').slice(0, 3000).trim()
          if (!content) return `(empty file: ${filePath})`
          const lines = content.split('\n')
          const wordCount = content.split(/\s+/).length
          const header = lines.find(l => l.startsWith('#'))
          return `File: ${filePath}\nSize: ${wordCount} words, ${lines.length} lines\n${header ? `Title: ${header}\n` : ''}Preview: ${content.slice(0, 500)}`
        } catch {
          return `Cannot read file: ${filePath}`
        }
      }

      if (action === 'ask') {
        if (!question) return 'No question provided'
        try {
          const content = readFileSync(safeFilePath, 'utf8').slice(0, 3000).trim()
          if (!content) return `(empty file: ${filePath})`
          return `File: ${filePath}\nQuestion: ${question}\n\nContent preview:\n${content.slice(0, 2000)}\n\nFor full analysis, use JARVIS with a vision or code model.`
        } catch {
          return `Cannot read file: ${filePath}`
        }
      }

      if (action === 'convert') {
        if (!outputFormat) return 'No output format specified (txt, md, json, csv, html)'
        try {
          const content = readFileSync(safeFilePath, 'utf8').trim()
          const baseName = filePath.replace(/\.[^/.]+$/, '')
          const outputPath = `${baseName}.${outputFormat}`
          const { writeFileSync: wfs } = await import('fs')
          if (outputFormat === 'json') {
            wfs(outputPath, JSON.stringify({ source: filePath, content }, null, 2))
          } else if (outputFormat === 'html') {
            wfs(outputPath, `<!DOCTYPE html><html><head><title>${baseName}</title></head><body><pre>${content.replace(/</g, '&lt;')}</pre></body></html>`)
          } else {
            wfs(outputPath, content)
          }
          return `Converted to ${outputPath}`
        } catch {
          return `Cannot convert file: ${filePath}`
        }
      }

      return `Unknown file action: ${action}`
    }

    // ── Hardware Monitor ──────────────────────────────────────────────────────
    case 'hardware_monitor': {
      // Cross-platform hardware telemetry (Mark-LIV system_monitor parity).
      const { getSystemSnapshot } = await import('@/lib/system-info')
      const reportType = (params.report_type || 'full').toLowerCase()
      const snap = getSystemSnapshot()

      if (reportType === 'cpu') return `CPU: ${snap.cpu}% used`
      if (reportType === 'ram') return `RAM: ${snap.ram.usedGB}/${snap.ram.totalGB} GB (${snap.ram.pct}%)`
      if (reportType === 'disk') return `Disk: ${snap.disk.usedGB}/${snap.disk.totalGB} GB (${snap.disk.pct}%)`
      if (reportType === 'battery') {
        return snap.battery.present && snap.battery.pct !== null
          ? `Battery: ${snap.battery.pct}%${snap.battery.charging ? ' (charging)' : ''}`
          : 'No battery detected'
      }
      const batLine = snap.battery.present && snap.battery.pct !== null
        ? `\nBattery: ${snap.battery.pct}%${snap.battery.charging ? ' (charging)' : ''}`
        : ''
      return `CPU: ${snap.cpu}% used\nRAM: ${snap.ram.usedGB}/${snap.ram.totalGB} GB (${snap.ram.pct}%)\nDisk: ${snap.disk.usedGB}/${snap.disk.totalGB} GB (${snap.disk.pct}%)${batLine}\nUptime: ${Math.round(snap.uptimeSec / 3600)}h`
    }

    // ── System Control (extended) ─────────────────────────────────────────────
    case 'system_control': {
      const action = (params.action || '').toLowerCase()
      const value = params.value || ''

      if (action === 'set-brightness' || action === 'set_brightness') {
        const level = parseInt(value) || 50
        const fraction = Math.max(0, Math.min(100, level)) / 100
        try {
          await runSpawn('brightness', [String(fraction)], { timeout: 5000 })
          return `Brightness set to ${level}%`
        } catch {
          return 'Brightness control requires the "brightness" CLI tool (brew install brightness)'
        }
      }

      if (action === 'get-brightness' || action === 'get_brightness') {
        try {
          const { stdout } = await execAsync('brightness -l 2>/dev/null | grep display0 | awk \'{print $2}\'', { timeout: 5000 })
          const pct = Math.round(parseFloat(stdout.trim()) * 100) || 50
          return `Brightness: ${pct}%`
        } catch {
          return 'Brightness detection requires the "brightness" CLI tool'
        }
      }

      if (action === 'toggle-wifi' || action === 'toggle_wifi') {
        try {
          const { stdout } = await execAsync('networksetup -getairportpower en0', { timeout: 5000 })
          const isOn = stdout.toLowerCase().includes('on')
          await runSpawn('networksetup', ['-setairportpower', 'en0', isOn ? 'off' : 'on'], { timeout: 5000 })
          return `WiFi turned ${isOn ? 'off' : 'on'}`
        } catch {
          return 'WiFi toggle failed'
        }
      }

      if (action === 'wifi-status' || action === 'wifi_status') {
        try {
          const { stdout } = await execAsync('networksetup -getairportpower en0', { timeout: 5000 })
          return `WiFi: ${stdout.trim()}`
        } catch {
          return 'WiFi status unavailable'
        }
      }

      if (action === 'toggle-bluetooth' || action === 'toggle_bluetooth') {
        try {
          const { stdout } = await execAsync('blueutil --power', { timeout: 5000 })
          const current = parseInt(stdout.trim(), 10)
          await runSpawn('blueutil', ['--power', current ? '0' : '1'], { timeout: 5000 })
          return `Bluetooth turned ${current ? 'off' : 'on'}`
        } catch {
          return 'Bluetooth toggle requires blueutil: brew install blueutil'
        }
      }

      if (action === 'sleep') {
        try {
          await execAsync('pmset sleepnow', { timeout: 5000 })
          return 'Computer going to sleep'
        } catch {
          return 'Sleep command failed'
        }
      }

      if (action === 'restart') {
        try {
          await execAsync('sudo shutdown -r now', { timeout: 5000 })
          return 'Computer restarting'
        } catch {
          return 'Restart requires sudo privileges'
        }
      }

      if (action === 'shutdown') {
        try {
          await execAsync('sudo shutdown -h now', { timeout: 5000 })
          return 'Computer shutting down'
        } catch {
          return 'Shutdown requires sudo privileges'
        }
      }

      if (action === 'battery') {
        try {
          const { stdout } = await execAsync('pmset -g batt', { timeout: 5000 })
          return `Battery:\n${stdout.trim()}`
        } catch {
          return 'Battery info unavailable'
        }
      }

      if (action === 'screenshot') {
        const filename = `screenshot-${Date.now()}.png`
        const outPath = join(process.env.HOME || '', 'Desktop', filename)
        try {
          await runSpawn('screencapture', ['-x', outPath], { timeout: 8000 })
          return `Screenshot saved to ~/Desktop/${filename}`
        } catch {
          return 'Screenshot failed'
        }
      }

      return `Unknown system action: ${action}`
    }

    // ── Setup Wizard ──────────────────────────────────────────────────────────
    case 'setup_wizard': {
      const action = (params.action || 'status').toLowerCase()

      if (action === 'status') {
        const stateFile = join(process.env.HOME || '', '.ghostforge', 'setup-state.json')
        try {
          const { readFileSync: rf } = await import('fs')
          const state = JSON.parse(rf(stateFile, 'utf8'))
          const completed = Array.isArray(state.completedSteps) ? state.completedSteps.length : 0
          return `Setup: ${completed}/6 steps completed${completed === 0 ? ' (first run)' : ''}`
        } catch {
          return 'Setup: 0/6 steps completed (first run)'
        }
      }

      if (action === 'steps') {
        const steps = [
          { id: 'api-key', title: 'API Key', required: true },
          { id: 'voice-model', title: 'Voice Model', required: false },
          { id: 'language', title: 'Language', required: true },
          { id: 'assistant-name', title: 'Assistant Name', required: false },
          { id: 'auto-start', title: 'Auto-Start', required: false },
          { id: 'first-run', title: 'Welcome', required: true },
        ]
        const stateFile = join(process.env.HOME || '', '.ghostforge', 'setup-state.json')
        let completed: string[] = []
        try {
          const { readFileSync: rf } = await import('fs')
          const state = JSON.parse(rf(stateFile, 'utf8'))
          completed = Array.isArray(state.completedSteps) ? state.completedSteps : []
        } catch {}
        return steps.map(s =>
          `${completed.includes(s.id) ? '✓' : '○'} ${s.title}${s.required ? ' (required)' : ''}`
        ).join('\n')
      }

      if (action === 'complete-step' || action === 'complete_step') {
        const stepId = params.step_id || ''
        if (!stepId) return 'No step ID provided'
        const stateFile = join(process.env.HOME || '', '.ghostforge', 'setup-state.json')
        const dir = join(process.env.HOME || '', '.ghostforge')
        try {
          const { readFileSync: rf, writeFileSync: wfs, mkdirSync: ms } = await import('fs')
          const { existsSync: es } = await import('fs')
          if (!es(dir)) ms(dir, { recursive: true })
          let state: { completedSteps: string[]; configs: Record<string, unknown> } = { completedSteps: [], configs: {} }
          if (es(stateFile)) state = JSON.parse(rf(stateFile, 'utf8'))
          if (!state.completedSteps.includes(stepId)) state.completedSteps.push(stepId)
          if (params.config) state.configs[stepId] = JSON.parse(params.config as string || '{}')
          wfs(stateFile, JSON.stringify(state, null, 2))
          return `Step "${stepId}" marked as complete (${state.completedSteps.length}/6)`
        } catch {
          return `Could not save step: ${stepId}`
        }
      }

      if (action === 'is-first-run' || action === 'is_first_run') {
        const stateFile = join(process.env.HOME || '', '.ghostforge', 'setup-state.json')
        try {
          const { readFileSync: rf, existsSync: es } = await import('fs')
          if (!es(stateFile)) return 'Yes — first run'
          const state = JSON.parse(rf(stateFile, 'utf8'))
          const completed = Array.isArray(state.completedSteps) ? state.completedSteps.length : 0
          return completed === 0 ? 'Yes — first run' : 'No — setup partially or fully complete'
        } catch {
          return 'Yes — first run'
        }
      }

      return `Unknown setup action: ${action}`
    }

    // ── Local voice pipeline (STT/TTS/wake) ─────────────────────────────────
    case 'voice_status': {
      const { formatVoiceStatus } = await import('@/lib/voice')
      return formatVoiceStatus()
    }

    case 'voice_tts': {
      const { localTts } = await import('@/lib/voice')
      const text = String(params.text || '').trim()
      if (!text) return 'No text to speak.'
      const result = await localTts(text, { voice: params.voice || undefined, engine: params.engine || undefined })
      if (result.error || !result.audio) return `Local TTS unavailable: ${result.error || 'no audio'}`
      const wavPath = join(tmpdir(), `gfai-local-tts-${Date.now()}.wav`)
      const { writeFile: wf } = await import('fs/promises')
      await wf(wavPath, result.audio)
      await runSpawn('afplay', [wavPath], { timeout: 30000 }).catch(() => {})
      await rm(wavPath).catch(() => {})
      return `Spoke "${text.slice(0, 60)}" through the local voice pipeline (${result.engine}).`
    }

    // ── Semantic memory (vector recall per user) ─────────────────────────────
    case 'memory_remember': {
      const { rememberMemory } = await import('@/lib/semantic-memory')
      const username = currentUser?.username || 'admin'
      const text = String(params.text || params.fact || '').trim()
      if (!text) return 'Nothing to remember — pass a text/fact.'
      const { embedded, embeddingModel } = await rememberMemory(username, text, params.category || 'general')
      return `Remembered (${embedded ? `embedded via ${embeddingModel}` : 'keyword-stored — install Ollama for semantic recall'}).`
    }

    case 'memory_recall': {
      const { recallMemory } = await import('@/lib/semantic-memory')
      const username = currentUser?.username || 'admin'
      const query = String(params.query || '').trim()
      if (!query) return 'What should I recall? Pass a query.'
      const k = Math.min(parseInt(params.topK || '5', 10) || 5, 10)
      const { results, method } = await recallMemory(username, query, k)
      if (!results.length) return `No memory matches "${query}".`
      return `Memory (${method}):\n${results.map(r => `  • ${r.text}`).join('\n')}`
    }

    case 'memory_stats': {
      const { memoryStats } = await import('@/lib/semantic-memory')
      const username = currentUser?.username || 'admin'
      const s = await memoryStats(username)
      return `Semantic memory: ${s.count} fact${s.count === 1 ? '' : 's'} · embedding: ${s.embedding}${s.embeddingModel ? ` (${s.embeddingModel})` : ''}\n${Object.entries(s.categories).map(([c, n]) => `  • ${c}: ${n}`).join('\n')}`
    }

    // ── MCP interop (bundle server + community tools) ────────────────────────
    case 'mcp_status': {
      const { listMcpTools, mcpStderrTail } = await import('@/lib/mcp')
      try {
        const tools = await listMcpTools()
        return `MCP server online — ${tools.length} tools exposed:\n${tools.map(t => `  • ${t.name}${t.description ? ` — ${t.description.split('.')[0]}` : ''}`).join('\n')}`
      } catch (e) {
        const tail = mcpStderrTail().split('\n').filter(Boolean).slice(-2).join(' | ')
        return `MCP server unavailable: ${(e as Error).message}${tail ? ` (${tail})` : ''}`
      }
    }

    case 'mcp_call': {
      const { callMcpTool } = await import('@/lib/mcp')
      const tool = String(params.tool || params.name || '').trim()
      if (!tool) return 'MCP call needs a tool name.'
      const safeArgs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(params)) {
        if (k === 'tool' || k === 'name' || k === 'params') continue
        safeArgs[k] = v
      }
      if (params.params) {
        try {
          const nested = JSON.parse(String(params.params)) as Record<string, unknown>
          Object.assign(safeArgs, nested)
        } catch {}
      }
      try {
        return await callMcpTool(tool, safeArgs)
      } catch (e) {
        return `MCP call failed: ${(e as Error).message}`
      }
    }

    // ── Native desktop automation (nut.js → AppleScript/cliclick) ───────────
    case 'native_desktop': {
      const nutjs = await import('@/lib/nutjs.js').then(m => m as unknown as {
        nativeStatus(): { nutJs: boolean; reason: string | null; fallback: string }
        moveMouse(x: number, y: number): Promise<string>
        click(x: number, y: number, button?: string): Promise<string>
        typeText(text: string): Promise<string>
        pressKey(key: string): Promise<string>
        scroll(dir: string, amount: number): Promise<string>
      })
      const action = String(params.action || 'status').toLowerCase()
      if (action === 'status') {
        const s = nutjs.nativeStatus()
        return `native_desktop: nut.js ${s.nutJs ? 'active' : `not loaded (${s.reason})`} · fallback: ${s.fallback}`
      }
      if (action === 'move') return nutjs.moveMouse(parseInt(params.x || '0', 10), parseInt(params.y || '0', 10))
      if (action === 'click') return nutjs.click(parseInt(params.x || '0', 10), parseInt(params.y || '0', 10), params.button || 'left')
      if (action === 'type') return nutjs.typeText(String(params.text || ''))
      if (action === 'key') return nutjs.pressKey(String(params.key || 'enter'))
      if (action === 'scroll') return nutjs.scroll(String(params.direction || 'down'), parseInt(params.amount || '3', 10))
      return `Unknown native_desktop action: ${action}. Use status, move, click, type, key, scroll.`
    }

    // ── Mark-LIV engine (vendored JARVIS) ─────────────────────────────────
    case 'mark_liv': {
      // Runs a real Mark-LIV action through the bridge: { tool, args } (args = JSON string)
      const { runMarkLiv, markLivCatalog } = await import('@/lib/mark-liv-bridge')
      const { name, parameters } = parseMarkLivCall(params)
      if (!name || name === 'status' || name === 'list') {
        const catalog = await markLivCatalog()
        return catalog ? `Mark-LIV tools:\n${catalog}` : 'Mark-LIV bridge is not running and could not be started.'
      }
      return runMarkLiv(name, parameters)
    }

    default:
      return 'Unknown tool'
  }
}

// ── Tool result → spoken speech (no second AI call) ───────────────────────────

function analyzeClipboardText(text: string, action: string): string {
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '…' : text
  switch (action) {
    case 'translate':
      return `[Translate] Text (${text.length} chars): ${truncated.slice(0, 300)}`
    case 'summarize':
      return `[Summary] Text is ${text.length} characters. Preview: ${truncated.slice(0, 300)}`
    case 'explain':
      return `[Explain] Text (${text.length} chars): ${truncated.slice(0, 300)}`
    case 'fix':
      return `[Fix] Original (${text.length} chars): ${truncated.slice(0, 300)}`
    case 'improve':
      return `[Improve] Original (${text.length} chars): ${truncated.slice(0, 300)}`
    default:
      return `Clipboard (${text.length} chars): ${truncated.slice(0, 300)}`
  }
}

function formatToolSpeech(tool: string, result: string): string {
  const done = pickPersona('completion')
  const r = result.slice(0, 300)

  switch (tool) {
    case 'get_time':
      return r // already formatted like "It's 3:42 PM on Monday…"
    case 'get_weather':
      return r.split('\n')[0] || r // first line is the summary
    case 'get_system_info':
      return r.split('\n')[0] || `${done} Here's your system status.`
    case 'web_search':
    case 'google_search':
    case 'web_search_deep':
      return r.split('\n\n')[0]?.slice(0, 200) || `${done} Here's what I found.`
    case 'lock_screen':
      return 'Screen locked.'
    case 'take_screenshot':
      return r.includes('saved') || r.includes('captured')
        ? r.split('\n')[0]
        : `${done} Screenshot captured.`
    case 'mac_cleanup':
      return r.split('\n')[0] || `${done} System cleaned up.`
    case 'terminal_command':
    case 'execute_code':
      // Show first non-empty line of output
      return r.split('\n').find(l => l.trim()) ? r.split('\n').filter(l => l.trim()).slice(0, 2).join(' — ') : `${done} Command executed.`
    case 'open_app':
    case 'open_url':
      return r.startsWith('Error') ? r.slice(0, 120) : `${done} Opened.`
    case 'browser_control':
      return r.startsWith('Error') ? r.slice(0, 150) : r
    case 'play_music':
      return r || `${done} Music updated.`
    case 'set_volume':
      return r || `${done} Volume set.`
    case 'send_imessage':
    case 'send_teams_message':
    case 'send_slack_message':
    case 'send_whatsapp_message':
    case 'discord_message':
      return r.startsWith('Error') ? r.slice(0, 150) : `${done} Message sent.`
    case 'send_user_message':
      return r.startsWith('Error') ? r.slice(0, 150) : `Done. ${r}`
    case 'office_document':
      return r.startsWith('Error') ? r.slice(0, 150) : `Document ready. ${r.split('\n')[0]}`
    case 'career':
      return r.startsWith('Error') ? r.slice(0, 150) : r
    case 'set_reminder':
      return r || `${done} Reminder set.`
    case 'write_note':
      return r || `${done} Note saved.`
    case 'get_clipboard':
      return `Clipboard: ${r.slice(0, 150)}`
    case 'get_files':
      return r.split('\n').slice(0, 3).join(', ') + (r.split('\n').length > 3 ? '…' : '')
    case 'read_file':
      return `${done} Here's the file: ${r.slice(0, 200)}`
    case 'github_repos':
    case 'github_prs':
    case 'github_issues':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Done.`
    case 'copilot_ask':
      return r.slice(0, 250)
    case 'mac_control':
      return r.startsWith('Error') ? r.slice(0, 150) : `${done} Done.`
    case 'mouse_click':
    case 'mouse_move':
    case 'drag_mouse':
    case 'key_combo':
    case 'scroll':
    case 'type_text':
    case 'find_and_click':
    case 'focus_window':
      return r.startsWith('Error') ? r.slice(0, 150) : `${done}`
    case 'get_frontmost_app':
    case 'get_windows':
    case 'get_screen_info':
      return r.split('\n').slice(0, 2).join(' | ').slice(0, 200)
    case 'describe_screen':
      return r.slice(0, 250)
    case 'llmfit_recommend':
      return r.split('\n')[0]?.slice(0, 200) || `${done} Recommendation ready.`
    case 'list_local_models':
      return r.split('\n')[0]?.slice(0, 200) || `${done} Models listed.`
    case 'install_model':
      return r.slice(0, 200) || `${done} Installing model…`
    case 'set_goal':
    case 'list_goals':
      return r.slice(0, 200)
    case 'apply_design_md':
      return r.split('\n')[0] || `${done} DESIGN.md applied.`
    case 'list_design_md':
    case 'design_resources':
      return r.slice(0, 200)
    case 'vigolium_scan':
    case 'vigolium_agent':
      return r.split('\n')[0]?.slice(0, 200) || `${done} Scan initiated.`
    case 'open_interpreter':
    case 'jsrepl_run':
      return r.split('\n').filter(l => l.trim()).slice(0, 2).join(' — ').slice(0, 200) || `${done} Done.`
    case 'flight_finder':
      return r.split('\n')[1]?.slice(0, 200) || 'Google Flights is ready.'
    case 'youtube_control':
    case 'game_manager':
    case 'clipboard_analyze':
    case 'browser_automate':
    case 'file_processor':
    case 'hardware_monitor':
    case 'system_control':
    case 'setup_wizard':
      return r.split('\n').filter(l => l.trim()).slice(0, 2).join(' — ').slice(0, 200) || `${done}`
    case 'email_list':
    case 'email_search':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Emails listed.`
    case 'email_send':
    case 'email_reply':
    case 'email_mark_read':
    case 'email_star':
    case 'email_delete':
      return r.startsWith('Error') ? r.slice(0, 150) : `${done}`
    case 'email_read':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Email read.`
    case 'email_unread_count':
      return r || `${done}`
    case 'calendar_events':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Calendar checked.`
    case 'calendar_free_slots':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Free slots found.`
    case 'contacts_search':
    case 'contacts_by_phone':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Contacts found.`
    case 'ai_studio_list':
    case 'ai_studio_models':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done} Models listed.`
    case 'ai_studio_update':
    case 'ai_studio_test':
    case 'ai_studio_compare':
      return r.split('\n').slice(0, 3).join(' | ').slice(0, 200) || `${done}`
    default:
      return r.split('\n')[0]?.slice(0, 200) || `${done}`
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

interface JarvisRequest {
  message: string
  history?: Array<{ role: string; content: string }>
  memory?: Record<string, unknown>
  selectedProvider?: string
  selectedModel?: string
  persona?: string
  offlineMode?: boolean
  quickAction?: string
  confirmRisk?: boolean
  clientId?: string
  lang?: string        // optional client-detected language override
  platform?: string    // 'ios' | 'android' | 'mac' | 'windows' | 'linux'
}

// Pending danger-tool confirmations keyed by clientId — lets a confirmRisk
// follow-up execute the exact previously-blocked tool without re-running AI.
const pendingConfirmations = new Map<string, { tool: string; toolParams: Record<string, string> }>()

function rememberPendingConfirmation(clientId: string, tool: string, toolParams: Record<string, string>) {
  pendingConfirmations.set(clientId, { tool, toolParams })
  if (pendingConfirmations.size > 100) {
    const oldest = pendingConfirmations.keys().next().value
    if (oldest) pendingConfirmations.delete(oldest)
  }
}

interface AIResponse {
  speech: string
  tool: string | null
  toolParams: Record<string, string>
  emotion: string
  confidence?: number
}

interface JarvisResponsePayload {
  speech: string
  tool: string | null
  toolParams: Record<string, string>
  toolResult: string | null
  emotion: string
  confidence: number
  domain: string
  usedModel: string
  usedProvider: string
  risk: ReturnType<typeof assessRisk> | null
  detectedLang: string
  device: { isMobile: boolean; isMac: boolean }
  offline: boolean
  requiresConfirmation?: boolean
  clientId?: string
}

function acceptsEventStream(req: NextRequest) {
  return (req.headers.get('accept') || '').includes('text/event-stream')
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req)

  // ── Rate limiting: 30 req/min per IP ─────────────────────────────────────
  const rl = checkRateLimit(ip, 30, 60_000)
  if (!rl.allowed) {
    void auditLog({ level: 'security', event: 'rate_limited', ip, risk: 20 })
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: {
        'Retry-After': String(Math.ceil(rl.resetIn / 1000)),
        'X-RateLimit-Limit': String(rl.limit),
        'X-RateLimit-Remaining': '0',
      }},
    )
  }

  const userAgent = req.headers.get('user-agent') || undefined
  if (!isAuthorizedRequest(req)) {
    const tokenStatus = sessionTokenStatus(req.cookies.get(AUTH_COOKIE_NAME)?.value)
    if (tokenStatus === 'forged' && hasStableAuthSecret()) {
      // A tampered session cookie is an intrusion: log it and lock the PC
      void reportUnauthorizedAccess({ reason: 'jarvis: forged session token', ip, userAgent })
    } else {
      // Missing/expired session (e.g. a logged-out device) — log only
      void auditLog({ level: 'security', event: 'unauthorized_access_attempt', ip, userAgent, params: { tokenStatus }, risk: 60 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Current user (role + permissions) — resolves admin vs limited user ──
  const currentUser = await getCurrentUser(req)
  if (!currentUser) {
    // Validly signed token for a deleted/deactivated account
    void reportUnauthorizedAccess({ reason: 'jarvis: session for disabled or deleted account', ip, userAgent })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const speaker: Speaker = toSpeaker(currentUser, isOwner(currentUser))

  let body: JarvisRequest
  try { body = await req.json() } catch { body = { message: '' } }
  const { message: rawMessage, history = [], memory = {}, selectedProvider, selectedModel, persona, offlineMode = false, quickAction, confirmRisk = false, clientId: rawClientId, lang: clientLang, platform: clientPlatform } = body

  if (!rawMessage?.trim()) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  // ClientId for the confirm-risk flow — generate one when the client didn't send it
  const clientId = rawClientId || `${ip}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  // Sanitize client-sent history before it reaches the model: whitelist roles,
  // require string content, cap per-message and total size.
  const sanitizedHistory = (Array.isArray(history) ? history : [])
    .filter(h => h && typeof h === 'object' && ['user', 'assistant', 'system'].includes(String(h.role)) && typeof h.content === 'string')
    .map(h => ({ role: h.role as 'user' | 'assistant' | 'system', content: h.content.slice(0, 4000) }))
  let historyChars = 0
  const cappedHistory: typeof sanitizedHistory = []
  for (const h of sanitizedHistory) {
    if (historyChars + h.content.length > 50_000) break
    historyChars += h.content.length
    cappedHistory.push(h)
  }

  // Apply STT corrections — fix common misheard words before LLM sees them
  const message = applySttCorrections(rawMessage)

  const streamMode = acceptsEventStream(req)

  // Detect language from message content (server-side)
  const detectedLang = clientLang || detectMsgLanguage(message)

  // Detect device from User-Agent for device-aware tool filtering
  const ua = req.headers.get('user-agent') || ''
  const device = detectDeviceFromUA(ua)
  const isMac = process.platform === 'darwin'
  const isMobile = clientPlatform ? ['ios', 'android'].includes(clientPlatform) : device.isMobile

  // Identity comes from the login, not from client-sent memory
  memory.userName = speaker.name

  // Update memory with language preference if Arabic
  if (detectedLang === 'ar' && !memory.preferredLang) {
    memory.preferredLang = 'ar'
  }

  // NLP: learn phrases from this message (simple running list)
  const words = message.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
  const existing = (memory.commonPhrases as string[] | undefined) || []
  const newPhrases = [...new Set([...existing, ...words.slice(0, 2)])].slice(-20) // keep last 20
  memory.commonPhrases = newPhrases

  // Log access
  void auditLog({
    level: 'access',
    event: 'jarvis_request',
    result: message.slice(0, 80),
    ip: req.headers.get('x-forwarded-for') || 'local',
    params: { username: speaker.username },
  })

  // ── Domain classification (fast, keyword-based) ────────────────────────────
  const domain = classifyDomain(message)

  const modelOpts = {
    activeProvider: selectedProvider || undefined,
    activeModel: selectedModel || undefined,
    offline: offlineMode,
    task: domain === 'code' || domain === 'github' || domain === 'copilot' ? 'code' : 'tools',
  }

  let usedProvider = ''
  let usedModel    = ''

  async function aiGenerate(opts: { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number }): Promise<string> {
    const result = await generateWithFallback(opts, modelOpts)
    usedProvider = result.usedProvider
    usedModel    = result.usedModel
    return result.text
  }

  const runJarvis = async (
    emit?: (payload: Record<string, unknown>) => void,
  ): Promise<JarvisResponsePayload> => {
    let aiResp: AIResponse = { speech: pickPersona('processing'), tool: null, toolParams: {}, emotion: 'thinking', confidence: 80 }

    // ── Confirm-risk short-circuit ──────────────────────────────────────────
    // If the client confirms a previously-blocked danger tool, execute the
    // exact stored tool+params directly — no AI regeneration.
    const pending = confirmRisk && clientId ? pendingConfirmations.get(clientId) : null
    if (pending) {
      pendingConfirmations.delete(clientId)
      const pendingRisk = assessRisk(pending.tool, pending.toolParams)
      void auditLog({
        level: 'danger',
        event: 'tool_confirmed',
        tool: pending.tool,
        params: pending.toolParams,
        risk: pendingRisk.risk,
        blocked: false,
      })
      let pendingToolResult: string | null = null
      try {
        const neededPerm = permissionForTool(pending.tool)
        if (neededPerm && !hasPermission(currentUser, neededPerm)) {
          pendingToolResult = `Permission denied — your account lacks "${permissionForTool(pending.tool)}"`
        } else {
          pendingToolResult = await executeTool(pending.tool, pending.toolParams, currentUser)
        }
        void auditLog({
          level: 'info',
          event: 'tool_executed',
          tool: pending.tool,
          params: pending.toolParams,
          result: (pendingToolResult || '').slice(0, 200),
          risk: pendingRisk.risk,
        })
      } catch (e) {
        pendingToolResult = `Error: ${(e as Error).message?.slice(0, 200)}`
      }
      const confirmedSpeech = pendingToolResult && pendingToolResult !== 'Done'
        ? formatToolSpeech(pending.tool, pendingToolResult)
        : `Confirmed. ${pending.tool.replace(/_/g, ' ')} executed.`
      const confirmedPayload: JarvisResponsePayload = {
        speech: stripMarkdownForTTS(confirmedSpeech),
        tool: pending.tool,
        toolParams: pending.toolParams,
        toolResult: pendingToolResult,
        emotion: 'neutral',
        confidence: 100,
        domain,
        usedModel,
        usedProvider,
        risk: pendingRisk,
        detectedLang,
        device: { isMobile, isMac },
        offline: offlineMode,
        clientId,
      }
      emit?.({
        type: 'response',
        speech: confirmedPayload.speech,
        tool: confirmedPayload.tool,
        toolParams: confirmedPayload.toolParams,
        emotion: confirmedPayload.emotion,
        confidence: confirmedPayload.confidence,
        domain,
        risk: confirmedPayload.risk,
        requiresConfirmation: false,
        clientId,
      })
      emit?.({
        type: 'tool_done',
        toolResult: pendingToolResult,
        speech: confirmedPayload.speech,
      })
      return confirmedPayload
    }

    // Mark-LIV quick actions (registry mirrors the vendored engine's tools)
    const markLivAction = quickAction ? getMarkLivAction(quickAction) : undefined
    const directAction = quickAction ? getJarvisQuickAction(quickAction) : undefined

    if (directAction) {
      const toolParams = { ...directAction.params } as Record<string, string>
      if (directAction.id === 'weather' && !toolParams.city) {
        toolParams.city = String((memory.preferences as { city?: string } | undefined)?.city || 'Amman')
      }
      aiResp = {
        speech: `Running ${directAction.label.replace(/^\S+\s*/, '')}.`,
        tool: directAction.tool ?? null,
        toolParams,
        emotion: 'processing',
        confidence: 100,
      }
    } else if (markLivAction) {
      const resolved = resolveMarkLivTool(markLivAction.id, message)
      aiResp = {
        speech: markLivActionHint(markLivAction.id)?.split('\n')[0] ?? `Running ${markLivAction.label}.`,
        tool: resolved?.tool ?? 'mark_liv',
        toolParams: (resolved?.toolParams ?? { action: 'run', id: markLivAction.id }) as Record<string, string>,
        emotion: 'processing',
        confidence: 100,
      }
    } else try {
      const isThinkingModel = (usedModel || selectedModel || '').toLowerCase().includes('qwen3') ||
        (usedModel || selectedModel || '').toLowerCase().includes('deepseek-r1') ||
        (selectedProvider === 'ollama')
      const maxTok = isThinkingModel ? 1200 : 320

      const text = await aiGenerate({
        system: buildSystemPrompt(memory, domain, {
          lang: detectedLang,
          isMobile,
          isMac,
          bypassPlanning: hasBypassPhrase(message),
          persona,
          speaker,
        }),
        messages: [
          ...cappedHistory.slice(-5).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
          { role: 'user' as const, content: message },
        ],
        maxTokens: maxTok,
      })

      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '')
        .trim()

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          aiResp = { ...aiResp, ...parsed }

          // Check for empty or persona-only speech (acknowledge phrases used without tool)
          const isAcknowledgeOnly = PERSONA_POOLS.acknowledge.includes((aiResp.speech || '').trim())
          const isProcessingOnly = PERSONA_POOLS.processing.includes((aiResp.speech || '').trim())
          const isInternalReasoning =
            aiResp.speech?.includes('We need to respond') ||
            aiResp.speech?.includes('According to tools') ||
            aiResp.speech?.includes('The user wants to') ||
            aiResp.speech?.includes('I should') ||
            aiResp.speech?.includes('Let me think') ||
            aiResp.speech?.startsWith('<think')

          if (!aiResp.speech?.trim() || ((isAcknowledgeOnly || isProcessingOnly) && !aiResp.tool) || isInternalReasoning) {
            // Try text outside the JSON first
            const outsideJson = cleaned.replace(/\{[\s\S]*\}/, '').trim()
            if (outsideJson && outsideJson.length > 10) {
              aiResp.speech = outsideJson.slice(0, 300)
            } else {
              // Generate contextual fallback based on message type
              aiResp.speech = generateContextualFallback(message, detectedLang)
            }
          }
        } catch {
          const fallback = cleaned.replace(/\{[\s\S]*\}/, '').trim()
          aiResp.speech = fallback || cleaned.slice(0, 300) || generateContextualFallback(message, detectedLang)
        }
      } else {
        aiResp.speech = cleaned.slice(0, 300) || generateContextualFallback(message, detectedLang)
      }
    } catch (e) {
      const msg = String(e)
      aiResp = {
        speech: msg.toLowerCase().includes('no ai providers') || msg.toLowerCase().includes('all ai providers')
          ? 'All AI providers failed. Please check your API keys or try again later.'
          : `${pickPersona('error')} ${msg.slice(0, 60)}`,
        tool: null,
        toolParams: {},
        emotion: 'alert',
        confidence: 0,
      }
    }

    let toolResult: string | null = null
    let riskAssessment: ReturnType<typeof assessRisk> | null = null

    if (aiResp.tool && aiResp.tool !== 'null') {
      const risk = assessRisk(aiResp.tool, aiResp.toolParams || {})
      riskAssessment = risk

      void auditLog({
        level: risk.level === 'danger' ? 'danger' : risk.level === 'warn' ? 'warn' : 'info',
        event: 'tool_request',
        tool: aiResp.tool,
        params: aiResp.toolParams,
        risk: risk.risk,
        blocked: risk.level === 'danger' && !confirmRisk,
      })

      if ((risk.level === 'danger' || risk.requires_confirmation) && !confirmRisk) {
        rememberPendingConfirmation(clientId, aiResp.tool, aiResp.toolParams || {})
        const blockedPayload: JarvisResponsePayload = {
          speech: risk.level === 'danger'
            ? `I've detected a high-risk operation: ${risk.reason} Please confirm if you want me to proceed.`
            : `${risk.reason.replace(/\.$/, '')}. Say "confirm" and I'll go ahead.`,
          tool: aiResp.tool,
          toolParams: aiResp.toolParams || {},
          toolResult: null,
          emotion: 'alert',
          confidence: 95,
          domain,
          usedModel,
          usedProvider,
          requiresConfirmation: true,
          risk: riskAssessment,
          detectedLang,
          device: { isMobile, isMac },
          offline: offlineMode,
          clientId,
        }
        emit?.({
          type: 'response',
          speech: blockedPayload.speech,
          tool: blockedPayload.tool,
          toolParams: blockedPayload.toolParams,
          emotion: blockedPayload.emotion,
          confidence: blockedPayload.confidence,
          domain,
          risk: blockedPayload.risk,
          requiresConfirmation: true,
          clientId,
        })
        return blockedPayload
      }
    }

    emit?.({
      type: 'response',
      speech: aiResp.speech,
      tool: aiResp.tool ?? null,
      toolParams: aiResp.toolParams || {},
      emotion: aiResp.emotion || 'neutral',
      confidence: aiResp.confidence ?? 80,
      domain,
      risk: riskAssessment,
      requiresConfirmation: false,
    })

    if (aiResp.tool && aiResp.tool !== 'null') {
      // ── Permission gate — non-admin users only get their allowed tools ──
      const neededPerm = permissionForTool(aiResp.tool)
      if (neededPerm && !hasPermission(currentUser, neededPerm)) {
        void auditLog({
          level: 'warn',
          event: 'tool_denied',
          tool: aiResp.tool,
          params: { ...aiResp.toolParams, username: speaker.username },
          ip: req.headers.get('x-forwarded-for') || 'local',
          risk: 40,
        })
        if (PRIVILEGED_PERMISSIONS.has(neededPerm)) {
          // Restricted user reaching for system control — treat as intrusion
          void reportUnauthorizedAccess({ reason: `jarvis: ${speaker.username} attempted privileged tool without "${neededPerm}"`, tool: aiResp.tool, username: speaker.username, ip, userAgent })
        }
        const deniedPayload: JarvisResponsePayload = {
          speech: `I can't do that — your account doesn't have permission for "${aiResp.tool.replace(/_/g, ' ')}". Ask an administrator to grant this permission.`,
          tool: null,
          toolParams: {},
          toolResult: null,
          emotion: 'neutral',
          confidence: 90,
          domain,
          usedModel,
          usedProvider,
          risk: null,
          detectedLang,
          device: { isMobile, isMac },
          offline: offlineMode,
          clientId,
        }
        emit?.({
          type: 'response',
          speech: deniedPayload.speech,
          tool: null,
          toolParams: {},
          emotion: 'neutral',
          confidence: 90,
          domain,
          clientId,
        })
        return deniedPayload
      }

      toolResult = await executeTool(aiResp.tool, aiResp.toolParams || {}, currentUser)

      if (riskAssessment) {
        void auditLog({
          level: 'info',
          event: 'tool_executed',
          tool: aiResp.tool,
          params: aiResp.toolParams,
          result: (toolResult || '').slice(0, 200),
          risk: riskAssessment.risk,
        })
      }

      if (toolResult && toolResult !== 'Done') {
        aiResp.speech = formatToolSpeech(aiResp.tool, toolResult)
      }

      emit?.({
        type: 'tool_done',
        toolResult,
        speech: aiResp.speech,
      })
    }

    return {
      speech: stripMarkdownForTTS(aiResp.speech || ''),
      tool: aiResp.tool ?? null,
      toolParams: aiResp.toolParams || {},
      toolResult,
      emotion: aiResp.emotion || 'neutral',
      confidence: aiResp.confidence ?? 80,
      domain,
      usedModel,
      usedProvider,
      risk: riskAssessment,
      detectedLang,
      device: { isMobile, isMac },
      offline: offlineMode,
      clientId,
    }
  }

  if (!streamMode) {
    return NextResponse.json(await runJarvis())
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      try {
        send({ type: 'ack' })  // silent thinking signal — no phrase shown or spoken
        const result = await runJarvis(send)
        send({
          type: 'done',
          usedModel: result.usedModel,
          usedProvider: result.usedProvider,
          domain: result.domain,
          detectedLang: result.detectedLang,
          offline: result.offline,
        })
      } catch {
        send({
          type: 'response',
          speech: 'Systems error. Please try again.',
          tool: null,
          toolParams: {},
          emotion: 'alert',
          confidence: 0,
        })
        send({
          type: 'done',
          usedModel,
          usedProvider,
          domain,
          detectedLang,
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
