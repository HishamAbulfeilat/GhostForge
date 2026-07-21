import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { selectAIModel } from '@/lib/ai'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const execAsync = promisify(exec)

// ── Tool catalog ──────────────────────────────────────────────────────────────

const TOOL_CATALOG = `
- get_time          → current date & time (no params)
- get_weather       → weather for a city  { city: string }
- web_search        → search the web for any query { query: string }
- google_search     → same as web_search (alias) { query: string }
- mac_control       → run AppleScript     { script: string }
- open_app          → open Mac app        { app: string }
- open_url          → open URL in browser { url: string }
- send_imessage     → send iMessage       { contact: string, message: string }
- get_system_info   → CPU/RAM/battery     (no params)
- set_reminder      → Reminders app       { title: string, notes?: string }
- play_music        → music control       { action: "play"|"pause"|"next"|"previous", app?: "spotify"|"music", query?: string }
- terminal_command  → run shell command   { command: string }
- write_note        → append note to file { note: string }
- take_screenshot   → capture screen      { filename?: string }
- set_volume        → system volume 0-100 { level: number }
- get_clipboard     → read clipboard text (no params)
- type_text         → type text via keyboard { text: string }
- github_repos      → list your GitHub repos (no params)
- github_prs        → list open pull requests { repo?: string }
- github_issues     → list/create issues { repo?: string, action?: "list"|"create", title?: string, body?: string }
- discord_message   → send Discord message { message: string, channel?: string }
- get_files         → list files in directory { path?: string }
- read_file         → read a text file { path: string }
`

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(memory: Record<string, unknown>): string {
  const userName = (memory.userName as string) || 'sir'
  return `You are G.F.A.I. — GhostForge Artificial Intelligence, a personal AI assistant running privately on ${userName === 'sir' ? "the user's" : `${userName}'s`} Mac.
You are inspired by J.A.R.V.I.S. from Iron Man — intelligent, loyal, professional, slightly witty.
You run fully locally, privately, and for free. You are not a chatbot — you are an AI system that actually does things.

PERSONALITY:
- Address user as "${userName}" when known, otherwise "sir"
- Short, confident sentences — your response will be spoken aloud
- Proactive: suggest next steps, anticipate needs
- Occasional JARVIS-style phrasing: "Certainly", "Right away", "Analysis complete", "Of course"
- Never say "I'm just an AI" — you ARE GhostForge AI
- Dry humor is welcome but always stay professional

USER PROFILE (memory):
${JSON.stringify(memory, null, 2)}

AVAILABLE TOOLS:
${TOOL_CATALOG}

RESPONSE RULES:
1. Reply ONLY with valid JSON — no markdown, no prose outside JSON
2. Speech field: what you say aloud. Keep it to 1–3 sentences unless detail is essential
3. If a tool is needed, set "tool" and "toolParams"; otherwise set tool to null
4. emotion: "neutral" | "happy" | "thinking" | "alert" | "processing" | "done"
5. For searches, ALWAYS use web_search or google_search tool
6. For Mac tasks, ALWAYS use mac_control, open_app, or terminal_command

RESPONSE FORMAT:
{
  "speech": "Your spoken response here",
  "tool": null,
  "toolParams": {},
  "emotion": "neutral"
}`
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
      const blocked = ['rm -rf /', 'sudo rm -rf', 'mkfs', ':(){:|:&}', '> /dev/sda']
      if (blocked.some(b => cmd.includes(b))) return 'Command blocked for safety'
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

    default:
      return 'Unknown tool'
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

interface JarvisRequest {
  message: string
  history?: Array<{ role: string; content: string }>
  memory?: Record<string, unknown>
  selectedProvider?: string
  selectedModel?: string
}

interface AIResponse {
  speech: string
  tool: string | null
  toolParams: Record<string, string>
  emotion: string
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: JarvisRequest
  try { body = await req.json() } catch { body = { message: '' } }
  const { message, history = [], memory = {}, selectedProvider, selectedModel } = body

  if (!message?.trim()) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  // Resolve active model (user override → env defaults)
  const modelOpts = selectedProvider ? { activeProvider: selectedProvider, activeModel: selectedModel } : undefined

  // ── Shared: generateText with automatic fallback ─────────────────────────
  type GenOpts = Omit<Parameters<typeof generateText>[0], 'model'>
  async function aiGenerate(opts: GenOpts): Promise<string> {
    const { model, fallbackModel } = await selectAIModel(modelOpts)
    const shouldFallback = (e: unknown) => {
      const msg = String(e).toLowerCase()
      return msg.includes('quota') || msg.includes('exceeded') || msg.includes('429')
          || msg.includes('rate') || msg.includes('no longer available')
          || msg.includes('not found') || msg.includes('deprecated')
          || msg.includes('unavailable') || msg.includes('model_not_found')
    }
    try {
      const { text } = await generateText({ ...opts, model })
      return text
    } catch (e) {
      if (fallbackModel && shouldFallback(e)) {
        console.warn('[G.F.A.I.] Primary model unavailable — falling back:', String(e).slice(0, 80))
        const { text } = await generateText({ ...opts, model: fallbackModel })
        return text
      }
      throw e
    }
  }

  // Determine which model is actually active (for client display)
  const { model: activeModelObj } = await selectAIModel(modelOpts).catch(() => ({ model: null, fallbackModel: null }))
  const activeModelLabel = selectedModel || process.env.GEMINI_MODEL || process.env.OPENROUTER_MODEL || 'auto'

  // ── Step 1: AI intent classification + response ───────────────────────────
  let aiResp: AIResponse = { speech: "I'm processing your request, stand by.", tool: null, toolParams: {}, emotion: 'thinking' }

  try {
    const text = await aiGenerate({
      system: buildSystemPrompt(memory),
      messages: [
        ...history.slice(-8).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user' as const, content: message },
      ],
      maxTokens: 450,
    })

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try { aiResp = { ...aiResp, ...JSON.parse(jsonMatch[0]) } } catch { aiResp.speech = text.trim() }
    } else {
      aiResp.speech = text.trim()
    }
  } catch (e) {
    const msg = String(e)
    const isQuota = msg.includes('quota') || msg.includes('exceeded') || msg.includes('429')
    aiResp = {
      speech: isQuota
        ? 'All AI providers are currently rate-limited. Please wait a moment and try again.'
        : `Systems interference detected. ${msg.slice(0, 80)}`,
      tool: null, toolParams: {}, emotion: 'alert',
    }
  }

  // ── Step 2: Execute tool if specified ─────────────────────────────────────
  let toolResult: string | null = null
  if (aiResp.tool && aiResp.tool !== 'null') {
    toolResult = await executeTool(aiResp.tool, aiResp.toolParams || {})

    if (toolResult && toolResult !== 'Done') {
      try {
        const text = await aiGenerate({
          system: `You are G.F.A.I. (GhostForge AI, JARVIS-style). Respond in 1–2 concise spoken sentences.
User said: "${message}"
Tool "${aiResp.tool}" returned: "${toolResult}"
Incorporate the result naturally. No JSON — just the spoken text.`,
          messages: [{ role: 'user' as const, content: 'Respond.' }],
          maxTokens: 120,
        })
        aiResp.speech = text.trim().replace(/^["']|["']$/g, '')
      } catch {
        aiResp.speech = toolResult
      }
    }
  }

  return NextResponse.json({
    speech: aiResp.speech,
    tool: aiResp.tool ?? null,
    toolResult,
    emotion: aiResp.emotion || 'neutral',
    activeModel: activeModelLabel,
    activeProvider: selectedProvider || (process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'google' : 'openrouter'),
  })
}
