/**
 * One autopilot pass per user at a time, across processes.
 *
 * The web server's scheduler, its "Run now" button and the `jobs autopilot run`
 * CLI all call runAutopilot. Two passes running at once each see the same
 * "submitted today" count and could together send more applications than the
 * daily limit allows. This lock file in the user's jobs directory
 * (~/.ghostforge/jobs/<user>/autopilot.lock) is taken by whichever process
 * starts a pass; every other process sees it and does not start one.
 *
 * A lock is stale, and taken over, when the process that wrote it is gone
 * (same machine, pid no longer alive) or it has not been refreshed for
 * RUN_LOCK_MAX_AGE_MS (a crashed process on another machine, or a hung run).
 * A running pass refreshes it before each application.
 */
import { randomUUID } from 'crypto'
import { mkdir, open, readFile, stat, unlink, writeFile } from 'fs/promises'
import { hostname } from 'os'
import { join } from 'path'
import { userDir } from './store'

/** A pass that has not refreshed its lock for this long is treated as dead. */
export const RUN_LOCK_MAX_AGE_MS = 2 * 60 * 60_000
/** A lock file still being written (empty or partial) is respected for this long. */
const UNREADABLE_GRACE_MS = 60_000

export interface RunLockInfo { pid: number; host: string; startedAt: string; heartbeatAt: string; token: string }

export interface RunLock {
  /** Mark the pass as still alive (call before each long step). */
  refresh(): Promise<void>
  /** Remove the lock, only if it is still ours. */
  release(): Promise<void>
}

export function runLockPath(username: string): string {
  return join(userDir(username), 'autopilot.lock')
}

/** Is a process with this pid running on this machine? EPERM means it exists but isn't ours. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** Why an existing lock no longer protects a run, or null while it does. */
export function staleReason(info: RunLockInfo | null, mtimeMs: number, now = Date.now()): string | null {
  if (!info) return now - mtimeMs > UNREADABLE_GRACE_MS ? 'unreadable' : null
  const last = Date.parse(info.heartbeatAt || info.startedAt)
  if (!Number.isFinite(last) || now - last > RUN_LOCK_MAX_AGE_MS) return 'expired'
  if (info.host === hostname()) {
    // This process holds the in-process lock for the user before it looks here, so a
    // lock with our own pid is a leftover (e.g. a pass cut off by a dev reload).
    if (info.pid === process.pid) return 'leftover'
    if (!pidAlive(info.pid)) return 'process gone'
  }
  return null
}

async function readLock(path: string): Promise<{ info: RunLockInfo | null; mtimeMs: number } | null> {
  let mtimeMs: number
  try { mtimeMs = (await stat(path)).mtimeMs } catch { return null }
  try {
    const info = JSON.parse(await readFile(path, 'utf8')) as RunLockInfo
    return { info: info && typeof info === 'object' && typeof info.token === 'string' ? info : null, mtimeMs }
  } catch {
    return { info: null, mtimeMs }
  }
}

/** The pass holding the user's lock right now, or null when none is running. */
export async function activeRunLock(username: string, now = Date.now()): Promise<RunLockInfo | null> {
  const found = await readLock(runLockPath(username))
  if (!found || staleReason(found.info, found.mtimeMs, now)) return null
  return found.info
}

/**
 * Take the user's run lock, or return null when another live pass holds it.
 * Creation is atomic (O_EXCL), so two processes can't both create it.
 */
export async function acquireRunLock(username: string, now = Date.now()): Promise<RunLock | null> {
  const path = runLockPath(username)
  await mkdir(userDir(username), { recursive: true })
  const token = randomUUID()
  const stamp = () => new Date().toISOString()
  const info: RunLockInfo = { pid: process.pid, host: hostname(), startedAt: stamp(), heartbeatAt: stamp(), token }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(path, 'wx')
      try { await fh.writeFile(JSON.stringify(info)) } finally { await fh.close() }
      return handle(path, info)
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e
    }
    const existing = await readLock(path)
    if (!existing) continue // released meanwhile: try again
    if (!staleReason(existing.info, existing.mtimeMs, now)) return null
    // Remove the stale lock only if it is still the one judged stale.
    const again = await readLock(path)
    if (again && (again.info?.token ?? null) === (existing.info?.token ?? null)) await unlink(path).catch(() => {})
  }
  return null
}

function handle(path: string, info: RunLockInfo): RunLock {
  const ours = async () => (await readLock(path))?.info?.token === info.token
  return {
    async refresh() {
      if (!(await ours())) return
      info.heartbeatAt = new Date().toISOString()
      await writeFile(path, JSON.stringify(info)).catch(() => {})
    },
    async release() {
      if (await ours()) await unlink(path).catch(() => {})
    },
  }
}
