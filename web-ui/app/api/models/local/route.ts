import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { exec } from 'child_process'
import { promisify } from 'util'
import { access, readdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import net from 'net'
import { isAuthorizedRequest } from '@/lib/auth'
import { getRunnerModels, type RunnerId } from '@/lib/local-models'
import { detectHardware } from '@/lib/llmfit-models'

export const dynamic = 'force-dynamic'

const execAsync = promisify(exec)

interface RunnerStatus {
  runner: RunnerId
  detected: boolean
  running: boolean
  statusLabel: string
}

function probePort(port: number, host = '127.0.0.1', timeout = 800) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (value: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function exists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function getProcessOutput() {
  try {
    const { stdout } = await execAsync('ps -ax -o command')
    return stdout.toLowerCase()
  } catch {
    return ''
  }
}

async function getOllamaInstalled() {
  try {
    const { stdout } = await execAsync('ollama list')
    return stdout
      .split('\n')
      .slice(1)
      .map(line => line.trim().split(/\s+/)[0])
      .filter(Boolean)
  } catch {
    return [] as string[]
  }
}

async function getLlamafileInstalled() {
  const searchDirs = [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Models'),
    path.join(os.homedir(), 'GhostForge', 'models'),
  ]

  const matches = new Set<string>()
  for (const dir of searchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      entries
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.llamafile'))
        .forEach(entry => {
          matches.add(entry.name)
        })
    } catch {
      // ignore missing directories
    }
  }

  return Array.from(matches)
}

function buildStatus(runner: RunnerId, detected: boolean, running: boolean): RunnerStatus {
  const statusLabel = running
    ? 'running'
    : detected
      ? 'detected'
      : 'not detected'

  return { runner, detected, running, statusLabel }
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [processOutput, ollamaPortOpen, ollamaInstalled, llamafiles, hardware] = await Promise.all([
    getProcessOutput(),
    probePort(11434),
    getOllamaInstalled(),
    getLlamafileInstalled(),
    detectHardware(),
  ])

  const ollamaRunning = ollamaPortOpen || processOutput.includes('ollama serve')
  const llamafileRunning = processOutput.includes('llamafile')
  const lmStudioDetected = (await exists('/Applications/LM Studio.app')) || processOutput.includes('lm studio')
  const janDetected = (await exists('/Applications/Jan.app')) || processOutput.includes('/jan.app') || processOutput.includes(' jan ')

  const statuses: Record<RunnerId, RunnerStatus> = {
    ollama: buildStatus('ollama', ollamaInstalled.length > 0 || ollamaRunning, ollamaRunning),
    llamafile: buildStatus('llamafile', llamafiles.length > 0 || llamafileRunning, llamafileRunning),
    'lm-studio': buildStatus('lm-studio', lmStudioDetected, processOutput.includes('lm studio')),
    jan: buildStatus('jan', janDetected, processOutput.includes('/jan.app') || processOutput.includes('jan.ai')),
  }

  const installedByRunner: Record<RunnerId, string[]> = {
    ollama: ollamaInstalled,
    llamafile: llamafiles,
    'lm-studio': [],
    jan: [],
  }

  return NextResponse.json({
    runners: statuses,
    installedModels: installedByRunner,
    machine: {
      ramGB: hardware.ramGB,
      availableGB: hardware.availableGB,
      cpuBrand: hardware.cpuBrand,
      appleSilicon: hardware.isAppleSilicon,
    },
    catalog: {
      ollama: getRunnerModels('ollama').length,
      llamafile: getRunnerModels('llamafile').length,
      'lm-studio': getRunnerModels('lm-studio').length,
      jan: getRunnerModels('jan').length,
    },
  })
}
