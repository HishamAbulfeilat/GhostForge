#!/usr/bin/env node

import { setupAiTown } from '../../../scripts/worlds.mjs'

try {
  setupAiTown()
} catch (error) {
  console.error(`AI Town setup failed: ${error.message}`)
  process.exitCode = 1
}
