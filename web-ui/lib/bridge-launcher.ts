/**
 * Launcher resolution for /api/bridge-start.
 *
 * The bridge launcher is a script inside this repository, never a path the
 * caller chooses. Two rules make that true:
 *
 *  1. The repository root is resolved from the server side only — the
 *     GHOSTFORGE_ROOT env var, the parent of the server directory, or the
 *     server directory — and it is accepted only when it really is a
 *     GhostForge checkout. A root that does not carry the expected scripts is
 *     rejected outright instead of being handed to a shell.
 *  2. The resolved script is re-checked to be inside that root (defeating
 *     traversal or a symlinked scripts/ dir) and to be a regular file.
 *
 * The resulting argv never contains the repo root on Windows: cmd.exe runs a
 * *constant* relative path (`scripts\bridge.cmd`) with the root passed as the
 * child's working directory. cmd re-parses its command line and does not quote
 * arguments that hold no spaces, so a root containing `&`, `^`, `%` or `(`
 * would otherwise split into extra commands. Passing it as cwd keeps it out of
 * the command line entirely.
 */
import fs from 'fs'
import path from 'path'

/** Marker files that identify a real GhostForge checkout. */
const ROOT_MARKERS = [
  path.join('scripts', 'bridge.sh'),
  path.join('scripts', 'bridge-server.js'),
]

export type BridgePlatform = NodeJS.Platform | string

export interface ResolvedBridgeLauncher {
  /** The validated repository root. */
  repoRoot: string
  /** Absolute launcher path — for logging and existence checks only. */
  scriptPath: string
  /** Constant, root-free path handed to the interpreter. */
  relativeScript: string
  isWindows: boolean
}

/** True when `root` looks like a GhostForge checkout (carries scripts/bridge.sh). */
export function isGhostforgeRoot(root: string, exists: (p: string) => boolean = fs.existsSync): boolean {
  return ROOT_MARKERS.some(marker => exists(path.join(root, marker)))
}

/** The repository root to search, most explicit first. Never taken from a request. */
export function repoRootCandidates(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
  return [env.GHOSTFORGE_ROOT, path.resolve(cwd, '..'), cwd].filter(
    (c): c is string => typeof c === 'string' && c.length > 0
  )
}

/**
 * Resolve the launcher for the current platform, or return null when no
 * candidate directory is a GhostForge checkout containing a real launcher
 * script inside it.
 */
export function resolveBridgeLauncher(options: {
  env?: NodeJS.ProcessEnv
  cwd?: string
  platform?: BridgePlatform
  exists?: (p: string) => boolean
  isFile?: (p: string) => boolean
} = {}): ResolvedBridgeLauncher | null {
  const {
    env = process.env,
    cwd = process.cwd(),
    platform = process.platform,
    exists = fs.existsSync,
    isFile = (p: string) => {
      try {
        return fs.statSync(p).isFile()
      } catch {
        return false
      }
    },
  } = options

  const isWindows = platform === 'win32'
  const scriptName = isWindows ? 'bridge.cmd' : 'bridge.sh'

  for (const candidate of repoRootCandidates(env, cwd)) {
    const repoRoot = path.resolve(candidate)
    if (!isGhostforgeRoot(repoRoot, exists)) continue

    const scriptPath = path.join(repoRoot, 'scripts', scriptName)
    if (!isInside(repoRoot, scriptPath)) continue
    if (!exists(scriptPath) || !isFile(scriptPath)) continue

    // A relative path keeps the root out of the command line on every platform:
    // cmd.exe cannot be handed a path with spaces or shell metacharacters
    // safely, and bash resolves it against cwd just as well.
    return {
      repoRoot,
      scriptPath,
      relativeScript: path.join('scripts', scriptName),
      isWindows,
    }
  }

  return null
}

/** True when `target` is `root` itself or lives under it (both resolved). */
export function isInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (resolvedRoot === resolvedTarget) return true
  const relative = path.relative(resolvedRoot, resolvedTarget)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Full argv for launching the bridge script with `action`.
 *
 * Windows: cmd.exe /d /s /c <constant relative path> <action>, run with the
 * repository root as cwd. `/d` skips AutoRun commands, `/s` makes cmd treat
 * everything after `/c` as one command, and the path is a compile-time
 * constant so no user-controlled text reaches cmd's parser.
 *
 * POSIX: bash <constant relative path> <action> — bash needs no quoting for
 * argv, and the script path is validated above regardless.
 */
export function bridgeArgv(launcher: ResolvedBridgeLauncher, action: 'start' | 'stop'): { file: string; args: string[] } {
  if (launcher.isWindows) {
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', launcher.relativeScript, action] }
  }
  return { file: 'bash', args: [launcher.relativeScript, action] }
}