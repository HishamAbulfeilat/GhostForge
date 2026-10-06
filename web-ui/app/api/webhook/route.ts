import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import crypto from 'crypto'
import { isAuthorizedRequest, getAuthSecret } from '@/lib/auth'
import { POST as jarvisPost } from '../jarvis/route'

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

function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const provided = signatureHeader.trim()
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)
  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
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

async function fanOutToJarvis(message: string) {
  try {
    const secret = getAuthSecret()
    const req = new NextRequest('http://localhost/api/jarvis', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `gf_token=${secret}`,
      },
      body: JSON.stringify({ message, mode: 'webhook', stream: false }),
    })
    const resp = await jarvisPost(req)
    await resp.text()
  } catch {
    // Swallow webhook fan-out failures.
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  if (searchParams.get('log') === '1') return NextResponse.json(readLog())
  return NextResponse.json(readWebhooks())
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawBody = await req.text().catch(() => '')

  // GitHub deliveries must be HMAC-signed with WEBHOOK_SECRET. Any other
  // delivery reaches JARVIS with server credentials, so it needs either a
  // signed-in session or the same `x-hub-signature-256` HMAC signature.
  const ghEvent = req.headers.get('x-github-event')
  const sessionAuthorized = !ghEvent && isAuthorizedRequest(req)
  if (!sessionAuthorized) {
    const webhookSecret = process.env.WEBHOOK_SECRET
    if (!webhookSecret) {
      return ghEvent
        ? NextResponse.json({ error: 'WEBHOOK_SECRET not configured' }, { status: 503 })
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const signature = req.headers.get('x-hub-signature-256') || ''
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let body: unknown = {}
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    body = {}
  }

  if (searchParams.get('config') === '1') {
    if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    ensureConfigDir()
    writeFileSync(WEBHOOKS_FILE, JSON.stringify(body, null, 2))
    return NextResponse.json({ ok: true })
  }

  const event = ghEvent || 'unknown'
  const source = req.headers.get('x-source') || 'generic'
  const typedBody = (body && typeof body === 'object' ? body : {}) as GitHubWebhookPayload
  const jarvisPrompt = buildJarvisPrompt(event, source, typedBody)

  appendLog({
    source: ghEvent ? 'github' : source,
    event,
    prompt: jarvisPrompt,
    body,
  })

  if (jarvisPrompt) {
    await fanOutToJarvis(jarvisPrompt)
  }

  return NextResponse.json({ ok: true, event, prompted: !!jarvisPrompt })
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  ensureConfigDir()
  writeFileSync(LOG_FILE, '[]')
  return NextResponse.json({ ok: true })
}
