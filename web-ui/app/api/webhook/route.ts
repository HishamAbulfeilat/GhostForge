import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const CONFIG_DIR = path.join(homedir(), '.ghostforge')
const WEBHOOKS_FILE = path.join(CONFIG_DIR, 'webhooks.json')
const LOG_FILE = path.join(CONFIG_DIR, 'webhook-log.json')

interface WebhookTrigger {
  id: string
  source: string
  eventType: string
  action: string
}

interface WebhookLogEntry {
  source: string
  event: string
  prompt: string
  body: unknown
  receivedAt?: string
}

interface GitHubWebhookPayload {
  action?: string
  ref?: string
  commits?: Array<{ message?: string }>
  pull_request?: {
    title?: string
    html_url?: string
  }
  workflow_run?: {
    conclusion?: string
    name?: string
  }
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function readWebhooks() {
  return readJsonFile<WebhookTrigger[]>(WEBHOOKS_FILE, [])
}

function readLog() {
  return readJsonFile<WebhookLogEntry[]>(LOG_FILE, [])
}

function appendLog(entry: Omit<WebhookLogEntry, 'receivedAt'>) {
  ensureConfigDir()
  const log = readLog()
  log.unshift({ ...entry, receivedAt: new Date().toISOString() })
  writeFileSync(LOG_FILE, JSON.stringify(log.slice(0, 200), null, 2))
}

async function readRequestBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

function getBaseUrl(req: NextRequest) {
  return process.env.NEXTAUTH_URL || req.nextUrl.origin || 'http://localhost:3001'
}

function buildJarvisPrompt(event: string, source: string, body: GitHubWebhookPayload) {
  if (event === 'pull_request') {
    const action = typeof body.action === 'string' ? body.action : 'opened'
    const title = body.pull_request?.title || 'unknown'
    const url = body.pull_request?.html_url || ''
    return `GitHub PR ${action}: "${title}" ${url} — please review this PR and summarize what it does.`
  }

  if (event === 'push') {
    const branch = typeof body.ref === 'string' ? body.ref.replace('refs/heads/', '') : 'main'
    const commits = body.commits?.length || 0
    return `GitHub push to ${branch}: ${commits} new commit(s). ${body.commits?.[0]?.message || ''}`
  }

  if (event === 'workflow_run') {
    const status = body.workflow_run?.conclusion || 'unknown'
    const name = body.workflow_run?.name || 'CI'
    return `GitHub Actions workflow "${name}" finished with status: ${status}. ${status === 'failure' ? 'Please help diagnose the failure.' : ''}`
  }

  return `Webhook received from ${source} (${event}): ${JSON.stringify(body).substring(0, 300)}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('log') === '1') return NextResponse.json(readLog())
  return NextResponse.json(readWebhooks())
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const body = await readRequestBody(req)

  if (searchParams.get('config') === '1') {
    ensureConfigDir()
    writeFileSync(WEBHOOKS_FILE, JSON.stringify(body, null, 2))
    return NextResponse.json({ ok: true })
  }

  const ghEvent = req.headers.get('x-github-event') || 'unknown'
  const source = req.headers.get('x-source') || 'generic'
  const typedBody = (body && typeof body === 'object' ? body : {}) as GitHubWebhookPayload
  const jarvisPrompt = buildJarvisPrompt(ghEvent, source, typedBody)

  appendLog({
    source: ghEvent !== 'unknown' ? 'github' : source,
    event: ghEvent,
    prompt: jarvisPrompt,
    body,
  })

  if (jarvisPrompt) {
    try {
      fetch(`${getBaseUrl(req)}/api/jarvis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'gf_token=2001' },
        body: JSON.stringify({ message: jarvisPrompt, mode: 'webhook', stream: false }),
      }).catch(() => undefined)
    } catch {
      // Swallow webhook fan-out failures.
    }
  }

  return NextResponse.json({ ok: true, event: ghEvent, prompted: !!jarvisPrompt })
}

export async function DELETE() {
  ensureConfigDir()
  writeFileSync(LOG_FILE, '[]')
  return NextResponse.json({ ok: true })
}
