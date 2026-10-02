// Patches the ignored agent-office checkout so the upstream app runs as a
// GhostForge world: Colyseus server and Vite client bound to 127.0.0.1, the UI
// on :5174 (ai-town owns :5173), and the LLM chosen from the environment
// (local Ollama or the GhostForge model gateway) instead of a hard-coded
// localhost Ollama. Upstream source is never committed; each run resets the
// touched files to the pinned commit and re-applies exact replacements, so it
// is idempotent and fails loudly if upstream text drifts.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const UI_PORT = 5174
export const SERVER_PORT = 3000
export const PATCH_MARKER = 'GhostForge world patch'

// Read once at server start-up from the env the world manager passes in.
const MODEL_CONFIGURATION = `// ${PATCH_MARKER}: model from local Ollama or the GhostForge model gateway.
const gatewayUrl = process.env.AGENT_OFFICE_MODEL_GATEWAY_URL || process.env.OMNIROUTE_URL || '';
const gatewayKey = process.env.AGENT_OFFICE_MODEL_GATEWAY_API_KEY || process.env.OMNIROUTE_API_KEY || '';
const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const ollamaUrl = /^https?:\\/\\//.test(ollamaHost) ? ollamaHost.replace(/\\/+$/, '') : \`http://\${ollamaHost}\`;
const modelProvider = gatewayUrl ? 'openai' : 'ollama';
const modelName = process.env.AGENT_OFFICE_MODEL
    || (gatewayUrl ? process.env.OMNIROUTE_MODEL || 'auto' : process.env.OLLAMA_MODEL || 'llama3.2:latest');
const configuredModelAdapter = (() => {
    if (!gatewayUrl) return new OllamaAdapter(ollamaUrl);
    const endpoint = new URL(gatewayUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol)
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
        || !['', '/', '/v1', '/v1/'].includes(endpoint.pathname)) {
        throw new Error('Agent Office model gateway must be an http(s) origin, optionally ending in /v1.');
    }
    return new OpenAICompatibleAdapter(endpoint.origin, gatewayKey);
})();`

// [file, upstream text, replacement]. Upstream text must match exactly once or more.
export const PATCHES = [
  ['packages/server/src/index.ts',
    'colyseusServer.listen(PORT).then(() => {',
    "colyseusServer.listen(PORT, '127.0.0.1').then(() => {"],
  ['packages/server/src/index.ts',
    'listening on ws://localhost:${PORT}',
    'listening on ws://127.0.0.1:${PORT}'],
  ['packages/server/src/rooms/OfficeRoom.ts',
    "import { OllamaAdapter } from '@agent-office/adapters';",
    "import { OllamaAdapter, OpenAICompatibleAdapter } from '@agent-office/adapters';"],
  ['packages/server/src/rooms/OfficeRoom.ts',
    "import { MemoryStore } from '../memory/MemoryStore';\n",
    `import { MemoryStore } from '../memory/MemoryStore';\n\n${MODEL_CONFIGURATION}\n`],
  ['packages/server/src/rooms/OfficeRoom.ts',
    "private ollamaAdapter = new OllamaAdapter('http://localhost:11434');",
    'private ollamaAdapter = configuredModelAdapter;'],
  ['packages/server/src/rooms/OfficeRoom.ts',
    "provider: 'ollama',",
    'provider: modelProvider,'],
  ['packages/server/src/rooms/OfficeRoom.ts',
    "model: 'llama3.2:latest',",
    'model: modelName,'],
  ['packages/server/src/memory/MemoryStore.ts',
    "constructor(ollamaUrl: string = 'http://localhost:11434') {",
    "constructor(ollamaUrl: string = /^https?:\\/\\//.test(process.env.OLLAMA_HOST || '') ? process.env.OLLAMA_HOST! : 'http://127.0.0.1:11434') {"],
  // Local gateways (OmniRoute) need no key; do not send "Bearer " with an empty one.
  ['packages/adapters/src/OpenAICompatibleAdapter.ts',
    "'Authorization': `Bearer ${this.apiKey}`,",
    "...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),"],
  ['packages/ui/vite.config.ts',
    "        port: 5173,\n",
    `        host: '127.0.0.1',\n        port: ${UI_PORT},\n        strictPort: true,\n`],
  ['packages/ui/vite.config.ts',
    "'/api': 'http://localhost:3000',",
    `'/api': 'http://127.0.0.1:${SERVER_PORT}',`],
]

export const PATCHED_FILES = [...new Set(PATCHES.map(([file]) => file))]

export function applyPatches(files) {
  const out = { ...files }
  for (const [file, from, to] of PATCHES) {
    const source = out[file]
    if (typeof source !== 'string' || !source.includes(from)) {
      throw new Error(`agent-office: upstream text not found in ${file}: ${from.trim().split('\n')[0]}`)
    }
    out[file] = source.split(from).join(to)
  }
  return out
}

export function configureCheckout(dir) {
  const reset = spawnSync('git', ['-C', dir, 'checkout', '--', ...PATCHED_FILES], { stdio: 'inherit' })
  if (reset.status !== 0) throw new Error('agent-office: could not reset patched files to the pinned commit')
  const files = {}
  const endings = {}
  for (const file of PATCHED_FILES) {
    const raw = readFileSync(path.join(dir, file), 'utf8')
    endings[file] = raw.includes('\r\n') ? '\r\n' : '\n'
    files[file] = raw.replace(/\r\n/g, '\n')
  }
  const patched = applyPatches(files)
  for (const file of PATCHED_FILES) {
    writeFileSync(path.join(dir, file), patched[file].replace(/\n/g, endings[file]), 'utf8')
  }
}

export function isConfigured(dir) {
  try {
    return readFileSync(path.join(dir, 'packages/server/src/rooms/OfficeRoom.ts'), 'utf8').includes(PATCH_MARKER)
      && readFileSync(path.join(dir, 'packages/ui/vite.config.ts'), 'utf8').includes(`port: ${UI_PORT}`)
  } catch {
    return false
  }
}
