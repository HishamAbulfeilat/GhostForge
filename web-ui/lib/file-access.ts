/**
 * Path policy for the file browser API (/api/files).
 *
 * Non-admins are confined to one workspace folder (GF_FILES_ROOT, default
 * ~/GhostForge — the folder the Files page opens), and never see dotfiles or
 * dot-folders (.env*, .git, ...) or the credential stores ~/.ghostforge and
 * ~/.ssh, even if GF_FILES_ROOT is pointed at the home folder. Admins keep the
 * home folder, because the admin-only Projects page links registered projects
 * that can live anywhere under it.
 *
 * Every path is resolved with realpath before the containment check, so a
 * symlink inside the root cannot lead outside it. For writes the parent folder
 * is resolved and the final component must not be a symlink.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface FileAccessOptions {
  admin: boolean
  /** Overrides for tests */
  home?: string
  env?: NodeJS.ProcessEnv
}

export class FileAccessError extends Error {}

function expandHome(p: string, home: string): string {
  return p.replace(/^~(?=[/\\]|$)/, home)
}

/** The configured workspace root for non-admins (not resolved). */
export function filesRoot(opts: Pick<FileAccessOptions, 'home' | 'env'> = {}): string {
  const home = opts.home ?? os.homedir()
  const env = opts.env ?? process.env
  const configured = env.GF_FILES_ROOT?.trim()
  return path.resolve(expandHome(configured || path.join(home, 'GhostForge'), home))
}

/** Default folder to open when the client sends no path. */
export function defaultFilesPath(opts: FileAccessOptions): string {
  return opts.admin ? (opts.home ?? os.homedir()) : filesRoot(opts)
}

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function realRoot(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    throw new FileAccessError('Access denied: the workspace folder does not exist')
  }
}

/** Credential stores that are never exposed to non-admins, wherever the root is. */
function deniedStores(home: string): string[] {
  const out: string[] = []
  for (const name of ['.ghostforge', '.ssh']) {
    const p = path.join(home, name)
    out.push(p)
    try { out.push(fs.realpathSync(p)) } catch { /* missing is fine */ }
  }
  return out
}

function checkPolicy(real: string, root: string, opts: FileAccessOptions, home: string): void {
  if (!isInside(real, root)) throw new FileAccessError('Access denied: path outside the allowed folder')
  if (opts.admin) return
  if (deniedStores(home).some(store => isInside(real, store))) {
    throw new FileAccessError('Access denied: protected folder')
  }
  const rel = path.relative(root, real)
  if (rel && rel.split(path.sep).some(seg => seg.startsWith('.'))) {
    throw new FileAccessError('Access denied: hidden files and folders are not available')
  }
}

function allowedRoot(opts: FileAccessOptions, home: string): string {
  return realRoot(opts.admin ? home : filesRoot(opts))
}

function absolute(rawPath: string, opts: FileAccessOptions, home: string): string {
  const raw = String(rawPath ?? '').trim()
  if (!raw || raw.includes('\0')) throw new FileAccessError('Invalid path')
  const expanded = expandHome(raw, home)
  // Relative paths are taken relative to the allowed root, not the server cwd.
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(opts.admin ? home : filesRoot(opts), expanded)
}

/** Resolve a path for reading/listing. Returns the real (symlink-free) path. */
export function resolveReadPath(rawPath: string, opts: FileAccessOptions): string {
  const home = opts.home ?? os.homedir()
  const root = allowedRoot(opts, home)
  let real: string
  try {
    real = fs.realpathSync(absolute(rawPath, opts, home))
  } catch (err) {
    if (err instanceof FileAccessError) throw err
    throw new FileAccessError('Not found')
  }
  checkPolicy(real, root, opts, home)
  return real
}

/**
 * Resolve a path for writing: the parent folder must exist and resolve inside
 * the allowed root, and the target itself must not be a symlink.
 */
export function resolveWritePath(rawPath: string, opts: FileAccessOptions): string {
  const home = opts.home ?? os.homedir()
  const root = allowedRoot(opts, home)
  const abs = absolute(rawPath, opts, home)
  const name = path.basename(abs)
  if (!name || name === '.' || name === '..') throw new FileAccessError('Invalid path')
  let parent: string
  try {
    parent = fs.realpathSync(path.dirname(abs))
  } catch {
    throw new FileAccessError('Folder not found')
  }
  const target = path.join(parent, name)
  checkPolicy(target, root, opts, home)
  try {
    if (fs.lstatSync(target).isSymbolicLink()) throw new FileAccessError('Access denied: refusing to write through a symlink')
  } catch (err) {
    if (err instanceof FileAccessError) throw err
    // ENOENT: a new file, fine
  }
  return target
}

/** Write without following a symlink at the final component (where the OS supports it). */
export function writeFileNoFollow(target: string, content: string): void {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = fs.constants
  const fd = fs.openSync(target, O_WRONLY | O_CREAT | O_TRUNC | (O_NOFOLLOW ?? 0), 0o644)
  try {
    fs.writeFileSync(fd, content, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/** Whether a directory entry should be listed for this caller. */
export function isListable(name: string, opts: Pick<FileAccessOptions, 'admin'>): boolean {
  if (!name.startsWith('.')) return true
  return opts.admin && (name === '.env' || name === '.gitignore')
}
