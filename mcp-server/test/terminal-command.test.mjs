import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleRequest, parseTerminalCommand } from '../index.js'

test('allowlisted read-only commands parse to argv without a shell', () => {
  assert.deepEqual(parseTerminalCommand('git status --short'), {
    file: 'git',
    args: ['--no-pager', '-c', 'core.fsmonitor=false', 'status', '--short'],
  })
  assert.deepEqual(parseTerminalCommand('git log --oneline -n 5').args.slice(3), ['log', '--oneline', '-n', '5'])
  assert.deepEqual(parseTerminalCommand('git log').args.slice(3), ['log', '-n', '20'])
  assert.deepEqual(parseTerminalCommand('git diff --stat').args.slice(3), ['diff', '--no-ext-diff', '--no-textconv', '--stat'])
  assert.deepEqual(parseTerminalCommand('git branch -a').args.slice(3), ['branch', '-a'])
  assert.deepEqual(parseTerminalCommand('ls -la src'), { file: 'ls', args: ['-la', '--', 'src'] })
  assert.deepEqual(parseTerminalCommand('pwd'), { builtin: 'pwd' })
  assert.deepEqual(parseTerminalCommand('node -v'), { file: 'node', args: ['--version'] })
  assert.deepEqual(parseTerminalCommand('npm --version'), { file: 'npm', args: ['--version'] })
  assert.deepEqual(parseTerminalCommand('npm ls --depth=0'), { file: 'npm', args: ['ls', '--depth=0'] })
})

test('everything outside the allowlist is rejected', () => {
  const rejected = [
    'rm -rf ~',
    'rm -rf .',
    'find / -delete',
    "bash -c 'id'",
    'sh -c id',
    "python3 -c 'print(1)'",
    "node -e 'process.exit(1)'",
    'curl https://example.com -o x',
    'git branch evil',
    'git log --output=/tmp/x',
    'git diff --ext-diff',
    'git -c core.pager=id log',
    'git config core.fsmonitor id',
    'git push',
    'git status; id',
    'ls --color=always',
    'ls -la | sh',
    'npm install',
    'npm run build',
    'npm ls --prefix=/',
    'pwd x',
    'git constructor',
    'git __proto__',
    '',
  ]
  for (const command of rejected) {
    assert.throws(() => parseTerminalCommand(command), /not allowed|Empty command/, command)
  }
  assert.throws(() => parseTerminalCommand(undefined), /not allowed/)
})

test('tools/call reports a rejected command as an error, without running it', async () => {
  const result = await handleRequest('tools/call', {
    name: 'terminal_command',
    arguments: { command: "bash -c 'echo pwned'" },
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Command not allowed/)
})

test('tools/call runs an allowlisted command', async () => {
  const result = await handleRequest('tools/call', { name: 'terminal_command', arguments: { command: 'pwd' } })
  assert.equal(result.isError, false)
  assert.equal(result.content[0].text, process.cwd())
})
