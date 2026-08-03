#!/usr/bin/env node
/**
 * node-pty 1.1.0 ships the macOS spawn-helper binary without the execute bit
 * (644 instead of 755), which makes every pty.spawn() fail with
 * "posix_spawnp failed." Restore the bit after install so the web terminal
 * works out of the box.
 */
const fs = require('fs')
const path = require('path')

const candidates = [
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
]

for (const p of candidates) {
  try {
    fs.chmodSync(p, 0o755)
    console.log(`[ghostforge] fixed spawn-helper permissions: ${p}`)
  } catch { /* not present — nothing to fix */ }
}
