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
- web_search        → DuckDuckGo instant search { query: string }
- mac_control       → run AppleScript     { script: string }
- open_app          → open Mac app        { app: string }
- send_imessage     → send iMessage       { contact: string, message: string }
- get_system_info   → CPU/RAM/battery     (no params)
- set_reminder      → Reminders app       { title: string, notes?: string }
- play_music        → music control       { action: "play"|"pause"|"next"|"previous", app?: "spotify"|"music", query?: string }
- terminal_command  → run shell command   { command: string }
- write_note        → append note to file { note: string }
`

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(memory: Record<string, unknown>): string {
  const userName = (memory.userName as string) || 'sir'
  return `You are G.F.A.I. — GhostForge Artificial Intelligence, a personal AI assistant running privately on ${userName === 'sir' ? "the user's" : `${userName}'s`} Mac.
You are inspired by J.A.R.V.I.S. from Iron Man — intelligent, loyal, professional, slightly witty.
You run fully locally, privately, and for free. You are not a chatbot — you are an AI system that actually does things.

PERSONALITY:
- Address user as "${userName}" when known, otherwise "sir" or "ma'am"
- Short, confident sentences — your response will be spoken aloud
- Proactive: suggest next steps, anticipate needs
- Occasional JARVIS-style phrasing: "Certainly", "Right away", "Analysis complete", "Of course, ${userName}"
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

RESPONSE FORMAT:
{
  "speech": "Your spoken response here",
  "tool": null,
  "toolParams": {},
  "emotion": "neutral"
}`
}

// ── Tool executor ──────────────────────────────────────────────────────────────

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

async function executeTool(tool: string, params: Record<string, string>): Promise<string> {
  switch (tool) {

    case 'get_time': {
      return new Date().toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    }

    case 'get_weather': {
      const city = params.city || 'Riyadh'
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
          signal: AbortSignal.timeout(6000),
        })
        const d = await res.json() as {
          current_condition: Array<{
            temp_C: string
            weatherDesc: Array<{ value: string }>
            humidity: string
            windspeedKmph: string
            FeelsLikeC: string
          }>
        }
        const c = d.current_condition[0]
        return `${city}: ${c.weatherDesc[0].value}, ${c.temp_C}°C (feels like ${c.FeelsLikeC}°C), humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h`
      } catch {
        return `Weather data for ${city} unavailable`
      }
    }

    case 'web_search': {
      const q = params.query || ''
      try {
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(7000) },
        )
        const d = await res.json() as {
          Answer: string
          AbstractText: string
          RelatedTopics: Array<{ Text: string }>
        }
        const result = d.Answer || d.AbstractText || d.RelatedTopics?.[0]?.Text || 'No results found'
        return result.slice(0, 600)
      } catch {
        return 'Web search temporarily unavailable'
      }
    }

    case 'mac_control': {
      const script = params.script || ''
      if (!script) return 'No AppleScript provided'
      return runScript(script)
    }

    case 'open_app': {
      const app = (params.app || '').replace(/"/g, '\\"')
      try {
        await execAsync(`open -a "${app}"`, { timeout: 6000 })
        return `Opened ${params.app}`
      } catch {
        // try open by name without .app
        try {
          await execAsync(`open -a "${app}.app"`, { timeout: 6000 })
          return `Opened ${params.app}`
        } catch {
          return `Could not find application: ${params.app}`
        }
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
      const [cpu, bat] = await Promise.allSettled([
        execAsync("top -l 1 -s 0 | awk '/CPU usage/{print $3+$5}' | head -1"),
        execAsync("pmset -g batt | grep -o '[0-9]*%' | head -1"),
      ])
      const cpuVal = cpu.status === 'fulfilled' ? `${Math.round(parseFloat(cpu.value.stdout))}%` : 'N/A'
      const batVal = bat.status === 'fulfilled' ? bat.value.stdout.trim() : 'N/A'
      return `CPU: ${cpuVal} used, Battery: ${batVal}`
    }

    case 'set_reminder': {
      const title = (params.title || 'Reminder').replace(/"/g, '\\"')
      const notes = (params.notes || '').replace(/"/g, '\\"')
      const props = notes
        ? `{name:"${title}", body:"${notes}"}`
        : `{name:"${title}"}`
      const script = `tell application "Reminders"\n  make new reminder at end of default list with properties ${props}\nend tell`
      await runScript(script)
      return `Reminder set: "${params.title}"`
    }

    case 'play_music': {
      const action = params.action || 'play'
      const appName = params.app === 'music' ? 'Music' : 'Spotify'
      const actionMap: Record<string, string> = {
        play: 'play', pause: 'pause', next: 'next track', previous: 'previous track',
      }
      let script = ''
      if (params.query && action === 'play') {
        script = `tell application "${appName}" to activate\ndelay 0.5\ntell application "${appName}" to search for "${(params.query).replace(/"/g, '\\"')}"`
      } else {
        script = `tell application "${appName}" to ${actionMap[action] || 'play'}`
      }
      await runScript(script)
      return `${action} on ${appName}`
    }

    case 'terminal_command': {
      const cmd = params.command || ''
      const blocked = ['rm -rf /', 'sudo rm -rf', 'mkfs', ':(){:|:&}', '> /dev/sda']
      if (blocked.some(b => cmd.includes(b))) return 'Command blocked for safety'
      try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 12000, cwd: process.env.HOME })
        return ((stdout + stderr).trim() || 'Command completed').slice(0, 800)
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

    default:
      return 'Unknown tool'
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

interface JarvisRequest {
  message: string
  history?: Array<{ role: string; content: string }>
  memory?: Record<string, unknown>
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
  const { message, history = [], memory = {} } = body

  if (!message?.trim()) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  // ── Shared: generateText with automatic fallback ─────────────────────────
  type GenOpts = Omit<Parameters<typeof generateText>[0], 'model'>
  async function aiGenerate(opts: GenOpts): Promise<string> {
    const { model, fallbackModel } = await selectAIModel()
    const isQuotaErr = (e: unknown) => {
      const msg = String(e)
      return msg.includes('quota') || msg.includes('exceeded') || msg.includes('429') || msg.includes('rate')
    }
    try {
      const { text } = await generateText({ ...opts, model })
      return text
    } catch (e) {
      if (fallbackModel && isQuotaErr(e)) {
        console.warn('[G.F.A.I.] Primary model quota hit — falling back')
        try {
          const { text } = await generateText({ ...opts, model: fallbackModel })
          return text
        } catch (e2) {
          throw e2
        }
      }
      throw e
    }
  }

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

    // Extract JSON from response
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

    // ── Step 3: Generate spoken response from tool result ─────────────────
    if (toolResult && toolResult !== 'Done') {
      try {
        const text = await aiGenerate({
          system: `You are GhostForge AI (JARVIS-style). Respond in 1–2 concise sentences, spoken aloud.
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
  })
}
