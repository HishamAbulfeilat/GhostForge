// Private temp files for routes that hand data to external tools
// (osascript, screencapture, python3, node, afplay…).
//
// Never build temp paths from tmpdir() + Date.now() or a hard-coded /tmp:
// those names are predictable, so another local user can pre-create or
// symlink them (CodeQL js/insecure-temporary-file). Instead every use gets
// its own mkdtemp directory (0o700) and files are created exclusively
// ('wx', 0o600) inside it.
import { mkdtemp, writeFile, rm, readdir, lstat, chmod } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export const PRIVATE_TEMP_PREFIX = 'gfai-'

const SAFE_NAME = /^[\w][\w.-]{0,63}$/

/** Create a fresh directory only the current user can read, write or enter. */
export async function makePrivateTempDir(prefix: string = PRIVATE_TEMP_PREFIX): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  // mkdtemp already uses 0o700 on POSIX; set it explicitly so a permissive
  // umask or platform default never widens it.
  await chmod(dir, 0o700).catch(() => {})
  return dir
}

/** Path for a plain file name inside a private dir. Rejects separators and dot-files. */
export function privateTempPath(dir: string, name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`Unsafe temp file name: ${name}`)
  return join(dir, name)
}

/** Create a new file (fails if it already exists) readable only by the current user. */
export async function writePrivateFile(dir: string, name: string, data: string | Uint8Array): Promise<string> {
  const filePath = privateTempPath(dir, name)
  await writeFile(filePath, data, { flag: 'wx', mode: 0o600 })
  return filePath
}

/** Run fn with a private temp dir and always remove the dir afterwards. */
export async function withPrivateTempDir<T>(fn: (dir: string) => Promise<T>, prefix: string = PRIVATE_TEMP_PREFIX): Promise<T> {
  const dir = await makePrivateTempDir(prefix)
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Remove leftover `gfai-*` entries in tmpdir() older than maxAgeMs — both the
 * private dirs made above (e.g. screenshots whose path was returned to the
 * user) and legacy flat files. Uses lstat so a symlink is removed itself and
 * never followed.
 */
export async function sweepPrivateTemp(
  maxAgeMs: number,
  opts: { now?: number; root?: string; prefix?: string } = {},
): Promise<{ cleared: number; freedBytes: number }> {
  const root = opts.root ?? tmpdir()
  const prefix = opts.prefix ?? PRIVATE_TEMP_PREFIX
  const now = opts.now ?? Date.now()
  const entries = await readdir(root).catch(() => [] as string[])
  let cleared = 0
  let freedBytes = 0
  for (const name of entries.filter(n => n.startsWith(prefix))) {
    const entryPath = join(root, name)
    try {
      const s = await lstat(entryPath)
      if (now - s.mtimeMs <= maxAgeMs) continue
      let size = s.isFile() ? s.size : 0
      if (s.isDirectory()) {
        for (const child of await readdir(entryPath).catch(() => [] as string[])) {
          const cs = await lstat(join(entryPath, child)).catch(() => null)
          if (cs?.isFile()) size += cs.size
        }
      }
      await rm(entryPath, { recursive: true, force: true })
      freedBytes += size
      cleared++
    } catch { /* skip locked or vanished entries */ }
  }
  return { cleared, freedBytes }
}
