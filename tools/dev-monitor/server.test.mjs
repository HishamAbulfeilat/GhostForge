import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSnapshot, sanitizeText, startServer } from './server.mjs'

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

function claudeProjectSlug(root) {
  return path.resolve(root).replace(/[:\\/]/g, '-')
}

test('sanitizes secret values and bounds displayed text', () => {
  assert.equal(sanitizeText('api_key=topsecret Bearer abcdefghijklmnop'), 'api_key=[redacted] [redacted]')
  assert.ok(sanitizeText('a'.repeat(300), 30).length <= 30)
})

test('projects only safe board and project-session metadata', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-monitor-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'repo')
  const home = path.join(temp, 'home')
  const state = path.join(root, '.agent-sync', 'state')
  const otherRoot = path.join(temp, 'other-repo')
  fs.mkdirSync(root, { recursive: true })
  writeJSON(path.join(root, '.agent-sync', 'team.json'), {
    agents: { worker: { enabled: true, provider: 'copilot', worktree: '../worker', branch: 'feature/x' } },
  })
  writeJSON(path.join(state, 'board.json'), {
    phase: 4,
    tasks: [{ id: 'T-001', title: 'Build monitor', kind: 'feature', status: 'in-progress', owner: 'worker', dependencies: [] }],
  })
  writeJSON(path.join(state, 'status.json'), {
    ts: '2026-10-01T12:00:00.000Z',
    health: 100,
    agents: { worker: { state: 'working', task: 'T-001', progress: 'half done' } },
  })
  fs.mkdirSync(path.join(state, 'results'), { recursive: true })
  writeJSON(path.join(state, 'results', 'T-001.json'), { summary: 'Completed the parser.' })
  fs.mkdirSync(state, { recursive: true })
  fs.writeFileSync(path.join(state, 'messages.jsonl'), [
    JSON.stringify({ ts: '2026-10-01T12:01:00.000Z', from: 'worker', to: 'boss', text: 'Parser done. api_key=never-show-this' }),
  ].join('\n'))

  const copilotSession = path.join(home, '.copilot', 'session-state', 'copilot-1')
  fs.mkdirSync(copilotSession, { recursive: true })
  writeJSON(path.join(copilotSession, 'session.json'), { cwd: root, branch: 'feature/copilot', displayName: 'Copilot worker' })
  fs.writeFileSync(path.join(copilotSession, 'events.jsonl'), [
    JSON.stringify({ type: 'user.message', content: 'Please inspect the parser.' }),
    JSON.stringify({ type: 'assistant.message', content: 'Parser checked. Bearer abcdefghijklmnop' }),
  ].join('\n') + '\n')
  const otherSession = path.join(home, '.copilot', 'session-state', 'other-session')
  fs.mkdirSync(otherSession, { recursive: true })
  writeJSON(path.join(otherSession, 'metadata.json'), { cwd: otherRoot, branch: 'private' })

  const claudeSessionDir = path.join(home, '.claude', 'projects', claudeProjectSlug(root))
  fs.mkdirSync(claudeSessionDir, { recursive: true })
  fs.writeFileSync(path.join(claudeSessionDir, 'claude-1.jsonl'), [
    JSON.stringify({ cwd: root, type: 'user', message: { content: [{ type: 'text', text: 'Review the implementation.' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Review complete.' }] } }),
  ].join('\n') + '\n')

  const snapshot = buildSnapshot({ root, stateDir: state, homeDir: home })
  assert.equal(snapshot.phase, 4)
  assert.equal(snapshot.health, 100)
  assert.equal(snapshot.agents.find(agent => agent.name === 'worker').task, 'T-001')
  assert.equal(snapshot.tasks[0].summary, 'Completed the parser.')
  assert.equal(snapshot.messages[0].summary.includes('never-show-this'), false)
  assert.deepEqual(snapshot.sessions.map(session => session.provider).sort(), ['Claude Code', 'Copilot CLI'])
  assert.ok(snapshot.sessions.every(session => session.cwd === root))
  assert.ok(snapshot.sessions.some(session => session.lastMessageSummary === '[sensitive message omitted]'))
  assert.equal(JSON.stringify(snapshot).includes('private'), false)
  assert.equal(JSON.stringify(snapshot).includes('abcdef'), false)
})

test('serves only loopback-hosted GET routes with safe headers', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-monitor-http-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(temp, '.agent-sync', 'state'), { recursive: true })
  const server = startServer({ port: 0, root: temp, stateDir: path.join(temp, '.agent-sync', 'state'), homeDir: temp })
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve()
    server.once('error', reject)
    server.once('listening', resolve)
  })
  const { address, port } = server.address()
  assert.equal(address, '127.0.0.1')
  const origin = `http://127.0.0.1:${port}`
  const page = await fetch(origin)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/)
  assert.equal((await fetch(`${origin}/app.js`)).status, 200)
  assert.equal((await fetch(`${origin}/styles.css`)).status, 200)
  const snapshot = await fetch(`${origin}/api/snapshot`)
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.headers.get('access-control-allow-origin'), null)
  assert.equal((await snapshot.json()).tasks.length, 0)
  assert.equal((await fetch(`${origin}/api/%2e%2e/package.json`)).status, 404)
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405)
  const hostileHost = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/api/snapshot', headers: { Host: 'evil.example' } }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(hostileHost, 403)
})
