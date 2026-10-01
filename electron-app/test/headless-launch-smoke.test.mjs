import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  HEADLESS_BRIDGE_LOG,
  HEADLESS_CLEAN_LOG,
  HEADLESS_SMOKE_ARG,
  HEADLESS_SMOKE_ENV,
  HEADLESS_STARTUP_LOG,
} from '../dist/main/headless-smoke.js'

const electronAppDir = fileURLToPath(new URL('..', import.meta.url))
const electronBin = process.platform === 'win32'
  ? join(electronAppDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  : join(electronAppDir, 'node_modules', '.bin', 'electron')

test('Electron app launches in headless CI mode and reaches the bridge', async () => {
  const child = spawn(electronBin, ['.', HEADLESS_SMOKE_ARG], {
    cwd: electronAppDir,
    env: {
      ...process.env,
      CI: '1',
      GITHUB_ACTIONS: '1',
      ELECTRON_ENABLE_LOGGING: '1',
      [HEADLESS_SMOKE_ENV]: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let output = ''
  let settled = false
  const startupTimeoutMs = 60_000

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Electron headless smoke timed out after ${startupTimeoutMs}ms. Output:\n${output}`))
    }, startupTimeoutMs)

    const onOutput = (chunk) => {
      const text = chunk.toString()
      output += text
    }

    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Unable to launch Electron headless smoke: ${error.message}\nOutput:\n${output}`))
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      if (code === 0 && output.includes(HEADLESS_STARTUP_LOG) && output.includes(HEADLESS_CLEAN_LOG)) {
        settled = true
        clearTimeout(timeout)
        resolve()
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Electron headless launch or cleanup failed with code=${code} signal=${signal}. Output:\n${output}`))
    })
  })

  assert.match(output, /startup-ready|bridge-reachable/si)
  assert.ok(output.includes(HEADLESS_CLEAN_LOG), `Expected clean shutdown log. Output:\n${output}`)
})
