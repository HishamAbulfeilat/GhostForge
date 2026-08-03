/**
 * Semantic memory — per-user long-term memory with vector retrieval.
 *
 * Facts are embedded via a local embedding provider (Ollama by default) and
 * stored per user under ~/.ghostforge/users/<username>/semantic-memory.json.
 * Retrieval uses cosine similarity on the vectors; when no embeddings are
 * available (Ollama offline / not installed) it degrades to lightweight
 * keyword scoring so memory always works, even fully offline.
 */

import { randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface SemanticMemoryRecord {
  id: string
  text: string
  category?: string
  createdAt: string
  updatedAt: string
  vector?: number[]
  vectorDim?: number
}

export interface SemanticMemoryStats {
  count: number
  categories: Record<string, number>
  embedding: 'ollama' | 'offline'
  embeddingModel?: string
}

const EMBED_URL = process.env.GHOSTFORGE_EMBED_URL ?? 'http://localhost:11434/api/embeddings'
const EMBED_MODEL = process.env.GHOSTFORGE_EMBED_MODEL ?? 'nomic-embed-text'
const MAX_EMBED_TRIES = 2

function storePathFor(username: string): string {
  return join(homedir(), '.ghostforge', 'users', username.toLowerCase(), 'semantic-memory.json')
}

async function loadStore(username: string): Promise<SemanticMemoryRecord[]> {
  try {
    const raw = await readFile(storePathFor(username), 'utf8')
    const data = JSON.parse(raw) as SemanticMemoryRecord[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function saveStore(username: string, records: SemanticMemoryRecord[]): Promise<void> {
  const p = storePathFor(username)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, JSON.stringify(records, null, 2), 'utf8')
}

// ── Embeddings ──────────────────────────────────────────────────────────────

async function ollamaEmbed(text: string): Promise<number[] | null> {
  for (let i = 0; i < MAX_EMBED_TRIES; i++) {
    try {
      const res = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { embedding?: number[] }
      if (Array.isArray(data.embedding) && data.embedding.length) return data.embedding
      return null
    } catch {
      return null
    }
  }
  return null
}

/** Short deterministic keyword hashing used only when Ollama is unreachable. */
function hashTokens(text: string, size = 384): number[] {
  const vec = new Array<number>(size).fill(0)
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  for (const t of tokens) {
    let h = 2166136261
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    const idx = Math.abs(h) % size
    vec[idx] += 1
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

// ── Similarity ──────────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function keywordScore(text: string, query: string): number {
  const qTokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2)
  if (!qTokens.length) return 0
  const lower = text.toLowerCase()
  let hits = 0
  for (const t of qTokens) if (lower.includes(t)) hits++
  return hits / qTokens.length
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function rememberMemory(
  username: string,
  text: string,
  category = 'general',
): Promise<{ id: string; embedded: boolean; embeddingModel?: string }> {
  const records = await loadStore(username)
  const now = new Date().toISOString()
  const vector = await ollamaEmbed(text)
  const record: SemanticMemoryRecord = {
    id: randomUUID(),
    text,
    category,
    createdAt: now,
    updatedAt: now,
    ...(vector ? { vector, vectorDim: vector.length } : {}),
  }
  records.unshift(record)
  const capped = records.slice(0, 2000) // hard cap to bound file size
  await saveStore(username, capped)
  return { id: record.id, embedded: !!vector, embeddingModel: vector ? EMBED_MODEL : undefined }
}

export async function recallMemory(
  username: string,
  query: string,
  topK = 5,
): Promise<{ results: SemanticMemoryRecord[]; method: 'embedding' | 'keyword' }> {
  const records = await loadStore(username)
  if (!records.length) return { results: [], method: 'keyword' }

  const vector = await ollamaEmbed(query)
  if (vector) {
    const scored = records
      .filter(r => r.vector)
      .map(r => ({ r, score: cosine(vector, r.vector as number[]) }))
      .sort((a, b) => b.score - a.score)
    const results = scored.slice(0, topK).filter(s => s.score > 0.15).map(s => s.r)
    if (results.length) return { results, method: 'embedding' }
  }

  const scored = records
    .map(r => ({ r, score: keywordScore(r.text, query) }))
    .sort((a, b) => b.score - a.score)
  const results = scored.slice(0, topK).filter(s => s.score > 0).map(s => s.r)
  return { results, method: 'keyword' }
}

export async function listMemories(
  username: string,
  category?: string,
): Promise<SemanticMemoryRecord[]> {
  const records = await loadStore(username)
  return category ? records.filter(r => r.category === category) : records
}

export async function deleteMemory(username: string, id: string): Promise<boolean> {
  const records = await loadStore(username)
  const next = records.filter(r => r.id !== id)
  if (next.length === records.length) return false
  await saveStore(username, next)
  return true
}

export async function memoryStats(username: string): Promise<SemanticMemoryStats> {
  const records = await loadStore(username)
  const categories: Record<string, number> = {}
  for (const r of records) categories[r.category || 'general'] = (categories[r.category || 'general'] || 0) + 1
  const probe = await ollamaEmbed('ping')
  return {
    count: records.length,
    categories,
    embedding: probe ? 'ollama' : 'offline',
    embeddingModel: probe ? EMBED_MODEL : undefined,
  }
}

export async function clearMemory(username: string): Promise<void> {
  await saveStore(username, [])
}
