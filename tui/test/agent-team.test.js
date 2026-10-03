import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { runTeamCommand, startAgentTeam } from '../lib/agent-team.js';

const TUI_CHILD_MODE = process.env.GF_AGENT_TEAM_TUI_TEST_CHILD === '1';
const test = TUI_CHILD_MODE ? () => {} : nodeTest;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEAM_SCRIPT = resolve(ROOT, 'scripts', 'agents', 'team.mjs');
const BOSS_SCRIPT = resolve(ROOT, 'scripts', 'agents', 'boss.mjs');
const require = createRequire(import.meta.url);

let nodePty;
try {
  nodePty = require('node-pty');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function stripTerminalControls(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

async function runRealTuiStatusSubmenu() {
  if (!nodePty) throw new Error('node-pty is not installed in this checkout');

  const expectedStatus = runTeamCommand('status');
  assert.equal(expectedStatus.ok, true, expectedStatus.output);
  const expectedPhase = expectedStatus.output.match(/Agent team — phase \d+/)?.[0];
  const expectedCounts = expectedStatus.output.match(/todo \d+ · in-progress \d+ · blocked \d+ · done \d+/)?.[0];
  assert.ok(expectedPhase, 'The real team status command should report its phase');
  assert.ok(expectedCounts, 'The real team status command should report effective task counts');

  const shimDirectory = mkdtempSync(join(tmpdir(), 'ghostforge-tui-test-'));
  const officeCli = join(shimDirectory, process.platform === 'win32' ? 'officecli.cmd' : 'officecli');
  writeFileSync(
    officeCli,
    process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
  );
  if (process.platform !== 'win32') chmodSync(officeCli, 0o755);

  const terminal = nodePty.spawn(process.execPath, [join(ROOT, 'tui', 'index.js')], {
    cwd: ROOT,
    cols: 180,
    rows: 100,
    useConptyDll: true,
    env: {
      ...process.env,
      PATH: `${shimDirectory}${delimiter}${process.env.PATH || ''}`,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
      TERM: 'xterm',
    },
  });

  let output = '';
  let stage = 0;
  let promptTimer;
  let timeout;
  let settled = false;
  const exited = new Promise(resolveExit => terminal.onExit(resolveExit));
  const renderedStatus = new Promise((resolveStatus, rejectStatus) => {
    const fail = () => {
      if (settled) return;
      settled = true;
      rejectStatus(new Error(`Timed out navigating the real Agent Team submenu:\n${stripTerminalControls(output).slice(-3000)}`));
    };
    timeout = setTimeout(fail, 15000);

    terminal.onData(data => {
      output += data;
      const plain = stripTerminalControls(output);

      if (stage === 0 && plain.includes('Search tools or ask G.F.A.I.:')) {
        stage = 1;
        promptTimer = setTimeout(() => terminal.write('Agent Team'), 150);
      } else if (stage === 1 && plain.includes('Agent Team')) {
        stage = 2;
        promptTimer = setTimeout(() => terminal.write('\r'), 250);
      } else if (stage === 2 && plain.includes('Agent-team action:')) {
        stage = 3;
        promptTimer = setTimeout(() => terminal.write('\r'), 150);
      } else if (
        stage === 3 &&
        plain.includes(expectedPhase) &&
        plain.includes(expectedCounts)
      ) {
        settled = true;
        clearTimeout(timeout);
        resolveStatus({ submenu: true, phase: expectedPhase, counts: expectedCounts });
      }
    });
  });

  try {
    return await renderedStatus;
  } finally {
    clearTimeout(timeout);
    clearTimeout(promptTimer);
    terminal.write('\u0003');
    let exitTimeout;
    await Promise.race([
      exited,
      new Promise(resolveExit => { exitTimeout = setTimeout(resolveExit, 1000); }),
    ]);
    clearTimeout(exitTimeout);
    terminal.kill();
    rmSync(shimDirectory, { recursive: true, force: true });
  }
}

test('agent-team adapter constructs the expected status, stop, say, and add argv', () => {
  const calls = [];
  const commands = [
    ['status', []],
    ['stop', []],
    ['say', ['--from', 'copilot-web', '--to', 'boss', 'status update']],
    ['add', ['Expand coverage', '--kind', 'test', '--area', 'tui', '--from', 'copilot-web']],
  ];

  for (const [command, args] of commands) {
    const result = runTeamCommand(command, args, {
      cwd: ROOT,
      runner: (...call) => {
        calls.push(call);
        return { status: 0, stdout: `${command} completed\n`, stderr: '' };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.output, `${command} completed`);
  }

  assert.equal(calls.length, commands.length);
  for (const [index, [command, args]] of commands.entries()) {
    const [executable, argv, options] = calls[index];
    assert.equal(executable, process.execPath);
    assert.deepEqual(argv, [TEAM_SCRIPT, command, ...args]);
    assert.deepEqual(options, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
});

test('agent-team adapter rejects unsupported commands and malformed input', () => {
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { status: 0, stdout: '', stderr: '' };
  };

  assert.equal(runTeamCommand('rm -rf', [], { runner }).ok, false);
  assert.equal(runTeamCommand(null, [], { runner }).ok, false);
  assert.match(runTeamCommand('say', null, { runner }).output, /Invalid .* arguments/);
  assert.match(runTeamCommand('add', ['task', 42], { runner }).output, /Invalid .* arguments/);
  assert.match(runTeamCommand('status', [], { runner: null }).output, /Invalid .* configuration/);
  assert.equal(calls, 0);
});

test('agent-team commands report a missing team script without invoking the runner', () => {
  let called = false;
  const result = runTeamCommand('status', [], {
    teamScript: join(tmpdir(), 'ghostforge-missing-team-script.mjs'),
    runner: () => {
      called = true;
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.output, /team\.mjs was not found/);
  assert.equal(called, false);
});

test('agent-team start reports launcher failures and missing boss scripts', () => {
  const failed = startAgentTeam({
    launcher: () => {
      throw new Error('provider unavailable');
    },
  });
  const missing = startAgentTeam({
    bossScript: join(tmpdir(), 'ghostforge-missing-boss-script.mjs'),
    launcher: () => {
      throw new Error('must not launch');
    },
  });

  assert.equal(failed.ok, false);
  assert.match(failed.output, /provider unavailable/);
  assert.equal(missing.ok, false);
  assert.match(missing.output, /boss\.mjs was not found/);
});

test('agent-team start launches and detaches the boss process', () => {
  let call;
  const child = { unref() { this.detached = true; } };
  const result = startAgentTeam({
    cwd: ROOT,
    launcher: (...args) => {
      call = args;
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(child.detached, true);
  assert.deepEqual(call, [
    process.execPath,
    [BOSS_SCRIPT, 'start'],
    { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true },
  ]);
  assert.match(result.output, /Status/);
});

test('real TUI Agent Team submenu displays the live effective team status', async (t) => {
  if (!nodePty) return t.skip('node-pty is not installed in this checkout');

  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: ROOT,
    env: { ...process.env, GF_AGENT_TEAM_TUI_TEST_CHILD: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const childResult = await new Promise((resolveChild, rejectChild) => {
    const timer = setTimeout(() => {
      child.kill();
      rejectChild(new Error(`Timed out running the real TUI status submenu:\n${stderr}`));
    }, 30000);
    child.on('error', rejectChild);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveChild({ code, signal });
    });
  });

  assert.equal(childResult.code, 0, stderr || `TUI test process exited with ${childResult.signal}`);
  const line = stdout.split(/\r?\n/).find(value => value.startsWith('TUI_STATUS:'));
  assert.ok(line, `The TUI test process should report rendered status. Output:\n${stdout}`);
  const rendered = JSON.parse(line.slice('TUI_STATUS:'.length));
  assert.equal(rendered.submenu, true);
  assert.match(rendered.phase, /^Agent team — phase \d+$/);
  assert.match(rendered.counts, /^todo \d+ · in-progress \d+ · blocked \d+ · done \d+$/);
});

if (TUI_CHILD_MODE) {
  runRealTuiStatusSubmenu()
    .then(status => {
      process.stdout.write(`TUI_STATUS:${JSON.stringify(status)}\n`);
      process.exit(0);
    })
    .catch(error => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exit(1);
    });
}
