const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const SERVER = join(__dirname, '..', '..', 'mcp-server', 'index.js')

// Drive the MCP server over stdio and resolve as soon as every wanted response
// id has arrived (or after a generous cap). This replaces fixed setTimeout waits
// that flaked under CI load when a reply landed after the timer fired.
function rpc(requests, wantIds, maxMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
    const want = new Set(wantIds)
    const seen = new Map()
    let buf = ''
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch { /* already gone */ }
      resolve(seen)
    }

    child.stdout.on('data', d => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg && msg.id != null) seen.set(msg.id, msg)
        if ([...want].every(id => seen.has(id))) return finish()
      }
    })
    child.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(err) } })

    const timer = setTimeout(finish, maxMs)
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n')
  })
}

test('MCP server handshake (initialize) and tool listing', async () => {
  const responses = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ], [1, 2])

  const init = responses.get(1)
  const list = responses.get(2)
  assert.ok(init, 'initialize response received')
  assert.ok(list, 'tools/list response received')

  assert.equal(init.result.serverInfo.name, 'ghostforge-mcp')
  assert.ok(Array.isArray(list.result.tools))
  const names = list.result.tools.map(t => t.name)
  assert.ok(names.includes('get_time'))
  assert.ok(names.includes('web_search'))
  assert.ok(names.includes('office_document'))
  assert.ok(names.every(t => t && typeof t === 'string'))
})

test('MCP tools/call returns a text result for get_time', async () => {
  const responses = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_time', arguments: {} } },
  ], [2])

  const call = responses.get(2)
  assert.ok(call, 'get_time response received')
  assert.equal(call.result.isError, false)
  const content = call.result.content[0].text
  assert.match(content, /\d{4}/) // contains a year — time string present
})

test('MCP tools/call reports an error for an unknown tool', async () => {
  const responses = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'not_a_real_tool', arguments: {} } },
  ], [1])

  const r = responses.get(1)
  assert.ok(r, 'unknown-tool response received')
  assert.equal(r.result.isError, true)
  assert.match(r.result.content[0].text, /Unknown tool/)
})
