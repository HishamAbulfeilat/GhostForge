#!/usr/bin/env node
// Read-only project file browser: `ghostforge files list|read`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_MAX_BYTES = 256 * 1024

export function usage() {
  return [
    'Usage:',
    '  ghostforge files list [path] [--root DIR] [--json]',
    '  ghostforge files read <path> [--root DIR] [--max-bytes N]',
    '',
    'Read-only. Paths are relative to the project root (default: the directory',
    'you run the command from). Paths outside the root, symlinks that escape it,',
    `.git, node_modules and .env* are refused. Reads are capped at ${DEFAULT_MAX_BYTES} bytes by default.`,
    '',
  ].join('\n')
}

export class FilesError extends Error {}

/** Normalise one path segment the way Windows/macOS would before matching. */
function canonicalSegment(name) {
  let n = String(name).toLowerCase()
  const ads = n.indexOf(':')
  if (ads !== -1) n = n.slice(0, ads) // NTFS alternate data stream: .env::$DATA
  return n.replace(/[. ]+$/, '') // Windows ignores trailing dots/spaces
}

export function isBlockedName(name) {
  const n = canonicalSegment(name)
  if (!n) return false
  if (n === '.git' || n === 'node_modules' || n.startsWith('.env')) return true
  // 8.3 short names of the above (GIT~1, ENV~1, NODE_M~1)
  return /^(git|env|node_m[a-z_]*)~\d+(\..*)?$/.test(n)
}

function blockedSegment(rel) {
  return rel.split(/[\\/]+/).find(isBlockedName)
}

function within(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Resolve `input` under `root`, rejecting traversal, symlink escape and
 * blocked names (checked on both the requested and the real path).
 */
export function resolveInRoot(rootInput, input = '.') {
  let root
  try {
    root = fs.realpathSync(path.resolve(rootInput))
  } catch {
    throw new FilesError(`Root not found: ${rootInput}`)
  }
  if (String(input).includes('\0')) throw new FilesError('Invalid path')
  const lexical = path.resolve(root, input)
  if (!within(root, lexical)) throw new FilesError(`Path escapes the project root: ${input}`)
  const bad = blockedSegment(path.relative(root, lexical))
  if (bad) throw new FilesError(`Access to ${bad} is not allowed`)
  let real
  try {
    real = fs.realpathSync(lexical)
  } catch {
    throw new FilesError(`Not found: ${input}`)
  }
  if (!within(root, real)) throw new FilesError(`Path escapes the project root via symlink: ${input}`)
  const badReal = blockedSegment(path.relative(root, real))
  if (badReal) throw new FilesError(`Access to ${badReal} is not allowed`)
  return { root, real }
}

export function listDir(root, input = '.') {
  const { real } = resolveInRoot(root, input)
  if (!fs.statSync(real).isDirectory()) throw new FilesError(`Not a directory: ${input}`)
  return fs
    .readdirSync(real, { withFileTypes: true })
    .filter(e => !isBlockedName(e.name))
    .map(e => {
      const rel = path.relative(root, path.join(real, e.name))
      let type = e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'dir' : 'file'
      let size = null
      try {
        const target = resolveInRoot(root, rel).real // throws if the link escapes or is blocked
        const st = fs.statSync(target)
        if (st.isDirectory()) type = 'dir'
        else if (st.isFile()) size = st.size
      } catch { /* escaping or broken link: listed as symlink only */ }
      return { name: e.name, type, size }
    })
    .sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)
}

export function readFile(root, input, maxBytes = DEFAULT_MAX_BYTES) {
  if (!input) throw new FilesError('Missing file path')
  const { real } = resolveInRoot(root, input)
  const st = fs.statSync(real)
  if (!st.isFile()) throw new FilesError(`Not a regular file: ${input}`)
  const len = Math.min(st.size, maxBytes)
  const buf = Buffer.alloc(len)
  const fd = fs.openSync(real, 'r')
  try {
    fs.readSync(fd, buf, 0, len, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (buf.includes(0)) throw new FilesError(`Binary file not shown: ${input}`)
  return { content: buf.toString('utf8'), size: st.size, truncated: st.size > maxBytes }
}

export function parseArgs(argv) {
  const out = { command: null, target: null, root: null, json: false, maxBytes: DEFAULT_MAX_BYTES, help: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--json') out.json = true
    else if (a === '--root') out.root = argv[++i]
    else if (a === '--max-bytes') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) throw new FilesError('--max-bytes must be a positive integer')
      out.maxBytes = n
    } else rest.push(a)
  }
  out.command = rest[0] || null
  out.target = rest[1] ?? null
  return out
}

export function main(argv, env = process.env, io = { out: s => process.stdout.write(s), err: s => process.stderr.write(s) }) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    io.err(`${e.message}\n`)
    return 1
  }
  if (opts.help || !opts.command) {
    io.out(usage())
    return opts.help ? 0 : 1
  }
  const root = opts.root || env.GF_CALLER_CWD || process.cwd()
  try {
    if (opts.command === 'list') {
      const entries = listDir(root, opts.target || '.')
      if (opts.json) io.out(`${JSON.stringify(entries, null, 2)}\n`)
      else io.out(entries.map(e => e.type === 'dir' ? `${e.name}/` : e.type === 'symlink' ? `${e.name}@` : `${e.name}\t${e.size ?? ''}`).join('\n') + (entries.length ? '\n' : ''))
      return 0
    }
    if (opts.command === 'read') {
      const r = readFile(root, opts.target, opts.maxBytes)
      io.out(r.content)
      if (r.truncated) io.err(`\n[truncated: showing ${opts.maxBytes} of ${r.size} bytes]\n`)
      return 0
    }
    io.err(`Unknown files command: ${opts.command}\n\n${usage()}`)
    return 1
  } catch (e) {
    if (!(e instanceof FilesError)) throw e
    io.err(`${e.message}\n`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
