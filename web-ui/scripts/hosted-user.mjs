#!/usr/bin/env node
/**
 * Make a GHOSTFORGE_FRIENDS entry for hosted mode (docs/HOSTING.md).
 *
 *   node scripts/hosted-user.mjs alice            # prompts for a password
 *   node scripts/hosted-user.mjs alice --generate # makes a random password
 *
 * Prints `alice:<salt>:<hash>`: the same scrypt format as lib/users.ts. Join
 * several with commas into GHOSTFORGE_FRIENDS. Only the hash goes into the
 * host's settings; send the password to your friend privately.
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

const [username = '', flag] = process.argv.slice(2)
if (!/^[a-z0-9][a-z0-9._-]{1,31}$/i.test(username)) {
  console.error('Usage: node scripts/hosted-user.mjs <username> [--generate]\nUsername: 2-32 letters, digits, dot, dash or underscore.')
  process.exit(1)
}

let password
if (flag === '--generate') {
  password = randomBytes(12).toString('base64url')
} else {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  password = (await rl.question(`Password for ${username} (8+ characters, shown as you type): `)).trim()
  rl.close()
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters')
  process.exit(1)
}

const salt = randomBytes(16).toString('hex')
const hash = scryptSync(password, salt, 64).toString('hex')
if (flag === '--generate') console.error(`Password for ${username}: ${password}`)
console.log(`${username.toLowerCase()}:${salt}:${hash}`)
