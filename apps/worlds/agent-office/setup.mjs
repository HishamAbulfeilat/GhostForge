#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORLD_DIR = path.dirname(fileURLToPath(import.meta.url))
const CHECKOUT_DIR = path.join(WORLD_DIR, 'checkout')
const REPOSITORY = 'https://github.com/harishkotra/agent-office.git'
export const PINNED_COMMIT = '58f11f9b31770c10bcf3d7a0618325d22bd0ee9e'
const MODEL_CONFIGURATION = `const gatewayUrl = process.env.AGENT_OFFICE_MODEL_GATEWAY_URL
    || process.env.OMNIROUTE_URL
    || process.env.OPENROUTER_BASE_URL
    || process.env.OPENAI_BASE_URL;
const gatewayKey = process.env.AGENT_OFFICE_MODEL_GATEWAY_API_KEY
    || (gatewayUrl === process.env.OMNIROUTE_URL
        ? process.env.OMNIROUTE_API_KEY
        : gatewayUrl === process.env.OPENROUTER_BASE_URL
            ? process.env.OPENROUTER_API_KEY
            : process.env.OPENAI_API_KEY)
    || '';
const modelProvider = gatewayUrl ? 'openai' : 'ollama';
const modelName = process.env.AGENT_OFFICE_MODEL
    || process.env.GHOSTFORGE_MODEL_GATEWAY_MODEL
    || process.env.OPENAI_MODEL
    || (gatewayUrl === process.env.OPENROUTER_BASE_URL ? 'deepseek/deepseek-r1:free' : gatewayUrl === process.env.OMNIROUTE_URL ? 'auto' : gatewayUrl ? 'gpt-4o-mini' : 'llama3.2:latest');
const configuredModelAdapter = (() => {
    if (!gatewayUrl) return new OllamaAdapter(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    const endpoint = new URL(gatewayUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol)
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
        || !['', '/v1', '/v1/'].includes(endpoint.pathname)) {
        throw new Error('Agent Office model gateway must be an HTTP(S) origin, optionally ending in /v1.');
    }
    endpoint.pathname = '';
    return new OpenAICompatibleAdapter(endpoint.toString().replace(/\\/$/, ''), gatewayKey);
})();`

function run(command, args, options = {}) {
  const windowsShim = process.platform === 'win32' && command === 'npm'
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? WORLD_DIR,
    stdio: 'inherit',
    shell: windowsShim,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}`)
  }
}

function git(args, options = {}) {
  run('git', args, options)
}

async function patchCheckout(relativePath, original, replacement) {
  const filePath = path.join(CHECKOUT_DIR, relativePath)
  const source = await readFile(filePath, 'utf8')
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  let contents = source.replace(/\r\n/g, '\n')
  const originals = Array.isArray(original) ? original : [original]
  if (originals.some(value => replacement.includes(value)) && contents.includes(replacement)) return
  const presentOriginals = originals.filter(value => contents.includes(value))
  if (!presentOriginals.length) {
    if (contents.includes(replacement)) return
    throw new Error(`Cannot apply the Agent Office runtime patch to ${relativePath}`)
  }
  for (const value of presentOriginals) contents = contents.replaceAll(value, replacement)
  await writeFile(filePath, contents.replace(/\n/g, lineEnding), 'utf8')
}

async function ensureModelConfiguration() {
  const filePath = path.join(CHECKOUT_DIR, 'packages/server/src/rooms/OfficeRoom.ts')
  const source = await readFile(filePath, 'utf8')
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const withoutOldConfigurations = source
    .replace(/\r\n/g, '\n')
    .replace(/const gatewayUrl = process\.env\.AGENT_OFFICE_MODEL_GATEWAY_URL[\s\S]*?^\}\)\(\);/gm, '')
  const importLine = "import { MemoryStore } from '../memory/MemoryStore';"
  if (!withoutOldConfigurations.includes(importLine)) {
    throw new Error('Cannot apply the Agent Office model configuration patch.')
  }
  const configured = withoutOldConfigurations.replace(importLine, `${importLine}\n\n${MODEL_CONFIGURATION}`)
  await writeFile(filePath, configured.replace(/\n/g, lineEnding), 'utf8')
}

async function omitEmptyGatewayAuthorization() {
  const relativePath = 'packages/adapters/src/OpenAICompatibleAdapter.ts'
  const filePath = path.join(CHECKOUT_DIR, relativePath)
  const source = await readFile(filePath, 'utf8')
  const pattern = /(['"])Authorization\1\s*:\s*`[^`]*`,?/
  const replacement = "...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),"
  if (!pattern.test(source)) {
    if (source.includes(replacement)) return
    throw new Error(`Cannot apply the Agent Office gateway header patch to ${relativePath}`)
  }
  await writeFile(filePath, source.replace(pattern, replacement), 'utf8')
}

async function configureCheckout() {
  await patchCheckout(
    'packages/server/src/index.ts',
    [
      'colyseusServer.listen(PORT).then(() => {',
      "colyseusServer.listen(PORT, process.env.AGENT_OFFICE_HOST || '127.0.0.1').then(() => {",
    ],
    "colyseusServer.listen(PORT, '127.0.0.1').then(() => {",
  )
  await patchCheckout(
    'packages/server/src/rooms/OfficeRoom.ts',
    "import { OllamaAdapter } from '@agent-office/adapters';",
    "import { OllamaAdapter, OpenAICompatibleAdapter } from '@agent-office/adapters';",
  )
  await ensureModelConfiguration()
  await omitEmptyGatewayAuthorization()
  await patchCheckout(
    'packages/server/src/rooms/OfficeRoom.ts',
    "private ollamaAdapter = new OllamaAdapter('http://localhost:11434');",
    'private modelAdapter = configuredModelAdapter;',
  )
  await patchCheckout(
    'packages/server/src/rooms/OfficeRoom.ts',
    "provider: 'ollama',\n                    model: 'llama3.2:latest',",
    'provider: modelProvider,\n                    model: modelName,',
  )
  await patchCheckout(
    'packages/server/src/rooms/OfficeRoom.ts',
    "provider: 'ollama',\n                                        model: 'llama3.2:latest',",
    'provider: modelProvider,\n                                        model: modelName,',
  )
  await patchCheckout(
    'packages/server/src/rooms/OfficeRoom.ts',
    'this.ollamaAdapter',
    'this.modelAdapter',
  )
  await patchCheckout(
    'packages/server/src/memory/MemoryStore.ts',
    "constructor(ollamaUrl: string = 'http://localhost:11434') {",
    "constructor(ollamaUrl: string = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') {",
  )
  await patchCheckout(
    'packages/ui/vite.config.ts',
    [
      `server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3000',
        }
    },`,
      `server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
        }
    },`,
    ],
    `server: {
        host: '127.0.0.1',
        port: 5174,
        strictPort: true,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
        }
    },`,
  )
}

export async function setup() {
  if (!existsSync(CHECKOUT_DIR)) {
    git(['clone', '--no-checkout', REPOSITORY, CHECKOUT_DIR])
  }

  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: CHECKOUT_DIR,
    encoding: 'utf8',
    shell: false,
  })
  if (remote.error) throw remote.error
  if (remote.status !== 0 || remote.stdout.trim().replace(/\.git$/, '') !== REPOSITORY.replace(/\.git$/, '')) {
    throw new Error(`Refusing to set up unexpected checkout at ${CHECKOUT_DIR}`)
  }

  git(['checkout', '--detach', PINNED_COMMIT], { cwd: CHECKOUT_DIR })
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: CHECKOUT_DIR,
    encoding: 'utf8',
    shell: false,
  })
  if (head.error) throw head.error
  if (head.status !== 0 || head.stdout.trim() !== PINNED_COMMIT) {
    throw new Error(`Agent Office checkout is not pinned to ${PINNED_COMMIT}`)
  }

  await configureCheckout()
  run('npm', ['install'], { cwd: CHECKOUT_DIR })
  run('npm', ['run', 'build', '--workspace=@agent-office/core'], { cwd: CHECKOUT_DIR })
  run('npm', ['run', 'build'], { cwd: CHECKOUT_DIR })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await setup()
  } catch (error) {
    console.error(`Agent Office setup failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
