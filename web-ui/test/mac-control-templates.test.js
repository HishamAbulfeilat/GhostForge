'use strict'
// Mac Control advertised iMessage, Teams, Mail, notifications and Finder, but
// the model wrote free-form AppleScript that validateAppleScript always
// rejected. Those actions are now built from vetted templates whose only
// variable parts are escaped string literals, and the validator accepts
// exactly those shapes. These tests pin both halves: the advertised actions
// pass, and nothing outside the templates (or smuggled through a value) does.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const apple = require('../lib/apple-automation')
const { buildAppleScript, knownAppleScript, validateAppleScript } = apple

const dir = fs.mkdtempSync(path.join(tmpdir(), 'gf-mac-'))
const file = path.join(dir, 'run-me.command')
fs.writeFileSync(file, 'echo hi\n')
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('the page quick actions produce scripts the validator accepts', () => {
  const commands = [
    'Send iMessage to Rawzi saying lunch at 1pm',
    'Open Teams and message Rawzi: I will be late',
    'Show a notification saying "GhostForge is ready"',
    'Send email to rawzi@example.com with subject "Hello" and body "How are you?"',
    'Play music in Spotify',
    'Take a screenshot',
    'Set system volume to 50%',
    'Mute the system audio',
    'Lock the screen',
    'Show battery percentage as a notification',
    `Open Finder at ${dir}`,
  ]
  for (const command of commands) {
    const script = knownAppleScript(command)
    assert.ok(script, `no script for: ${command}`)
    const result = validateAppleScript(script)
    assert.equal(result.ok, true, `${command}: ${result.reason}`)
  }
})

test('every structured action the model can return builds a valid script', () => {
  const intents = [
    { action: 'open_app', app: 'Safari' },
    { action: 'open_url', url: 'https://github.com' },
    { action: 'volume', level: 30 },
    { action: 'mute' }, { action: 'unmute' }, { action: 'lock' }, { action: 'show_desktop' },
    { action: 'screenshot' }, { action: 'battery' },
    { action: 'notify', message: 'Build done', subtitle: 'CI' },
    { action: 'imessage', contact: 'Rawzi', message: 'line one\nline "two"' },
    { action: 'teams', contact: 'Rawzi', message: 'hi' },
    { action: 'mail', to: 'a@example.com', subject: 'S', body: 'B' },
    { action: 'finder', path: dir },
    { action: 'media', app: 'Music', command: 'next' },
  ]
  for (const intent of intents) {
    const built = buildAppleScript(intent)
    assert.equal(built.ok, true, `${intent.action}: ${built.reason}`)
    const result = validateAppleScript(built.script)
    assert.equal(result.ok, true, `${intent.action}: ${result.reason}`)
  }
  assert.equal(buildAppleScript({ action: 'run_shell', cmd: 'id' }).ok, false)
  assert.equal(buildAppleScript({ action: 'mail', to: 'not-an-address', subject: 'x' }).ok, false)
  assert.equal(buildAppleScript({ action: 'open_url', url: 'file:///etc/passwd' }).ok, false)
})

test('a value can never turn into code', () => {
  const nasty = [
    'x" & (do shell script "id") & "',
    'x\\" & (run script "beep") & \\"',
    'x\nend tell\ntell application "Finder" to delete every item of desktop',
    'he said “hi” & (run script “beep”) & “',
    '«event aevtquit»',
  ]
  for (const message of nasty) {
    const built = buildAppleScript({ action: 'notify', message })
    assert.equal(built.ok, true)
    // Whatever was typed stays inside one literal on one line.
    assert.equal(built.script.split('\n').length, 1, built.script)
    const m = built.script.match(/^display notification "((?:[^"\\\n]|\\.)*)" with title "GhostForge"$/)
    assert.ok(m, built.script)
    assert.equal(/[“”«»]/.test(built.script), false)
  }
})

test('templates with altered code, extra lines or smuggled quotes are rejected', () => {
  const ok = buildAppleScript({ action: 'imessage', contact: 'Rawzi', message: 'hi' }).script
  const rejects = [
    ok.replace('send "hi" to targetBuddy', 'send "hi" to targetBuddy\nrun script "beep"'),
    ok.replace('buddy "Rawzi"', 'buddy ("Rawzi" & (path to me))'),
    ok + '\ndelete every file of desktop',
    'display notification "a" with title "GhostForge" & (run script "beep")',
    'display notification "a" & (run script "beep") & "b" with title "GhostForge"',
    'tell application "x” & (run script “beep”) & “y" to activate',
    'display notification "x” & (run script “beep”) & “y" with title "GhostForge"',
    'tell application «class Fndr» to activate',
    'tell application "Spotify" to quit',
  ]
  for (const script of rejects) assert.equal(validateAppleScript(script).ok, false, script)
})

test('Finder only opens existing folders, never files', () => {
  assert.equal(buildAppleScript({ action: 'finder', path: file }).ok, false)
  assert.equal(buildAppleScript({ action: 'finder', path: path.join(dir, 'missing') }).ok, false)
  const handWritten = `tell application "Finder"\n  activate\n  open POSIX file "${file}"\nend tell`
  assert.equal(validateAppleScript(handWritten).ok, false)
  assert.equal(validateAppleScript(handWritten.replace(file, dir)).ok, true)
  assert.equal(validateAppleScript(handWritten.replace(file, 'relative/path')).ok, false)
})

test('the editor accepts the templates with any indentation', () => {
  const script = [
    'tell application "Mail"',
    '    set newMsg to make new outgoing message with properties {subject:"Hi", content:"Body", visible:true}',
    '    tell newMsg',
    '        make new to recipient at end of to recipients with properties {address:"x@example.com"}',
    '    end tell',
    '    send newMsg',
    'end tell',
  ].join('\r\n')
  assert.equal(validateAppleScript(script).ok, true)
})

test('"open Teams and message X" is no longer mistaken for an app name', () => {
  const script = knownAppleScript('Open Teams and message Rawzi: hello')
  assert.doesNotMatch(script, /tell application "Teams and message/)
  assert.equal(knownAppleScript('Open Finder at my strange place'), null)
})

// ── Route: natural language → model intent → template → validator ───────────

const WEB_UI = path.resolve(__dirname, '..')
class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
}
const state = { modelReply: '', ran: [] }
const stubs = {
  'next/server': { NextResponse },
  '@/lib/access': { requirePermission: async () => ({ username: 'owner' }) },
  '@/lib/ai': { generateWithFallback: async () => ({ text: state.modelReply }) },
  '@/lib/apple-automation': apple,
  '@/lib/private-temp': {
    makePrivateTempDir: async () => fs.mkdtempSync(path.join(dir, 'run-')),
    privateTempPath: (d, name) => path.join(d, name),
  },
  child_process: {
    execFile: (cmd, args, opts, cb) => {
      state.ran.push({ cmd, script: cmd === 'osascript' ? fs.readFileSync(args[0], 'utf8') : null })
      cb(null, { stdout: '', stderr: '' })
    },
  },
}
const originalLoad = Module._load
function stubbedLoad(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request]
  return originalLoad.call(this, request, parent, isMain)
}
function loadRoute(rel) {
  const f = path.join(WEB_UI, rel)
  const compiled = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(f, module)
  mod.filename = f
  mod.paths = Module._nodeModulePaths(path.dirname(f))
  Module._load = stubbedLoad
  try { mod._compile(compiled, f) } finally { Module._load = originalLoad }
  return mod.exports
}

async function callRoute(body) {
  const route = loadRoute('app/api/mac-control/route.ts')
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  state.ran = []
  try {
    return await route.POST({ headers: new Map(), async json() { return body } })
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
}

test('route: a model intent for an advertised action runs', async () => {
  state.modelReply = '```json\n{"action":"imessage","contact":"Sam","message":"on my way"}\n```'
  const res = await callRoute({ command: 'tell sam i am on my way' })
  assert.equal(res.status, 200, JSON.stringify(res._body))
  const ran = state.ran.find(r => r.cmd === 'osascript')
  assert.ok(ran, 'osascript ran')
  assert.match(ran.script, /buddy "Sam" of targetService/)
  assert.match(ran.script, /send "on my way" to targetBuddy/)
})

test('route: unsupported or unparseable model output is a clear 422, nothing runs', async () => {
  state.modelReply = '{"action":"unsupported","reason":"cannot edit system files"}'
  let res = await callRoute({ command: 'edit /etc/hosts' })
  assert.equal(res.status, 422)
  assert.match(res._body.error, /can't do that yet/)
  assert.equal(state.ran.length, 0)

  state.modelReply = 'do shell script "id"'
  res = await callRoute({ command: 'whoami' })
  assert.equal(res.status, 422)
  assert.equal(state.ran.length, 0)
})

test('route: a hand-edited script outside the templates is still refused', async () => {
  const res = await callRoute({ script: 'tell application "Finder" to delete every item of desktop' })
  assert.equal(res.status, 400)
  assert.equal(state.ran.length, 0)
})
