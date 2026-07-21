import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import { isAuthorizedRequest } from '@/lib/auth'
import { getLiveBridgeToken, getBridgeUrl } from '@/lib/bridge-token'
import { executeBridgeCommand } from '@/lib/ws-client'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as { command?: string }
  const command = body.command?.trim()

  if (!command) {
    return NextResponse.json({ error: 'Command is required' }, { status: 400 })
  }

  const bridgeToken = getLiveBridgeToken()
  if (bridgeToken) {
    try {
      const data = await executeBridgeCommand(getBridgeUrl(), bridgeToken, command)
      return NextResponse.json(data)
    } catch {
      // Fall through to direct local execution.
    }
  }

  const HOME = os.homedir()
  const localBin = path.join(HOME, 'GhostForge/bin')
  const env = {
    ...process.env,
    PATH: [localBin, '/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin', process.env.PATH || ''].join(':'),
    HOME,
  }

  try {
    const { stdout, stderr } = await execAsync(command, { env, timeout: 30000, cwd: HOME })
    return NextResponse.json({ output: stdout.trim() || stderr.trim() || 'Done', connected: true })
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const output = ((err.stdout || '') + (err.stderr || '')).trim() || err.message || 'Command failed'
    return NextResponse.json({ output, error: output, connected: true })
  }
}
