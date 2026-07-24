import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const CAPTURE_DIR = join(homedir(), '.ghostforge', 'screenshots')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { format = 'jpeg', quality = 60, captureAll = false } = body

    if (!existsSync(CAPTURE_DIR)) {
      execSync(`mkdir -p "${CAPTURE_DIR}"`)
    }

    const filename = `capture-${randomUUID().slice(0, 8)}.${format}`
    const filepath = join(CAPTURE_DIR, filename)

    try {
      const captureFlags = captureAll
        ? '-x' // capture all screens
        : `-x -D` // capture main display only

      execSync(
        `screencapture ${captureFlags} -t ${format} -Q ${quality} "${filepath}" 2>/dev/null || screencapture -x -t ${format} "${filepath}"`,
        { timeout: 5000, encoding: 'utf-8' }
      )
    } catch {
      return NextResponse.json(
        { error: 'Screen capture failed — grant Screen Recording permission in System Settings > Privacy & Security' },
        { status: 400 }
      )
    }

    if (!existsSync(filepath)) {
      return NextResponse.json(
        { error: 'Screen capture produced no output' },
        { status: 500 }
      )
    }

    const imageBuffer = readFileSync(filepath)
    const base64 = imageBuffer.toString('base64')

    try {
      unlinkSync(filepath)
    } catch {}

    return NextResponse.json({
      success: true,
      image: base64,
      format,
      size: imageBuffer.length,
      timestamp: Date.now(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Screen capture failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'screen-capture',
    description: 'POST to capture screen. Returns base64 JPEG image.',
    usage: {
      method: 'POST',
      body: {
        format: 'jpeg (default) | png',
        quality: '60 (default, 1-100)',
        captureAll: 'false (default) — true for multi-monitor',
      },
    },
  })
}
