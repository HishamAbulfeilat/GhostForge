const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const SERVER = join(__dirname, '..', '..', 'mcp-server', 'index.js')

test('MCP server handshake (initialize) and tool listing', async () => {
  const child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  child.stdout.on('data', d => { buf += d })

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')

  await new Promise((resolve) => setTimeout(resolve, 400))
  child.kill()

  const responses = buf.split('\n').filter(Boolean).map(l => JSON.parse(l))
  const init = responses.find(r => r.id === 1)
  const list = responses.find(r => r.id === 2)

  assert.equal(init.result.serverInfo.name, 'ghostforge-mcp')
  assert.ok(Array.isArray(list.result.tools))
  const names = list.result.tools.map(t => t.name)
  assert.ok(names.includes('get_time'))
  assert.ok(names.includes('web_search'))
  assert.ok(names.includes('office_document'))
  assert.ok(names.every(t => t && typeof t === 'string'))
})

test('MCP tools/call returns a text result for get_time', async () => {
  const child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  child.stdout.on('data', d => { buf += d })

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_time', arguments: {} } }) + '\n')

  await new Promise(r => setTimeout(r, 400))
  child.kill()

  const responses = buf.split('\n').filter(Boolean).map(l => JSON.parse(l))
  const call = responses.find(r => r.id === 2)
  assert.equal(call.result.isError, false)
  const content = call.result.content[0].text
  assert.match(content, /\d{4}/) // contains a year — time string present
})

test('MCP tools/call reports an error for an unknown tool', async () => {
  const child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  child.stdout.on('data', d => { buf += d })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'not_a_real_tool', arguments: {} } }) + '\n')
  await new Promise(r => setTimeout(r, 300))
  child.kill()
  const r = JSON.parse(buf.split('\n').find(Boolean))
  assert.equal(r.result.isError, true)
  assert.match(r.result.content[0].text, /Unknown tool/)
})