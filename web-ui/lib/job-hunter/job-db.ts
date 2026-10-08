/**
 * SQLite storage for a user's jobs: ~/.ghostforge/jobs/<username>/jobs.db
 *
 * Why: jobs.json was rewritten whole on every update (every application log
 * line), under a lock that only one server process could see. Here each job is
 * one row, a change touches only that row, and writes are SQLite transactions,
 * so two server processes (or the CLI next to the server) can't lose each
 * other's updates.
 *
 * Uses Node's built-in `node:sqlite` (Node 22.13+, no npm dependency). It is
 * loaded with process.getBuiltinModule, which bundlers leave alone, so the
 * Next.js server build doesn't need special configuration. When it isn't
 * available (older Node) or JOB_HUNTER_STORE=json, the store keeps using
 * jobs.json as before; once jobs.db exists the JSON file is no longer the live
 * data, so that case fails loudly instead of showing an empty or stale list.
 *
 * Migration: the first open imports an existing jobs.json in one transaction,
 * then renames it to jobs.json.migrated-<time>.bak. Nothing is deleted.
 */
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

interface Statement {
  run(...params: unknown[]): { changes: number | bigint }
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Array<Record<string, unknown>>
}
export interface JobDb {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}
interface SqliteModule { DatabaseSync: new (path: string, opts?: { timeout?: number }) => JobDb }

type G = { __gfJobDbs?: Map<string, JobDb>; __gfSqlite?: SqliteModule | null; __gfProcessId?: string }
const g = globalThis as G
// Kept on globalThis: Next.js can load this module more than once (instrumentation and route bundles)
const open: Map<string, JobDb> = (g.__gfJobDbs ??= new Map())
/** Identifies this server process in operation leases (a restarted container can reuse the pid) */
export const PROCESS_ID: string = (g.__gfProcessId ??= randomUUID())

function loadSqlite(): SqliteModule | null {
  if (g.__gfSqlite !== undefined) return g.__gfSqlite
  let mod: SqliteModule | null = null
  // Node prints "SQLite is an experimental feature" once on load. The API used
  // here (DatabaseSync, prepare/run/get/all, exec) is stable across 22.13+, so
  // that one warning is filtered; every other warning passes through.
  const emit = process.emitWarning
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === 'string' ? warning : warning?.message
    if (/sqlite/i.test(String(text))) return
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest)
  } as typeof process.emitWarning
  try {
    const getBuiltin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
    const m = getBuiltin?.call(process, 'node:sqlite') as SqliteModule | undefined
    mod = m && typeof m.DatabaseSync === 'function' ? m : null
  } catch {
    mod = null
  } finally {
    process.emitWarning = emit
  }
  g.__gfSqlite = mod
  return mod
}

/** 'sqlite' normally; 'json' on a Node without node:sqlite or with JOB_HUNTER_STORE=json */
export function jobStoreBackend(): 'sqlite' | 'json' {
  if ((process.env.JOB_HUNTER_STORE || '').toLowerCase() === 'json') return 'json'
  return loadSqlite() ? 'sqlite' : 'json'
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL,
  loose TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_key ON jobs(key);
CREATE INDEX IF NOT EXISTS jobs_loose ON jobs(loose);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (
  job_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  process TEXT NOT NULL,
  pid INTEGER NOT NULL,
  host TEXT NOT NULL,
  started_at TEXT NOT NULL
);
`

/**
 * The user's jobs database, opened (and migrated) on first use. null means
 * "use jobs.json" (see jobStoreBackend). `migrate` converts a legacy record
 * into the row columns.
 */
export function openJobDb(
  dir: string,
  migrate: (job: Record<string, unknown>) => { id: string; key: string; loose: string; source: string; status: string; updatedAt: string },
): JobDb | null {
  const path = join(dir, 'jobs.db')
  const cached = open.get(path)
  if (cached) return cached
  if (jobStoreBackend() === 'json') {
    if (existsSync(path)) {
      throw new Error('Job Hunter data is stored in jobs.db, which needs Node.js 22.13 or newer (node:sqlite). Update Node.js, or unset JOB_HUNTER_STORE=json.')
    }
    return null
  }
  mkdirSync(dir, { recursive: true })
  const db = new (loadSqlite()!).DatabaseSync(path, { timeout: 10_000 })
  try {
    // WAL: readers don't block the writer, and a crash can't leave a half-written file
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(SCHEMA)
    migrateJson(db, dir, migrate)
  } catch (e) {
    try { db.close() } catch { /* already failed */ }
    throw e
  }
  open.set(path, db)
  return db
}

function migrateJson(db: JobDb, dir: string, toRow: Parameters<typeof openJobDb>[1]): void {
  const jsonPath = join(dir, 'jobs.json')
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
  const done = () => Boolean(db.prepare("SELECT v FROM meta WHERE k = 'migrated'").get())
  if (done()) {
    // Imported earlier but the rename didn't happen (crash, or a Windows file lock): set it aside now
    if (existsSync(jsonPath)) { try { renameSync(jsonPath, `${jsonPath}.migrated-${stamp()}.bak`) } catch { /* retried next start */ } }
    return
  }
  let jobs: unknown = []
  let unreadable = false
  if (existsSync(jsonPath)) {
    try { jobs = JSON.parse(readFileSync(jsonPath, 'utf8')) } catch { unreadable = true }
    if (!Array.isArray(jobs)) { unreadable = true; jobs = [] }
  }
  let imported = 0
  transaction(db, () => {
    if (done()) return // another process imported it while this one waited for the lock
    const insert = db.prepare('INSERT OR IGNORE INTO jobs (id, key, loose, source, status, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const job of jobs as Array<Record<string, unknown>>) {
      if (!job || typeof job !== 'object' || !job.id) continue
      const r = toRow(job)
      imported += Number(insert.run(r.id, r.key, r.loose, r.source, r.status, r.updatedAt, JSON.stringify(job)).changes)
    }
    db.prepare("INSERT INTO meta (k, v) VALUES ('migrated', ?)").run(JSON.stringify({
      at: new Date().toISOString(), from: existsSync(jsonPath) ? 'jobs.json' : null, imported, unreadable,
    }))
  })
  if (existsSync(jsonPath)) {
    // Kept as a backup, never deleted. An unreadable file is kept under a name that says so.
    try { renameSync(jsonPath, `${jsonPath}.${unreadable ? 'unreadable' : 'migrated'}-${stamp()}.bak`) } catch { /* retried next start */ }
  }
}

/**
 * Run `fn` as one write transaction. BEGIN IMMEDIATE takes SQLite's write
 * lock up front (waiting up to the busy timeout for another process), and
 * `fn` is synchronous, so nothing else in this process can interleave either.
 */
export function transaction<T>(db: JobDb, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* nothing to roll back */ }
    throw e
  }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

/** Longest a lease is honoured without a liveness check (another machine sharing the folder) */
const LEASE_MAX_MS = 6 * 60 * 60_000

/**
 * Cross-process "one operation per job" lease. Returns a release function,
 * or null when another live process (or this one) holds the job. A lease
 * left by a process that died is taken over.
 */
export function acquireOperation(db: JobDb, jobId: string, owner: string): (() => void) | null {
  const host = hostname()
  const ok = transaction(db, () => {
    const row = db.prepare('SELECT owner, process, pid, host, started_at FROM operations WHERE job_id = ?').get(jobId)
    if (row) {
      const sameHost = row.host === host
      const dead = sameHost && (!pidAlive(Number(row.pid)) || (Number(row.pid) === process.pid && row.process !== PROCESS_ID))
      const expired = Date.now() - Date.parse(String(row.started_at)) > LEASE_MAX_MS
      if (!dead && !expired) return false
    }
    db.prepare('INSERT OR REPLACE INTO operations (job_id, owner, process, pid, host, started_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(jobId, owner, PROCESS_ID, process.pid, host, new Date().toISOString())
    return true
  })
  if (!ok) return null
  return () => { db.prepare('DELETE FROM operations WHERE job_id = ? AND owner = ?').run(jobId, owner) }
}

/** Close every open jobs database (tests, shutdown). They reopen on next use. */
export function closeJobDbs(): void {
  for (const [path, db] of open) { try { db.close() } catch { /* already closed */ } open.delete(path) }
}
