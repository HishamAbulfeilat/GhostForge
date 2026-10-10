import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { hostedGuard } from '@/lib/hosted'
import { requirePermission } from '@/lib/access'
import { CATALOG_PATH, INSTALL_QUEUE_MODULE, MARKETPLACE_DIR, REGISTRY_PATH } from '@/lib/marketplace-paths'
import { loadInstallQueue } from '@/lib/marketplace-runtime.mjs'

export const dynamic = 'force-dynamic'

/**
 * Opt-in, consented installer queue (marketplace/install-queue.mjs, shared
 * with the TUI).
 *
 *   GET  → queued entries, each re-checked against the catalog (`stale`)
 *   POST { action: 'enqueue', id }   → add to the queue (installs nothing)
 *   POST { action: 'remove',  id }   → decline / drop from the queue
 *   POST { action: 'install', id, consent: { approved: true, command, authorized? } }
 *        → per-item consent (must echo the exact command) + run it once
 *
 * Runs host commands, so: blocked in hosted mode (not on the allowlist) and
 * gated on the `terminal` permission. Offensive suites are refused by the
 * shared module; registry.json stays the single source of truth.
 */

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const OUTPUT_TAIL = 4000

type QueueModule = Awaited<ReturnType<typeof loadQueueModule>>

async function loadQueueModule() {
  return await loadInstallQueue(INSTALL_QUEUE_MODULE) as {
    listQueue: (ctx: object) => unknown[]
    enqueue: (ctx: object, id: string) => unknown
    dequeue: (ctx: object, id: string) => boolean
    consentToInstall: (ctx: object, id: string, consent: unknown) => string
    recordInstallResult: (ctx: object, id: string, result: { ok: boolean; detail?: string }) => string[]
    InstallQueueError: new (...args: never[]) => Error & { code: string; status: number }
  }
}

function readCatalog(): { items: Array<{ id: string }> } {
  try {
    const data = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
    return Array.isArray(data?.items) ? data : { items: [] }
  } catch {
    return { items: [] }
  }
}

function runInstall(command: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    let output = ''
    const append = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-OUTPUT_TAIL) }
    // Catalog commands use shell syntax (`a || b`); the command is the exact
    // string the user approved, never built from request input.
    const child = spawn(command, {
      shell: true,
      cwd: path.dirname(MARKETPLACE_DIR),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: INSTALL_TIMEOUT_MS,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', HOMEBREW_NO_AUTO_UPDATE: '1' },
    })
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', error => resolve({ ok: false, output: `${output}\n${error.message}`.trim() }))
    child.on('close', code => resolve({ ok: code === 0, output: output.trim() }))
  })
}

function errorResponse(mod: QueueModule, error: unknown) {
  if (error instanceof mod.InstallQueueError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  return NextResponse.json({ error: 'Install queue failed' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const access = await requirePermission(req, 'terminal')
  if (access instanceof NextResponse) return access

  const mod = await loadQueueModule()
  const ctx = { catalog: readCatalog(), registryFile: REGISTRY_PATH, actor: access.username, surface: 'web' }
  return NextResponse.json({ queue: mod.listQueue(ctx) })
}

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const access = await requirePermission(req, 'terminal')
  if (access instanceof NextResponse) return access
  // Installs run host commands: refuse anything but a same-origin browser request.
  // SameSite cookies don't cover other apps on another localhost port (same site).
  if (req.headers.get('origin') !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Marketplace queue changes require a same-origin request.' }, { status: 403 })
  }

  let body: { action?: string; id?: string; consent?: { approved?: boolean; command?: string; authorized?: boolean } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id || !['enqueue', 'remove', 'install'].includes(String(body.action))) {
    return NextResponse.json({ error: 'Invalid action or id' }, { status: 400 })
  }

  const mod = await loadQueueModule()
  const ctx = { catalog: readCatalog(), registryFile: REGISTRY_PATH, actor: access.username, surface: 'web' }
  try {
    if (body.action === 'enqueue') {
      const entry = mod.enqueue(ctx, id)
      return NextResponse.json({ ok: true, entry, queue: mod.listQueue(ctx) })
    }
    if (body.action === 'remove') {
      mod.dequeue(ctx, id)
      return NextResponse.json({ ok: true, queue: mod.listQueue(ctx) })
    }
    const command = mod.consentToInstall(ctx, id, body.consent)
    const result = await runInstall(command)
    const installed = mod.recordInstallResult(ctx, id, { ok: result.ok, detail: result.output })
    return NextResponse.json(
      { ok: result.ok, output: result.output, installed, queue: mod.listQueue(ctx) },
      { status: result.ok ? 200 : 500 },
    )
  } catch (error) {
    return errorResponse(mod, error)
  }
}
