import { NextRequest, NextResponse } from 'next/server'
import { generateWithFallback } from '@/lib/ai'
import { auditLog, assessRisk } from '@/lib/audit'
import { checkRateLimit, getClientIP } from '@/lib/ratelimit'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readdir, stat, rm } from 'fs/promises'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'

const execAsync = promisify(exec)

// ── Tool catalog ──────────────────────────────────────────────────────────────

// Domain-filtered tool catalogs — only send relevant tools per domain (saves ~60% prompt tokens)
const TOOLS_BY_DOMAIN: Record<string, string> = {
  weather:     '- get_weather { city } | - get_time | - web_search { query }',
  time:        '- get_time | - set_reminder { title, notes? }',
  system:      '- get_system_info | - mac_cleanup | - terminal_command { command } | - execute_code { language, code }',
  music:       '- play_music { action, app?, query? } | - set_volume { level } | - open_app { app }',
  messaging:   '- send_imessage { contact, message } | - send_teams_message { contact, message } | - send_slack_message { channel, message } | - send_whatsapp_message { contact, message } | - discord_message { message, channel? }',
  search:      '- web_search { query } | - web_search_deep { query } | - google_search { query }',
  code:        '- execute_code { language, code } | - terminal_command { command } | - github_repos | - github_prs { repo? } | - github_issues { repo?, action? } | - open_interpreter { prompt, model? } | - jsrepl_run { code, language? }',
  files:       '- get_files { path? } | - read_file { path } | - write_note { note } | - take_screenshot { filename? }',
  reminder:    '- set_reminder { title, notes? } | - write_note { note } | - set_goal { goal, deadline? } | - list_goals',
  mac_control: '- mac_control { script } | - mouse_click { x, y, button? } | - mouse_move { x, y } | - drag_mouse { fromX,fromY,toX,toY } | - key_combo { keys } | - scroll { direction, amount?, x?, y? } | - focus_window { app } | - get_windows | - get_frontmost_app | - type_text { text } | - find_and_click { label, app? } | - lock_screen | - set_volume { level }',
  vision:      '- describe_screen | - take_screenshot { filename? } | - get_screen_info',
  github:      '- github_repos | - github_prs { repo? } | - github_issues { repo?, action?, title?, body? }',
  copilot:     '- copilot_ask { question }',
  lock:        '- lock_screen',
  screenshot:  '- take_screenshot { filename? } | - describe_screen',
  math:        '- execute_code { language: "python", code }',
  general:     '- get_time | - get_weather { city } | - web_search { query } | - open_app { app } | - open_url { url } | - get_system_info | - mac_control { script } | - terminal_command { command } | - lock_screen | - take_screenshot | - set_volume { level } | - play_music { action } | - set_reminder { title } | - get_files | - read_file { path } | - github_repos | - copilot_ask { question } | - llmfit_recommend | - list_design_md | - design_resources { category? } | - vigolium_scan { target } | - apply_design_md { site }',
  design:      '- apply_design_md { site } | - list_design_md | - design_resources { category? }',
  security:    '- vigolium_scan { target, strategy? } | - vigolium_agent { target, mode? } | - terminal_command { command }',
}

// System prompt cache — keyed by domain+lang+device to avoid rebuild on every request
const _promptCache = new Map<string, { prompt: string; ts: number }>()
const PROMPT_CACHE_TTL = 60_000 // 1 minute

// ── Domain classifier ─────────────────────────────────────────────────────────

type Domain =
  | 'weather' | 'time' | 'system' | 'music' | 'messaging' | 'search'
  | 'code' | 'math' | 'files' | 'reminder' | 'mac_control' | 'vision'
  | 'github' | 'copilot' | 'lock' | 'screenshot' | 'general'

const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  weather:     ['weather','temperature','forecast','rain','sunny','cold','hot','humidity','wind','storm','degrees'],
  time:        ['time','date','day','clock','today','tomorrow','calendar','when','morning','evening'],
  system:      ['cpu','ram','memory','battery','disk','system','performance','process','storage','uptime','sysinfo','clean','cleanup','free','optimize','temp files','kill process','boost'],
  music:       ['play','music','song','spotify','pause','next track','previous','playlist','artist','album','volume'],
  messaging:   ['message','send','teams','slack','whatsapp','imessage','email','contact','chat','text','dm'],
  search:      ['search','find','look up','google','what is','who is','news','latest','tell me about','explain'],
  code:        ['code','script','function','debug','error','compile','git','github','pr','commit','branch','repo','bug','run','execute','python','javascript','node','bash'],
  math:        ['calculate','math','add','subtract','multiply','divide','percent','equals','how much','sum','average'],
  files:       ['file','folder','directory','open','read','write','save','delete','copy','list files','path'],
  reminder:    ['remind','reminder','remember','note','todo','task','schedule','alarm','alert me'],
  mac_control: ['click','drag','scroll','keyboard','shortcut','lock','screenshot','volume','window','focus','move cursor'],
  vision:      ['see','look','camera','webcam','what do you see','describe','visual','screen content'],
  github:      ['github','repo','repository','pull request','issue','commit','branch','fork'],
  copilot:     ['copilot','gh copilot','suggest command','github copilot','ask copilot'],
  lock:        ['lock screen','lock the screen','lock computer','lock mac'],
  screenshot:  ['screenshot','capture screen','take screenshot'],
  general:     [],
}

const DOMAIN_EXTRA_GUIDANCE: Partial<Record<Domain, string>> = {
  weather:     'You have real weather data from wttr.in. State temperature, conditions, and one useful tip.',
  time:        'Give exact time and date. Mention day of week. No filler.',
  system:      'Report CPU%, battery%, and RAM accurately. Flag anything concerning.',
  music:       'Confirm what action you\'re taking. Name the app being used.',
  messaging:   'Confirm recipient name and message preview. Warn if app may not be running.',
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
  options?: { lang?: string; isMobile?: boolean; isMac?: boolean },
): string {
  const userName = (memory.userName as string) || 'sir'
  const lang = options?.lang || 'en'
  const isMobile = options?.isMobile ?? false
  const isMac = options?.isMac ?? true

  // Cache key — stable per domain/lang/device (memory excluded, injected separately)
  const cacheKey = `${domain}|${lang}|${isMac}|${isMobile}`
  const cached = _promptCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) {
    // Re-inject dynamic memory slice (small)
    return cached.prompt.replace('__MEMORY__', buildMemorySlice(memory, userName, lang))
  }

  const domainGuidance = domain && DOMAIN_EXTRA_GUIDANCE[domain]
    ? `\nDOMAIN HINT: ${DOMAIN_EXTRA_GUIDANCE[domain]}`
    : ''

  const langInstructions = lang === 'ar'
    ? `LANGUAGE: Respond in Arabic. Address as "سيدي".`
    : lang !== 'en'
      ? `LANGUAGE: Respond in ${lang.toUpperCase()}.`
      : ''

  const deviceGuidance = isMobile
    ? `DEVICE: mobile — skip mac_control/AppleScript tools.`
    : isMac
      ? `DEVICE: Mac — all tools available.`
      : `DEVICE: non-Mac — no mac_control/AppleScript.`

  const toolList = TOOLS_BY_DOMAIN[domain || 'general'] || TOOLS_BY_DOMAIN.general

  const prompt = `You are G.F.A.I. — GhostForge AI, JARVIS-style personal assistant.
Intelligent, loyal, slightly witty. NOT a chatbot — you actually execute things.
${langInstructions ? langInstructions + '\n' : ''}${deviceGuidance}${domainGuidance}
USER: __MEMORY__

TOOLS: ${toolList}

OUTPUT: valid JSON only, starting with '{':
{"speech":"1-2 spoken sentences","tool":null,"toolParams":{},"emotion":"neutral","confidence":95}
- "tool": null if no tool needed, else exact tool name
- speech: natural, brief, JARVIS-style. Contractions ok. Address as "sir" unless named.
- NEVER output thoughts/reasoning — JSON only`

  _promptCache.set(cacheKey, { prompt, ts: Date.now() })
  return prompt.replace('__MEMORY__', buildMemorySlice(memory, userName, lang))
}

function buildMemorySlice(memory: Record<string, unknown>, userName: string, lang: string): string {
  // Only send relevant memory fields — not the entire object
  const parts: string[] = []
  if (userName !== 'sir') parts.push(`name=${userName}`)
  if (memory.preferredLang && memory.preferredLang !== lang) parts.push(`lang=${memory.preferredLang}`)
  if (memory.speakingStyle) parts.push(`style=${memory.speakingStyle}`)
  const phrases = memory.commonPhrases as string[] | undefined
  if (phrases?.length) parts.push(`phrases=[${phrases.slice(-3).join(',')}]`)
  return parts.length ? `{${parts.join(', ')}}` : '{}'
}

// ── AppleScript runner ────────────────────────────────────────────────────────

async function runScript(script: string): Promise<string> {
  const tmpPath = join(tmpdir(), `gfai-${Date.now()}.scpt`)
  try {
    await writeFile(tmpPath, script, 'utf8')
    const { stdout } = await execAsync(`osascript "${tmpPath}"`, { timeout: 15000 })
    return stdout.trim() || 'Done'
  } catch (e: unknown) {
    return `Error: ${(e as { stderr?: string; message?: string }).stderr || (e as Error).message || 'Unknown error'}`
  } finally {
    await unlink(tmpPath).catch(() => {})
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

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(tool: string, params: Record<string, string>): Promise<string> {
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
    case 'google_search':
      return webSearch(params.query || '')

    case 'mac_control':
      return runScript(params.script || '')

    case 'open_app': {
      const app = (params.app || '').replace(/"/g, '\\"')
      try {
        await execAsync(`open -a "${app}"`, { timeout: 6000 })
        return `Opened ${params.app}`
      } catch {
        try {
          await execAsync(`open "${app}"`, { timeout: 6000 })
          return `Opened ${params.app}`
        } catch {
          return `Could not find application: ${params.app}`
        }
      }
    }

    case 'open_url': {
      const url = params.url || ''
      try {
        await execAsync(`open "${url}"`, { timeout: 5000 })
        return `Opened ${url} in browser`
      } catch {
        return `Could not open URL: ${url}`
      }
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

    case 'get_system_info': {
      const [cpu, bat, mem] = await Promise.allSettled([
        execAsync("top -l 1 -s 0 | awk '/CPU usage/{print $3+$5}' | head -1"),
        execAsync("pmset -g batt | grep -o '[0-9]*%' | head -1"),
        execAsync("vm_stat | grep 'Pages active' | awk '{print $3}' | tr -d '.'"),
      ])
      const cpuVal = cpu.status === 'fulfilled' ? `${Math.round(parseFloat(cpu.value.stdout))}%` : 'N/A'
      const batVal = bat.status === 'fulfilled' ? bat.value.stdout.trim() : 'N/A'
      const memPages = mem.status === 'fulfilled' ? parseInt(mem.value.stdout.trim()) : 0
      const memGB = memPages > 0 ? `${(memPages * 4096 / 1024 / 1024 / 1024).toFixed(1)} GB active` : 'N/A'
      return `CPU: ${cpuVal} used, Battery: ${batVal}, RAM: ${memGB}`
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
        const { stdout, stderr } = await execAsync(cmd, { timeout: 12000, cwd: process.env.HOME })
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
        await execAsync(`echo ${JSON.stringify(line)} >> "${notePath}"`)
        return `Note saved to ~/GhostForge/notes.md`
      } catch {
        return 'Could not save note'
      }
    }

    case 'take_screenshot': {
      try {
        const filename = params.filename || `screenshot-${Date.now()}.png`
        const outPath = join(process.env.HOME || '', 'Desktop', filename)
        await execAsync(`screencapture -x "${outPath}"`, { timeout: 8000 })
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
      const dir = params.path || process.env.HOME || '~'
      try {
        const { stdout } = await execAsync(`ls -la "${dir}" | head -20`, { timeout: 5000 })
        return stdout.trim() || 'Empty directory'
      } catch {
        return `Cannot list ${dir}`
      }
    }

    case 'read_file': {
      const filePath = params.path || ''
      if (!filePath) return 'No file path provided'
      const safePath = filePath.replace(/\.\./g, '').trim()
      try {
        const { stdout } = await execAsync(`head -50 "${safePath}"`, { timeout: 5000 })
        return stdout.trim().slice(0, 1000) || '(empty file)'
      } catch {
        return `Cannot read file: ${safePath}`
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
        await execAsync(`cliclick ${flag}:${x},${y}`, { timeout: 5000 })
        return `${button === 'double' ? 'Double-clicked' : button === 'right' ? 'Right-clicked' : 'Clicked'} at (${x}, ${y})`
      } catch {
        return `Click failed at (${x}, ${y})`
      }
    }

    case 'mouse_move': {
      const x = parseInt(params.x) || 0
      const y = parseInt(params.y) || 0
      try {
        await execAsync(`cliclick m:${x},${y}`, { timeout: 5000 })
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
        await execAsync(`cliclick dd:${fx},${fy} m:${tx},${ty} du:${tx},${ty}`, { timeout: 8000 })
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
        await execAsync(`echo ${JSON.stringify(text)} | pbcopy`, { timeout: 3000 })
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
          const { stdout, stderr } = await execAsync(`python3 "${pyFile}"`, { timeout: 10000 })
          await unlink(pyFile).catch(() => {})
          return (stdout + stderr).trim().slice(0, 1500) || 'No output'
        } else if (lang === 'javascript' || lang === 'node') {
          const jsFile = `${tmpFile}.js`
          await writeFile(jsFile, code, 'utf8')
          const { stdout, stderr } = await execAsync(`node "${jsFile}"`, { timeout: 10000 })
          await unlink(jsFile).catch(() => {})
          return (stdout + stderr).trim().slice(0, 1500) || 'No output'
        } else {
          // Shell — write to .sh file, no inline interpolation
          const shFile = `${tmpFile}.sh`
          await writeFile(shFile, `#!/bin/bash\nset -euo pipefail\n${code}`, 'utf8')
          await execAsync(`chmod +x "${shFile}"`)
          const { stdout, stderr } = await execAsync(`/bin/bash "${shFile}"`, { timeout: 15000 })
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
        await execAsync(`screencapture -x ${screenshotPath}`, { timeout: 5000 })
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
          const { stdout, stderr } = await execAsync(step, { timeout: 10000, shell: '/bin/bash' })
          results.push(`✓ ${step}: ${(stdout + stderr).trim().slice(0, 200) || 'done'}`)
        } catch (e: unknown) {
          results.push(`✗ ${step}: ${((e as Error).message || 'failed').slice(0, 100)}`)
        }
      }
      return results.join('\n')
    }

    case 'lock_screen': {
      const script = `tell application "System Events" to keystroke "q" using {command down, control down}`
      await runScript(script)
      return 'Screen locked'
    }

    case 'copilot_ask': {
      const question = (params.question || '').replace(/'/g, "'\\''")
      if (!question) return 'No question provided'
      try {
        const { stdout, stderr } = await execAsync(`gh copilot -p '${question}'`, { timeout: 30000 })
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

        // Score tiers based on available RAM
        let bestPick: string
        let reason: string
        if (available >= 18 && isAppleSilicon) {
          bestPick = 'qwen2.5-coder:14b'
          reason = `${ramGB}GB RAM + Apple Silicon — 14B models run beautifully`
        } else if (available >= 12) {
          bestPick = 'qwen2.5-coder:7b'
          reason = `${ramGB}GB RAM — 7B model is the sweet spot (quality + speed)`
        } else if (available >= 6) {
          bestPick = 'qwen2.5:7b'
          reason = `${ramGB}GB RAM — 7B fits comfortably`
        } else {
          bestPick = 'qwen2.5-coder:1.5b'
          reason = `${ramGB}GB RAM — lightweight model recommended`
        }

        const useCase = params.useCase || 'general'
        if (useCase === 'reasoning') bestPick = available >= 12 ? 'deepseek-r1:14b' : 'deepseek-r1:8b'
        if (useCase === 'code' && available >= 18) bestPick = 'qwen2.5-coder:14b'

        const isInstalled = ollama.some(m => m.startsWith(bestPick.split(':')[0]))
        const installCmd = isInstalled ? '' : `\nTo install: ollama pull ${bestPick}`

        return `Hardware: ${cpu} · ${ramGB}GB RAM · Available for AI: ~${available}GB
Best model for your system: ${bestPick} (${reason})
Currently installed: ${ollama.join(', ') || 'none'}
Recommended: ${bestPick}${isInstalled ? ' ✓ installed' : ' — not yet installed'}${installCmd}`
      } catch (e) {
        return `Could not analyze hardware: ${(e as Error).message?.slice(0, 100)}`
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
      // Try Vane (self-hosted AI search) first, fall back to regular web_search
      const q = params.query || 'hello'
      try {
        const res = await fetch(`http://localhost:3100/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const data = await res.json() as { answer?: string; results?: Array<{title: string, url: string}> }
          const answer = data.answer || ''
          const sources = (data.results || []).slice(0, 3).map((r: {title: string, url: string}) => `• ${r.title}: ${r.url}`).join('\n')
          return `${answer}\n\nSources:\n${sources}`
        }
      } catch {}
      // Fallback to wttr or basic search
      try {
        const r = await fetch(`https://wttr.in/${encodeURIComponent(q)}?format=j1`, { signal: AbortSignal.timeout(5000) })
        if (r.ok) return `Search: ${q} (Vane not running — start it with Docker for deep search)`
      } catch {}
      return `Vane search not available. Start Vane: docker run -d -p 3100:3000 itzcrazykns1337/vane:latest\nQuery was: "${q}"`
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
        // Use --safe mode and --quiet for non-interactive execution
        const tmpPromptFile = join(tmpdir(), `gfai-oi-${Date.now()}.txt`)
        await writeFile(tmpPromptFile, prompt, 'utf8')
        const { stdout, stderr } = await execAsync(
          `python3 -m interpreter --model "${model}" --safe --quiet --single_message "$(cat ${tmpPromptFile})" 2>&1`,
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
          const { stdout, stderr } = await execAsync(`node "${jsFile}"`, { timeout: 10000 })
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
          const { stdout, stderr } = await execAsync(`python3 "${pyFile}"`, { timeout: 10000 })
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

    default:
      return 'Unknown tool'
  }
}

// ── Tool result → spoken speech (no second AI call) ───────────────────────────

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
  confirmRisk?: boolean
  lang?: string        // optional client-detected language override
  platform?: string    // 'ios' | 'android' | 'mac' | 'windows' | 'linux'
}

interface AIResponse {
  speech: string
  tool: string | null
  toolParams: Record<string, string>
  emotion: string
  confidence?: number
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

  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    // Log unauthorized access attempt
    void auditLog({
      level: 'security',
      event: 'unauthorized_access_attempt',
      ip,
      userAgent: req.headers.get('user-agent') || undefined,
      risk: 90,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: JarvisRequest
  try { body = await req.json() } catch { body = { message: '' } }
  const { message, history = [], memory = {}, selectedProvider, selectedModel, confirmRisk = false, lang: clientLang, platform: clientPlatform } = body

  if (!message?.trim()) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  // Detect language from message content (server-side)
  const detectedLang = clientLang || detectMsgLanguage(message)

  // Detect device from User-Agent for device-aware tool filtering
  const ua = req.headers.get('user-agent') || ''
  const device = detectDeviceFromUA(ua)
  const isMac = clientPlatform === 'mac' || (clientPlatform == null && device.isMac)
  const isMobile = clientPlatform ? ['ios', 'android'].includes(clientPlatform) : device.isMobile

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
  })

  // ── Domain classification (fast, keyword-based) ────────────────────────────
  const domain = classifyDomain(message)

  const modelOpts = selectedProvider ? { activeProvider: selectedProvider, activeModel: selectedModel } : undefined

  let usedProvider = ''
  let usedModel    = ''

  async function aiGenerate(opts: { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number }): Promise<string> {
    const result = await generateWithFallback(opts, modelOpts)
    usedProvider = result.usedProvider
    usedModel    = result.usedModel
    return result.text
  }

  // ── Step 1: AI intent classification + response ───────────────────────────
  let aiResp: AIResponse = { speech: pickPersona('processing'), tool: null, toolParams: {}, emotion: 'thinking', confidence: 80 }

  try {
    const text = await aiGenerate({
      system: buildSystemPrompt(memory, domain, { lang: detectedLang, isMobile, isMac }),
      messages: [
        ...history.slice(-5).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user' as const, content: message },
      ],
      maxTokens: 320,
    })

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        aiResp = { ...aiResp, ...parsed }
        // Safety: clean thinking leakage in speech
        if (aiResp.speech && (
          aiResp.speech.includes('We need to respond') ||
          aiResp.speech.includes('According to tools') ||
          aiResp.speech.includes('The user wants to') ||
          aiResp.speech.includes('I should') ||
          aiResp.speech.includes('Let me think')
        )) {
          aiResp.speech = pickPersona('acknowledge')
        }
      } catch { aiResp.speech = text.replace(/\{[\s\S]*\}/, '').trim() || text.trim() }
    } else {
      aiResp.speech = text.trim().slice(0, 300)
    }
  } catch (e) {
    const msg = String(e)
    aiResp = {
      speech: msg.toLowerCase().includes('no ai providers') || msg.toLowerCase().includes('all ai providers')
        ? 'All AI providers failed. Please check your API keys or try again later.'
        : `${pickPersona('error')} ${msg.slice(0, 60)}`,
      tool: null, toolParams: {}, emotion: 'alert', confidence: 0,
    }
  }

  // ── Step 2: Risk assessment before tool execution ─────────────────────────
  let toolResult: string | null = null
  let riskAssessment = null

  if (aiResp.tool && aiResp.tool !== 'null') {
    const risk = assessRisk(aiResp.tool, aiResp.toolParams || {})
    riskAssessment = risk

    // Log the tool request
    void auditLog({
      level: risk.level === 'danger' ? 'danger' : risk.level === 'warn' ? 'warn' : 'info',
      event: 'tool_request',
      tool: aiResp.tool,
      params: aiResp.toolParams,
      risk: risk.risk,
      blocked: risk.level === 'danger' && !confirmRisk,
    })

    // Block dangerous tools unless user confirmed
    if (risk.level === 'danger' && !confirmRisk) {
      return NextResponse.json({
        speech: `I've detected a high-risk operation: ${risk.reason} Please confirm if you want me to proceed.`,
        tool: aiResp.tool,
        toolResult: null,
        emotion: 'alert',
        confidence: 95,
        domain,
        usedModel,
        usedProvider,
        requiresConfirmation: true,
        risk: riskAssessment,
      })
    }

    // Execute tool
    toolResult = await executeTool(aiResp.tool, aiResp.toolParams || {})

    // Log result
    void auditLog({
      level: 'info',
      event: 'tool_executed',
      tool: aiResp.tool,
      params: aiResp.toolParams,
      result: (toolResult || '').slice(0, 200),
      risk: risk.risk,
    })

    // Format tool result as speech — no second AI call (eliminates ~40% of latency)
    if (toolResult && toolResult !== 'Done') {
      aiResp.speech = formatToolSpeech(aiResp.tool, toolResult)
    }
  }

  return NextResponse.json({
    speech: aiResp.speech,
    tool: aiResp.tool ?? null,
    toolResult,
    emotion: aiResp.emotion || 'neutral',
    confidence: aiResp.confidence ?? 80,
    domain,
    usedModel,
    usedProvider,
    risk: riskAssessment,
    detectedLang,
    device: { isMobile, isMac },
  })
}
