import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const CAPTURE_DIR = join(homedir(), '.ghostforge', 'screenshots')
const FORMATS = ['jpeg', 'png', 'tiff'] as const

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const rawFormat = typeof body.format === 'string' ? body.format.toLowerCase() : 'jpeg'
    const format = FORMATS.includes(rawFormat as typeof FORMATS[number]) ? rawFormat : null

    if (!format) {
      return NextResponse.json(
        { error: `Invalid format. Supported: ${FORMATS.join(', ')}` },
        { status: 400 }
      )
    }

    const parsedQuality = Number(body.quality)
    const quality = Math.max(1, Math.min(100, Math.round(Number.isFinite(parsedQuality) ? parsedQuality : 60)))
    const captureAll = Boolean(body.captureAll)

    if (!existsSync(CAPTURE_DIR)) {
      mkdirSync(CAPTURE_DIR, { recursive: true })
    }

    const filename = `capture-${randomUUID().slice(0, 8)}.${format}`
    const filepath = join(CAPTURE_DIR, filename)

    try {
      const captureFlags = captureAll ? ['-x'] : ['-x', '-D']
      execFileSync(
        'screencapture',
        [...captureFlags, '-t', format, '-Q', String(quality), filepath],
        { timeout: 5000 }
      )
    } catch {
      try {
        execFileSync('screencapture', ['-x', '-t', format, filepath], { timeout: 5000 })
      } catch {
        return NextResponse.json(
          { error: 'Screen capture failed — grant Screen Recording permission in System Settings > Privacy & Security' },
          { status: 400 }
        )
      }
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

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    status: 'ok',
    endpoint: 'screen-capture',
    description: 'POST to capture screen. Returns base64 JPEG image.',
    usage: {
      method: 'POST',
      body: {
        format: 'jpeg (default) | png | tiff',
        quality: '60 (default, 1-100)',
        captureAll: 'false (default) — true for multi-monitor',
      },
    },
  })
}
