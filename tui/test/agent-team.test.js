import test from 'node:test';
import assert from 'node:assert/strict';

import { runTeamCommand, startAgentTeam } from '../lib/agent-team.js';

test('agent-team adapter only executes fixed team commands', () => {
  const calls = [];
  const result = runTeamCommand('status', ['--unexpected'], {
    runner: (...args) => {
      calls.push(args);
      return { status: 0, stdout: 'healthy\n', stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.output, 'healthy');
  assert.equal(calls[0][0], process.execPath);
  assert.equal(calls[0][1][1], 'status');
  assert.deepEqual(calls[0][1].slice(2), ['--unexpected']);
  assert.equal(runTeamCommand('rm -rf', []).ok, false);
});

test('agent-team start reports launcher failures clearly', () => {
  const result = startAgentTeam({
    launcher: () => {
      throw new Error('provider unavailable');
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.output, /provider unavailable/);
});

test('agent-team start detaches the boss process when available', () => {
  let call;
  const child = { unref() { this.detached = true; } };
  const result = startAgentTeam({
    launcher: (...args) => {
      call = args;
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(child.detached, true);
  assert.equal(call[0], process.execPath);
  assert.equal(call[1].at(-1), 'start');
  assert.match(result.output, /Status/);
});
