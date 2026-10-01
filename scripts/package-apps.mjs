#!/usr/bin/env node
// Bounded packaged-app build: runs an electron-app npm script for an allowlisted platform.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = resolve(root, 'electron-app')

// Must match script names in electron-app/package.json (enforced by the test).
export const PLATFORMS = Object.freeze({
  mac: 'build:mac',
  win: 'build:win',
  linux: 'build:linux',
  android: 'build:android',
})

export const TIMEOUT_MS = 30 * 60 * 1000

export function usage() {
  return `Usage: package-apps <${Object.keys(PLATFORMS).join('|')}> [--dry-run]

Runs the matching electron-app npm script (${Object.values(PLATFORMS).join(', ')}).
  --dry-run   print the command without running it
  -h, --help  show this help`
}

export function parseArgs(argv) {
  let platform
  let dryRun = false
  let help = false
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true
    else if (arg === '-h' || arg === '--help') help = true
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    else if (platform) throw new Error(`Unexpected argument: ${arg}`)
    else platform = arg
  }
  if (help) return { help: true }
  if (!platform) throw new Error('Missing platform')
  if (!Object.hasOwn(PLATFORMS, platform)) {
    throw new Error(`Unknown platform: ${platform} (expected ${Object.keys(PLATFORMS).join(', ')})`)
  }
  return { platform, dryRun }
}

export function buildCommand(platform) {
  if (!Object.hasOwn(PLATFORMS, platform)) throw new Error(`Unknown platform: ${platform}`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return { command: npm, args: ['run', PLATFORMS[platform]], cwd: appDir }
}

export function run(argv, { spawn = spawnSync, log = console.log } = {}) {
  const opts = parseArgs(argv)
  if (opts.help) { log(usage()); return 0 }
  const { command, args, cwd } = buildCommand(opts.platform)
  const line = `${command} ${args.join(' ')} (cwd: ${cwd})`
  if (opts.dryRun) { log(`[dry-run] ${line}`); return 0 }
  log(`Running: ${line}`)
  const res = spawn(command, args, {
    cwd, stdio: 'inherit', timeout: TIMEOUT_MS, shell: process.platform === 'win32',
  })
  if (res.error) throw new Error(`Build failed to run: ${res.error.message}`)
  return res.status ?? 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(run(process.argv.slice(2)))
  } catch (err) {
    console.error(`package-apps: ${err.message}\n\n${usage()}`)
    process.exit(2)
  }
}
