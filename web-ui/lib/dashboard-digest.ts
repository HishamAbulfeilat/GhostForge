/**
 * Dashboard "since you were away" digest.
 *
 * Per user, we keep a snapshot of what the dashboard showed when they last
 * dismissed the digest (~/.ghostforge/users/<username>/dashboard-seen.json).
 * The digest is the difference between that snapshot and the current (cached)
 * GitHub/git panels: new failing CI runs, PRs awaiting review, and new tags.
 *
 * Reading the dashboard does not clear the digest; dismissing it does
 * (POST /api/dashboard { action: 'seen' }). The first visit only records a
 * baseline, so nobody is greeted by "everything is new".
 */
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

export interface DigestRun { id: string; name: string; branch: string; conclusion: string; updated: string }
export interface DigestPR { number: string; title: string; author: string; review: string }
export interface DigestRelease { tag: string; date: string }

export interface DigestInput {
  runs: DigestRun[]
  prs: DigestPR[]
  releases: DigestRelease[]
}

export interface SeenState {
  lastVisitAt: string
  runs: string[]       // failing run ids already seen
  prs: string[]        // PR numbers awaiting review already seen
  tags: string[]
  notifiedRuns: string[] // failing run ids already pushed
}

export interface Digest {
  since: string | null
  firstVisit: boolean
  failingRuns: DigestRun[]
  prsAwaitingReview: DigestPR[]
  newTags: DigestRelease[]
  total: number
}

const MAX_IDS = 200
const SAFE_USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function seenFile(username: string, home = homedir()): string | null {
  const name = String(username || '').toLowerCase()
  if (!SAFE_USERNAME.test(name)) return null
  return join(home, '.ghostforge', 'users', name, 'dashboard-seen.json')
}

export async function readSeen(username: string, home?: string): Promise<SeenState | null> {
  const file = seenFile(username, home)
  if (!file) return null
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as Partial<SeenState>
    if (!data || typeof data.lastVisitAt !== 'string') return null
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { lastVisitAt: data.lastVisitAt, runs: list(data.runs), prs: list(data.prs), tags: list(data.tags), notifiedRuns: list(data.notifiedRuns) }
  } catch {
    return null
  }
}

export async function writeSeen(username: string, state: SeenState, home?: string): Promise<void> {
  const file = seenFile(username, home)
  if (!file) return
  await mkdir(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  await rename(tmp, file)
}

const failing = (runs: DigestRun[]) => runs.filter(r => r.conclusion === 'failure')
const awaiting = (prs: DigestPR[]) => prs.filter(p => p.review === 'pending')

/** Snapshot of everything currently visible, for "mark as seen". */
export function snapshot(input: DigestInput, previous: SeenState | null, now = new Date()): SeenState {
  return {
    lastVisitAt: now.toISOString(),
    runs: failing(input.runs).map(r => r.id).slice(0, MAX_IDS),
    prs: awaiting(input.prs).map(p => p.number).slice(0, MAX_IDS),
    tags: input.releases.map(r => r.tag).slice(0, MAX_IDS),
    notifiedRuns: [...new Set([...(previous?.notifiedRuns ?? []), ...failing(input.runs).map(r => r.id)])].slice(-MAX_IDS),
  }
}

export function computeDigest(seen: SeenState | null, input: DigestInput): Digest {
  if (!seen) return { since: null, firstVisit: true, failingRuns: [], prsAwaitingReview: [], newTags: [], total: 0 }
  const runs = new Set(seen.runs)
  const prs = new Set(seen.prs)
  const tags = new Set(seen.tags)
  const failingRuns = failing(input.runs).filter(r => !runs.has(r.id))
  const prsAwaitingReview = awaiting(input.prs).filter(p => !prs.has(p.number))
  const newTags = input.releases.filter(r => !tags.has(r.tag))
  return {
    since: seen.lastVisitAt,
    firstVisit: false,
    failingRuns,
    prsAwaitingReview,
    newTags,
    total: failingRuns.length + prsAwaitingReview.length + newTags.length,
  }
}

/** Failing runs that have not been pushed to this user yet. */
export function runsToNotify(seen: SeenState | null, input: DigestInput): DigestRun[] {
  const notified = new Set(seen?.notifiedRuns ?? [])
  const seenRuns = new Set(seen?.runs ?? [])
  return failing(input.runs).filter(r => !notified.has(r.id) && !seenRuns.has(r.id))
}
