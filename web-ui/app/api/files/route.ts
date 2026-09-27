import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { requirePermission } from '@/lib/access'

function safePath(p: string): string {
  const home = os.homedir()
  const resolved = path.resolve(p.replace(/^~(?=\/|$)/, home))
  if (!resolved.startsWith(home + path.sep) && resolved !== home) throw new Error('Access denied: path outside home directory')
  return resolved
}

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁'
  const ext = path.extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.ts': '🔷', '.tsx': '⚛️', '.js': '🟨', '.jsx': '⚛️',
    '.json': '📋', '.md': '📝', '.css': '🎨', '.html': '🌐',
    '.sh': '⚙️', '.py': '🐍', '.go': '🐹', '.rs': '🦀',
    '.yml': '⚙️', '.yaml': '⚙️', '.env': '🔒', '.lock': '🔒',
    '.png': '🖼️', '.jpg': '🖼️', '.svg': '🎨', '.gif': '🖼️',
  }
  return map[ext] ?? '📄'
}

// GET /api/files?path=~/GhostForge — list directory
// GET /api/files?path=~/GhostForge/file.ts&content=1 — read file content
export async function GET(req: NextRequest) {
  const access = await requirePermission(req, 'file_read')
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path') || '~'
  const wantContent = url.searchParams.get('content') === '1'

  try {
    const resolved = safePath(rawPath)
    const stat = fs.statSync(resolved)

    if (wantContent || stat.isFile()) {
      if (!stat.isFile()) return NextResponse.json({ error: 'Not a file' }, { status: 400 })
      if (stat.size > 1024 * 1024) return NextResponse.json({ error: 'File too large (>1MB)' }, { status: 400 })
      const content = fs.readFileSync(resolved, 'utf8')
      return NextResponse.json({ type: 'file', path: resolved, content })
    }

    // List directory
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const items = entries
      .filter(e => !e.name.startsWith('.') || e.name === '.env' || e.name === '.gitignore')
      .map(e => ({
        name: e.name,
        isDir: e.isDirectory(),
        icon: getFileIcon(e.name, e.isDirectory()),
        ext: path.extname(e.name),
        path: path.join(resolved, e.name),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return NextResponse.json({ type: 'dir', path: resolved, items })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}

// POST /api/files — write file { path, content }
export async function POST(req: NextRequest) {
  const access = await requirePermission(req, 'file_write')
  if (access instanceof NextResponse) return access

  try {
    const { path: rawPath, content } = await req.json() as { path: string; content: string }
    if (typeof content === 'string' && Buffer.byteLength(content, 'utf8') > 1024 * 1024) return NextResponse.json({ error: 'Content too large (>1MB)' }, { status: 400 })
    const resolved = safePath(rawPath)
    fs.writeFileSync(resolved, content, 'utf8')
    return NextResponse.json({ ok: true, path: resolved })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
