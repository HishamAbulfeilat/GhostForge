#!/usr/bin/env node
// Watchdog — keeps the boss running unattended (overnight, across crashes and
// closed terminals). Run it on a schedule; each run is a cheap no-op when the
// boss is alive, and restarts it detached when it is not. An explicit stop
// (`node scripts/agents/team.mjs stop`, which leaves a STOP file) is respected.
//
// Usage:
//   node scripts/agents/watchdog.mjs              check once; start the boss if it is down
//   node scripts/agents/watchdog.mjs --install    Windows: run the check every 5 min (Task Scheduler)
//   node scripts/agents/watchdog.mjs --uninstall  Windows: remove the scheduled task

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stateDir } from './lib/bus.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TASK_NAME = 'GhostForge Boss Watchdog'

/** True when `pid` is a live process. */
export function isAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function log(dir, msg) {
  fs.appendFileSync(path.join(dir, 'boss.log'), `[${new Date().toISOString()}] watchdog: ${msg}\n`)
}

export function check(root = ROOT, dir = stateDir(root)) {
  if (fs.existsSync(path.join(dir, 'STOP'))) return 'stopped-by-user'
  const pid = Number(fs.existsSync(path.join(dir, 'boss.pid')) && fs.readFileSync(path.join(dir, 'boss.pid'), 'utf8'))
  if (isAlive(pid)) return 'alive'
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  const out = fs.openSync(path.join(dir, 'logs', 'boss-stdout.log'), 'a')
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'agents', 'boss.mjs'), 'start'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, out],
  })
  child.unref()
  log(dir, `boss was not running (last pid ${pid || 'none'}) — started pid ${child.pid}`)
  return 'restarted'
}

function install() {
  if (process.platform !== 'win32') {
    console.log(`Add to crontab -e:\n*/5 * * * * cd ${ROOT} && ${process.execPath} scripts/agents/watchdog.mjs`)
    return
  }
  // A VBS launcher runs node with no console window (a plain node.exe task flashes one every run).
  const vbs = path.join(stateDir(ROOT), 'watchdog-hidden.vbs')
  const q = s => `""${s}""`
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${q(process.execPath)} ${q(fileURLToPath(import.meta.url))}", 0, False\r\n`)
  const r = spawnSync('schtasks', ['/Create', '/F', '/TN', TASK_NAME, '/SC', 'MINUTE', '/MO', '5', '/TR', `wscript.exe //B "${vbs}"`], { encoding: 'utf8', windowsHide: true })
  console.log((r.stdout || r.stderr).trim())
  // schtasks defaults to "don't start on batteries / stop on battery", which
  // silently paused the team for 8h one night on a laptop. Allow battery runs
  // and catch up after sleep.
  const ps = `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName '${TASK_NAME}' -Settings $s | Out-Null; 'battery runs allowed'`
  const b = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true })
  const out = String(b.stdout || b.stderr || b.error?.message || '').trim()
  if (b.status !== 0) console.warn(`warning: could not allow battery runs for the watchdog task: ${out}`)
  else console.log(out)
}

function uninstall() {
  const r = spawnSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], { encoding: 'utf8', windowsHide: true })
  console.log((r.stdout || r.stderr).trim())
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = process.argv[2]
  if (arg === '--install') install()
  else if (arg === '--uninstall') uninstall()
  else console.log(check())
}
