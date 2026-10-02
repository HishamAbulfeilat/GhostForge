#!/usr/bin/env node

import { setupAiTown } from '../../../scripts/worlds.mjs'

try {
  setupAiTown()
} catch (error) {
  console.error(`AI Town setup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
