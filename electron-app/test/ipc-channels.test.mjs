// Static contract between the preload bridge and the main process (no
// Electron or build needed): every channel the preload invokes or sends has a
// guarded handler in main, so no window.electron.* call can fail with
// "No handler registered".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
const mainDir = new URL('../src/main/', import.meta.url)
const main = readdirSync(mainDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => readFileSync(new URL(f, mainDir), 'utf8'))
  .join('\n')
const agentSource = readFileSync(new URL('autonomous-agent.ts', mainDir), 'utf8')

const handled = new Set([...main.matchAll(/secureHandle\(\s*'([^']+)'/g)].map(m => m[1]))
const listened = new Set([...main.matchAll(/secureOn\(\s*'([^']+)'/g)].map(m => m[1]))
const forwardBlock = agentSource.match(/const forwardEvents = \[([\s\S]*?)\]/)
const forwardedAgentEvents = new Set([...(forwardBlock?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]))

test('preload only uses literal channel names (so this contract can see them)', () => {
  assert.doesNotMatch(preload, /ipcRenderer\.(invoke|send)\(\s*[^'\s]/)
})

test('every channel the preload invokes has a guarded ipcMain handler', () => {
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map(m => m[1])
  assert.ok(invoked.length > 100)
  const missing = [...new Set(invoked)].filter(channel => !handled.has(channel))
  assert.deepEqual(missing, [])
})

test('every channel the preload sends has a guarded listener or forwarded agent event', () => {
  const sent = [...preload.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map(m => m[1])
  const missing = [...new Set(sent)].filter(channel => {
    if (listened.has(channel)) return false
    const agentEvent = channel.match(/^jarvis:agent-on-(.+)$/)
    return !(agentEvent && forwardedAgentEvents.has(agentEvent[1]))
  })
  assert.deepEqual(missing, [])
})

test('autonomous agent bridge uses the jarvis:agent-* channels main registers', () => {
  const block = preload.slice(preload.lastIndexOf('autonomousAgent: {'))
  assert.doesNotMatch(block.slice(0, block.indexOf('jarvisDaemon')), /'agent:/)
  for (const channel of ['jarvis:agent-start', 'jarvis:agent-stop', 'jarvis:agent-pause', 'jarvis:agent-resume',
    'jarvis:agent-status', 'jarvis:agent-config', 'jarvis:agent-issues', 'jarvis:agent-process']) {
    assert.ok(handled.has(channel), channel)
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  // Every forwarded event the preload listens on is one main forwards.
  for (const [, event] of preload.matchAll(/ipcRenderer\.on\('jarvis:agent-event:([^']+)'/g)) {
    assert.ok(forwardedAgentEvents.has(event), event)
  }
})

test('agent start answers without waiting for the loop and never returns the GitHub token', () => {
  const start = agentSource.slice(agentSource.indexOf("secureHandle('jarvis:agent-start'"))
  assert.doesNotMatch(start.slice(0, start.indexOf('});')), /await agent\.startAgentLoop\(\)/)
  assert.match(agentSource, /return publicAgentConfig\(agent\.getConfig\(\)\)/)
  assert.match(agentSource, /config: publicAgentConfig\(status\.config\)/)
  assert.match(agentSource, /githubToken: config\.githubToken \? MASKED_TOKEN : ''/)
})
