import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, rm } from 'fs/promises'
import { generateWithFallback } from '@/lib/ai'
import { requirePermission } from '@/lib/access'
import { SUPPORTED_ACTIONS, buildAppleScript, knownAppleScript, validateAppleScript } from '@/lib/apple-automation'
import { makePrivateTempDir, privateTempPath } from '@/lib/private-temp'

const execFileAsync = promisify(execFile)
export const dynamic = 'force-dynamic'

// The model picks an action and its parameters; the server builds the script
// from vetted templates (lib/apple-automation buildAppleScript), so generated
// output can only ever be one of the shapes validateAppleScript accepts.
const SYSTEM_PROMPT = `You turn a macOS command into ONE JSON object. Reply with the JSON only: no markdown, no explanation.

Pick exactly one of these shapes:
{"action":"open_app","app":"Safari"}
{"action":"open_url","url":"https://example.com"}
{"action":"volume","level":50}
{"action":"mute"}
{"action":"unmute"}
{"action":"lock"}
{"action":"show_desktop"}
{"action":"screenshot"}
{"action":"battery"}
{"action":"notify","message":"text","subtitle":"optional"}
{"action":"imessage","contact":"Name","message":"text"}
{"action":"teams","contact":"Name","message":"text"}
{"action":"mail","to":"someone@example.com","subject":"text","body":"text"}
{"action":"finder","path":"~/Downloads"}
{"action":"media","app":"Spotify","command":"play"}   (app: Spotify or Music; command: play, pause, next, previous)
{"action":"unsupported","reason":"why"}

Rules:
- Copy names, messages and addresses exactly as the user wrote them.
- Prefer imessage over teams when the app is not named.
- For a folder, give a path starting with / or ~/ (e.g. "my Downloads folder" is "~/Downloads").
- Anything else (files, settings, shell commands, other apps' internals) is {"action":"unsupported"}.`

/** Pull the JSON intent out of a model reply (tolerates fences and thinking tags). */
function parseIntent(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
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
    if (!script) {
      // No verified snippet matched: ask the model for a structured action.
      let text: string
      try {
        ({ text } = await generateWithFallback({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: command }],
          maxTokens: 300,
        }, { offline: body.offlineMode, task: 'tools' }))
      } catch (e) {
        return NextResponse.json({ error: 'AI failed to understand the command', details: String(e) }, { status: 502 })
      }
      const intent = parseIntent(text)
      if (!intent) {
        return NextResponse.json({ error: 'AI did not return a supported action. Try rephrasing the command.' }, { status: 422 })
      }
      if (intent.action === 'unsupported') {
        const why = typeof intent.reason === 'string' && intent.reason ? ` (${intent.reason.slice(0, 200)})` : ''
        return NextResponse.json({
          error: `Mac Control can't do that yet${why}. Supported: ${SUPPORTED_ACTIONS.join(', ')}`,
        }, { status: 422 })
      }
      const built = buildAppleScript(intent)
      if (!built.ok) return NextResponse.json({ error: built.reason }, { status: 422 })
      script = built.script
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
