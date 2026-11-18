import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { getLiveBridgeToken, getBridgeUrl } from '@/lib/bridge-token'

// The bridge caps prompts at 8000 characters (scripts/bridge-server.js);
// leave room for the mode framing below.
const MAX_PROMPT_CHARS = 7000
const MODES = ['suggest', 'explain'] as const
type CopilotMode = typeof MODES[number]

/**
 * The bridge runs `gh copilot -p <prompt>` and has no notion of a mode, so the
 * mode the chat toggle picks is applied here, by framing the prompt.
 */
function framePrompt(prompt: string, mode: CopilotMode): string {
  if (mode === 'explain') {
    return `Explain the following clearly and concisely. Do not run or change anything.\n\n${prompt}`
  }
  return `Suggest the shell command(s) for the following task, with a one-line explanation of each. Do not run anything.\n\n${prompt}`
}

/**
 * POST { prompt, mode? } → 200 { output, mode, connected: true } on success.
 * Failures are non-2xx with { error }: 503 bridge not connected/unreachable,
 * 504 timeout, 502 bridge refused the call or the Copilot run failed.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsed: { prompt?: unknown; mode?: unknown }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters)` }, { status: 400 })
  }
  const mode = parsed.mode === undefined ? 'suggest' : parsed.mode
  if (!MODES.includes(mode as CopilotMode)) {
    return NextResponse.json({ error: `mode must be one of: ${MODES.join(', ')}` }, { status: 400 })
  }

  const bridgeUrl = getBridgeUrl()
  const bridgeToken = getLiveBridgeToken()

  if (!bridgeToken) {
    return NextResponse.json({
      error: '🔌 Mac bridge not connected. Run: bash ~/GhostForge/scripts/bridge.sh start',
      connected: false,
    }, { status: 503 })
  }

  let res: Response
  try {
    res = await fetch(`${bridgeUrl}/copilot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({ prompt: framePrompt(prompt, mode as CopilotMode), mode }),
      signal: AbortSignal.timeout(65000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    if (timedOut) {
      return NextResponse.json({ error: 'Copilot did not answer in time', connected: true }, { status: 504 })
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Bridge unreachable: ${message}`, connected: false }, { status: 503 })
  }

  const data = (await res.json().catch(() => ({}))) as { output?: unknown; error?: unknown }
  if (res.status === 401) {
    return NextResponse.json({
      error: 'The bridge rejected its token (it may have restarted). Restart the bridge and try again.',
      connected: true,
    }, { status: 502 })
  }
  if (!res.ok) {
    const detail = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    return NextResponse.json({ error: `Bridge error: ${detail}`, connected: true }, { status: 502 })
  }
  const output = typeof data.output === 'string' ? data.output : ''
  if (data.error) {
    // The bridge reports a failed `gh copilot` run as 200 { output, error: true }.
    return NextResponse.json({ error: 'Copilot run failed', output, connected: true }, { status: 502 })
  }
  return NextResponse.json({ output, mode, connected: true })
}
