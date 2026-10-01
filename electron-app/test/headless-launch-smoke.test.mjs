import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  HEADLESS_BRIDGE_LOG,
  HEADLESS_SMOKE_ARG,
  HEADLESS_SMOKE_ENV,
  HEADLESS_STARTUP_LOG,
} from '../dist/main/headless-smoke.js'

const electronAppDir = fileURLToPath(new URL('..', import.meta.url))
const electronBin = process.platform === 'win32'
  ? join(electronAppDir, 'node_modules', '.bin', 'electron.cmd')
  : join(electronAppDir, 'node_modules', '.bin', 'electron')

test('Electron app launches in headless CI mode and reaches the bridge', async () => {
  const child = spawn(process.platform === 'win32' ? 'cmd' : electronBin, process.platform === 'win32'
    ? ['/c', electronBin, '.', HEADLESS_SMOKE_ARG]
    : ['.', HEADLESS_SMOKE_ARG], {
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
      const hasStartup = text.includes(HEADLESS_STARTUP_LOG)
      const hasBridgeReady = text.includes(HEADLESS_BRIDGE_LOG)
      if ((hasStartup || hasBridgeReady) && !settled) {
        settled = true
        clearTimeout(timeout)
        child.kill('SIGTERM')
        resolve()
      }
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
      if (signal === 'SIGTERM' || (code === 0 && output.includes(HEADLESS_BRIDGE_LOG))) {
        settled = true
        clearTimeout(timeout)
        resolve()
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Electron headless launch failed with code=${code} signal=${signal}. Output:\n${output}`))
    })
  })

  assert.match(output, /startup-ready|bridge-reachable/si)
})
