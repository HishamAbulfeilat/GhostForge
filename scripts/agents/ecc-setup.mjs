#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stateDir } from './lib/bus.mjs'
import { ensureECC, loadECCConfig } from './lib/ecc.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const offline = process.argv.includes('--offline') || process.env.GF_ECC_OFFLINE === '1'
const config = loadECCConfig(root)
const result = ensureECC(config, stateDir(root), { offline })

if (!result.enabled) {
  console.log('ECC is disabled in .agent-sync/ecc.json')
} else {
  console.log(`ECC ${result.ref} ready at ${result.cache}`)
}
