// The shared chat backend (app/agent-world/shared/server/chat.mjs) messages
// Copilot CLI sessions with the same pattern as Claude Code: no shell, the
// message on stdin, only sessions in the snapshot.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')

const COPILOT_ID = '7b8fcd7e-6db4-40b7-9b9e-bd6cd07f6a07'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-aw-chat-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

function fakeSpawn(stdout, seen) {
  return (command, args, opts) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
    let input = ''
    child.stdin.on('data', d => { input += d })
    child.stdin.on('finish', () => {
      Object.assign(seen, { command, args, opts, input })
      child.stdout.end(stdout)
      setImmediate(() => child.emit('close', 0))
    })
    child.kill = () => {}
    return child
  }
}

test('a Copilot CLI session in the snapshot can be messaged, over stdin and without a shell', async () => {
  const { validateChat, sendChat } = await import('../app/agent-world/shared/server/chat.mjs')
  const session = { id: COPILOT_ID, provider: 'copilot-cli', cwd: dir }
  const check = validateChat({ sessionId: COPILOT_ID, message: ' "; rm -rf ~ ' }, [session])
  assert.equal(check.ok, true)
  const seen = {}
  const reply = await sendChat(check.session, check.message, { spawnImpl: fakeSpawn('Done.\n', seen), env: { COPILOT_BIN: '/opt/copilot' } })
  assert.deepEqual(reply, { reply: 'Done.', isError: false })
  assert.deepEqual(seen.args, ['--resume', COPILOT_ID, '--silent', '--no-color'])
  assert.equal(seen.opts.shell, false)
  assert.equal(seen.input, '"; rm -rf ~')
  assert.ok(!seen.args.some(a => a.includes('rm -rf')), 'user text never reaches argv')
  assert.equal(validateChat({ sessionId: COPILOT_ID, message: 'hi' }, []).status, 404, 'only sessions in the snapshot')
})

test('the chat box offers both providers', () => {
  const box = fs.readFileSync(path.join(__dirname, '..', 'app/agent-world/shared/ChatBox.tsx'), 'utf8')
  assert.doesNotMatch(box, /a\.provider === 'claude-code'/)
  assert.match(box, /'copilot-cli': 'copilot --resume'/)
})
