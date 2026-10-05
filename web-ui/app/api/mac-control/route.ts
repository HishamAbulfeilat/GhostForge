import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, rm } from 'fs/promises'
import { generateWithFallback } from '@/lib/ai'
import { requirePermission } from '@/lib/access'
import { SHELL_SCRIPT_TEMPLATES, knownAppleScript, validateAppleScript } from '@/lib/apple-automation'
import { makePrivateTempDir, privateTempPath } from '@/lib/private-temp'

const execFileAsync = promisify(execFile)
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are a macOS AppleScript expert. Convert natural language commands to AppleScript code.

STRICT RULES:
- Return ONLY valid AppleScript code. No markdown fences, no explanation, no comments.
- Always wrap risky operations in try...on error errMsg...end try blocks.
- For contacts, use the display name as given (e.g. "Rawzi").
- Prefer iMessage over Teams when the request is ambiguous about which app to use.
- Never use "do shell script" except by copying the screenshot or battery pattern below character for character; any other shell call is rejected.

COMMON PATTERNS — use these exactly:

1. Open an app:
tell application "App Name" to activate

2. iMessage / SMS (most reliable):
tell application "Messages"
  try
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "ContactName" of targetService
    send "Your message here" to targetBuddy
  on error errMsg
    display notification errMsg with title "GhostForge"
  end try
end tell

3. Microsoft Teams — send a message (UI scripting):
tell application "Microsoft Teams" to activate
delay 1.5
tell application "System Events"
  tell process "Microsoft Teams"
    try
      keystroke "k" using command down
      delay 0.8
      keystroke "ContactName"
      delay 1.5
      key code 36
      delay 0.8
      keystroke "Your message here"
      delay 0.3
      key code 36
    on error errMsg
      display notification errMsg with title "GhostForge"
    end try
  end tell
end tell

4. Set system volume (0-100):
set volume output volume 70

5. Mute / unmute:
set volume with output muted
-- or: set volume without output muted

6. Take a screenshot:
${SHELL_SCRIPT_TEMPLATES.screenshot}

7. Show a notification:
display notification "Your message" with title "GhostForge" subtitle "Subtitle"

8. Open a URL:
tell application "Safari"
  activate
  open location "https://example.com"
end tell

9. Get battery level:
${SHELL_SCRIPT_TEMPLATES.batteryStatus}

10. Lock screen:
tell application "System Events" to keystroke "q" using {command down, control down}

11. Send email via Mail:
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"Subject", content:"Body", visible:true}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:"email@example.com"}
  end tell
  send newMsg
end tell

12. Open Finder at a path:
tell application "Finder"
  activate
  open POSIX file "/Users/username/Documents"
end tell`

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const access = await requirePermission(req, 'mac_control')
  if (access instanceof NextResponse) return access

  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'Mac control requires a GhostForge server running on macOS' }, { status: 409 })
  }

  let body: { command?: string; script?: string; dryRun?: boolean; offlineMode?: boolean }
  try { body = await req.json() } catch { body = {} }

  const { command, script: directScript } = body

  // Allow running a pre-written script directly (from the editor UI)
  let script = directScript?.trim() ?? ''

  if (!script) {
    if (!command?.trim()) {
      return NextResponse.json({ error: 'No command provided' }, { status: 400 })
    }
    script = knownAppleScript(command) || ''
    // Generate AppleScript from natural language when no verified snippet matches.
    try {
      if (!script) {
        const { text } = await generateWithFallback({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Convert this to AppleScript: ${command}` }],
        maxTokens: 600,
        }, { offline: body.offlineMode, task: 'tools' })
        script = text.trim()
      }
      // Strip markdown fences
      script = script.replace(/^```(?:applescript)?\s*/i, '').replace(/\s*```$/, '').trim()
      // Strip thinking tokens from thinking models (qwen3, deepseek-r1)
      script = script.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '').trim()
      // Remove any HTML/XML-like tags that are invalid AppleScript
      script = script.split('\n').filter(line => {
        const t = line.trim()
        return !t.startsWith('<') || t.startsWith('<!--')
      }).join('\n').trim()
    } catch (e) {
      return NextResponse.json({ error: 'AI failed to generate script', details: String(e) }, { status: 500 })
    }
  }

  const validation = validateAppleScript(script)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason, script }, { status: 400 })
  }

  // Write to a file in a private mkdtemp dir (more reliable than -e for multiline)
  let tmpDir: string | null = null
  let output = ''
  let runError: string | null = null

  try {
    tmpDir = await makePrivateTempDir()
    const tmpPath = privateTempPath(tmpDir, 'script.scpt')
    const compiledPath = privateTempPath(tmpDir, 'script.compiled.scpt')
    await writeFile(tmpPath, script, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await execFileAsync('osacompile', ['-o', compiledPath, tmpPath], { timeout: 10000 })
    if (body.dryRun) {
      return NextResponse.json({ script, output: 'AppleScript syntax verified', error: null, dryRun: true })
    }
    const { stdout, stderr } = await execFileAsync('osascript', [tmpPath], { timeout: 20000 })
    output = stdout.trim()
    if (stderr.trim()) runError = stderr.trim()
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    output = err.stdout?.trim() ?? ''
    runError = err.stderr?.trim() || err.message || 'Script execution failed'
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  return NextResponse.json({ script, output, error: runError })
}
