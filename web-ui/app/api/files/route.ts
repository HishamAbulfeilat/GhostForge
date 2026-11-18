import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requirePermission } from '@/lib/access'
import { isAdmin } from '@/lib/auth'
import { defaultFilesPath, isListable, resolveReadPath, resolveWritePath, writeFileNoFollow } from '@/lib/file-access'

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
// Paths are confined by lib/file-access (workspace root for non-admins).
export async function GET(req: NextRequest) {
  const access = await requirePermission(req, 'file_read')
  if (access instanceof NextResponse) return access
  const policy = { admin: isAdmin(access) }

  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path') || defaultFilesPath(policy)
  const wantContent = url.searchParams.get('content') === '1'

  try {
    const resolved = resolveReadPath(rawPath, policy)
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
      .filter(e => isListable(e.name, policy))
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
    if (typeof rawPath !== 'string' || typeof content !== 'string') return NextResponse.json({ error: 'path and content must be strings' }, { status: 400 })
    if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) return NextResponse.json({ error: 'Content too large (>1MB)' }, { status: 400 })
    const resolved = resolveWritePath(rawPath, { admin: isAdmin(access) })
    writeFileNoFollow(resolved, content)
    return NextResponse.json({ ok: true, path: resolved })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
