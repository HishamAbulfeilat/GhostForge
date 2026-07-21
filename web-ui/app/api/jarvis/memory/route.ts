import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const MEMORY_DIR  = join(homedir(), '.ghostforge', 'jarvis')
const MEMORY_FILE = join(MEMORY_DIR, 'memory.json')

interface Memory {
  userName: string
  preferences: { city: string; music: string; language: string }
  facts: string[]
  conversationCount: number
  firstSeen: string
  lastSeen?: string
}

const DEFAULT_MEMORY: Memory = {
  userName: '',
  preferences: { city: 'Riyadh', music: 'spotify', language: 'en' },
  facts: [],
  conversationCount: 0,
  firstSeen: new Date().toISOString(),
}

async function readMemory(): Promise<Memory> {
  try {
    return JSON.parse(await readFile(MEMORY_FILE, 'utf8')) as Memory
  } catch {
    return { ...DEFAULT_MEMORY }
  }
}

function auth(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  return token && token === process.env.AUTH_SECRET
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await readMemory())
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const patch = await req.json() as Partial<Memory>
  const current = await readMemory()
  const updated: Memory = { ...current, ...patch, lastSeen: new Date().toISOString() }
  await mkdir(MEMORY_DIR, { recursive: true })
  await writeFile(MEMORY_FILE, JSON.stringify(updated, null, 2), 'utf8')
  return NextResponse.json(updated)
}

export async function PATCH(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { fact } = await req.json() as { fact: string }
  if (!fact) return NextResponse.json({ error: 'No fact' }, { status: 400 })
  const current = await readMemory()
  if (!current.facts.includes(fact)) current.facts.push(fact)
  current.conversationCount = (current.conversationCount || 0) + 1
  current.lastSeen = new Date().toISOString()
  await mkdir(MEMORY_DIR, { recursive: true })
  await writeFile(MEMORY_FILE, JSON.stringify(current, null, 2), 'utf8')
  return NextResponse.json(current)
}
