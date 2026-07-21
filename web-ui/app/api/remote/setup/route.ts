import { NextRequest, NextResponse } from 'next/server'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import net from 'net'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const execAsync = promisify(exec)

function probePort(port: number, host = '127.0.0.1', timeout = 1000) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (value: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function getIpAddress() {
  try {
    const { stdout } = await execAsync('ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo 127.0.0.1')
    return stdout.trim() || '127.0.0.1'
  } catch {
    return '127.0.0.1'
  }
}

async function getNoVncRoot() {
  const candidates = [
    '/opt/homebrew/share/novnc',
    '/usr/local/share/novnc',
    '/opt/homebrew/opt/novnc/share/novnc',
    '/usr/local/opt/novnc/share/novnc',
  ]

  for (const candidate of candidates) {
    try {
      const { stdout } = await execAsync(`[ -f "${candidate}/vnc.html" ] && echo ok || true`)
      if (stdout.trim() === 'ok') return candidate
    } catch {
      // ignore
    }
  }

  return null
}

async function getRemoteStatus() {
  const [screenSharing, websockify, ip] = await Promise.all([
    probePort(5900),
    probePort(6080),
    getIpAddress(),
  ])

  return {
    screenSharing,
    websockify,
    ip,
    noVncUrl: websockify ? 'http://localhost:6080/vnc.html' : null,
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await getRemoteStatus())
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { action?: string }

  if (body.action === 'enable-screen-sharing') {
    try {
      await execAsync('/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -activate -configure -access -on -clientopts -setvnclegacy -vnclegacy yes -restart -agent', { timeout: 10000 })
      return NextResponse.json({ ok: true, message: 'Screen Sharing enabled.', ...(await getRemoteStatus()) })
    } catch {
      await execAsync('open "x-apple.systempreferences:com.apple.Sharing-Settings.extension"').catch(() => undefined)
      return NextResponse.json({
        ok: true,
        requiresManual: true,
        message: 'Opened macOS Sharing settings. Enable Screen Sharing manually if macOS blocks automation.',
        ...(await getRemoteStatus()),
      })
    }
  }

  if (body.action === 'start-websockify') {
    const noVncRoot = await getNoVncRoot()
    if (!noVncRoot) {
      return NextResponse.json({
        error: 'noVNC not found. Install it with Homebrew to enable the embedded viewer.',
      }, { status: 500 })
    }

    const alreadyRunning = await probePort(6080)
    if (!alreadyRunning) {
      const child = spawn('websockify', ['6080', 'localhost:5900', '--web', noVncRoot], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
    }

    return NextResponse.json({ ok: true, message: 'WebSocket bridge started.', ...(await getRemoteStatus()) })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
