import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fs from 'fs'
import path from 'path'
import os from 'os'

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

const CATALOG_PATH = path.join(os.homedir(), 'GhostForge/marketplace/catalog.json')
const REGISTRY_PATH = path.join(os.homedir(), 'GhostForge/marketplace/registry.json')

export async function GET() {
  const cookieStore = await cookies()
  const auth = cookieStore.get('gf_token')
  if (!auth?.value || auth.value !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const catalog = readJSON<{ items: unknown[] }>(CATALOG_PATH, { items: [] })
  const registry = readJSON<{ installed: string[] }>(REGISTRY_PATH, { installed: [] })

  return NextResponse.json({ items: catalog.items, installed: registry.installed ?? [] })
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('gf_token')
  if (!auth?.value || auth.value !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action, id } = await req.json() as { action: string; id: string }

  const registry = readJSON<{ installed: string[] }>(REGISTRY_PATH, { installed: [] })
  const installed = new Set(registry.installed ?? [])

  if (action === 'install') installed.add(id)
  else if (action === 'remove') installed.delete(id)

  registry.installed = [...installed]
  try {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2))
  } catch {
    return NextResponse.json({ error: 'Cannot write registry' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, installed: registry.installed })
}
