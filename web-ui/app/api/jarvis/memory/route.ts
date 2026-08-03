import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { getCurrentUser } from '@/lib/auth'

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

function memoryPathFor(username: string): string {
  return join(homedir(), '.ghostforge', 'users', username.toLowerCase(), 'memory.json')
}

async function readMemory(username: string): Promise<Memory> {
  try {
    return JSON.parse(await readFile(memoryPathFor(username), 'utf8')) as Memory
  } catch {
    return { ...DEFAULT_MEMORY }
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await readMemory(user.username))
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let patch: Partial<Memory>
  try {
    patch = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const current = await readMemory(user.username)
  const updated: Memory = { ...current, ...patch, lastSeen: new Date().toISOString() }
  const path = memoryPathFor(user.username)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(updated, null, 2), 'utf8')
  return NextResponse.json(updated)
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { fact } = await req.json() as { fact: string }
  if (!fact) return NextResponse.json({ error: 'No fact' }, { status: 400 })
  const current = await readMemory(user.username)
  if (!current.facts.includes(fact)) current.facts.push(fact)
  current.conversationCount = (current.conversationCount || 0) + 1
  current.lastSeen = new Date().toISOString()
  const path = memoryPathFor(user.username)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(current, null, 2), 'utf8')
  return NextResponse.json(current)
}
