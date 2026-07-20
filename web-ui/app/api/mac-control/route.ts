import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { generateText } from 'ai'
import { selectAIModel } from '@/lib/ai'

const execAsync = promisify(exec)

const SYSTEM_PROMPT = `You are a macOS AppleScript expert. Convert natural language commands to AppleScript code.

STRICT RULES:
- Return ONLY valid AppleScript code. No markdown fences, no explanation, no comments.
- Always wrap risky operations in try...on error errMsg...end try blocks.
- For contacts, use the display name as given (e.g. "Rawzi").
- Prefer iMessage over Teams when the request is ambiguous about which app to use.

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
do shell script "screencapture ~/Desktop/screenshot-$(date +%Y%m%d-%H%M%S).png"
display notification "Screenshot saved to Desktop" with title "GhostForge"

7. Show a notification:
display notification "Your message" with title "GhostForge" subtitle "Subtitle"

8. Open a URL:
tell application "Safari"
  activate
  open location "https://example.com"
end tell

9. Get battery level:
do shell script "pmset -g batt | grep -o '[0-9]*%'"

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
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { command?: string; script?: string }
  try { body = await req.json() } catch { body = {} }

  const { command, script: directScript } = body

  // Allow running a pre-written script directly (from the editor UI)
  let script = directScript?.trim() ?? ''

  if (!script) {
    if (!command?.trim()) {
      return NextResponse.json({ error: 'No command provided' }, { status: 400 })
    }
    // Generate AppleScript from natural language
    try {
      const { model } = await selectAIModel()
      const { text } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: `Convert this to AppleScript: ${command}`,
        maxTokens: 600,
      })
      script = text.trim()
      // Strip markdown fences in case AI added them
      script = script.replace(/^```(?:applescript)?\s*/i, '').replace(/\s*```$/, '').trim()
    } catch (e) {
      return NextResponse.json({ error: 'AI failed to generate script', details: String(e) }, { status: 500 })
    }
  }

  // Write to temp file (more reliable than -e for multiline)
  const tmpPath = join(tmpdir(), `gf-mac-${randomBytes(4).toString('hex')}.scpt`)
  let output = ''
  let runError: string | null = null

  try {
    await writeFile(tmpPath, script, 'utf8')
    const { stdout, stderr } = await execAsync(`osascript "${tmpPath}"`, { timeout: 20000 })
    output = stdout.trim()
    if (stderr.trim()) runError = stderr.trim()
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    output = err.stdout?.trim() ?? ''
    runError = err.stderr?.trim() || err.message || 'Script execution failed'
  } finally {
    await unlink(tmpPath).catch(() => {})
  }

  return NextResponse.json({ script, output, error: runError })
}
