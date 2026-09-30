import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEAM_SCRIPT = resolve(ROOT, 'scripts', 'agents', 'team.mjs');
const BOSS_SCRIPT = resolve(ROOT, 'scripts', 'agents', 'boss.mjs');

export const TEAM_COMMANDS = Object.freeze(['start', 'status', 'inbox', 'say', 'add', 'stop']);

export function runTeamCommand(command, args = [], {
  cwd = ROOT,
  runner = spawnSync,
} = {}) {
  if (!TEAM_COMMANDS.includes(command)) {
    return { ok: false, output: `Unsupported team command: ${command}` };
  }
  if (!existsSync(TEAM_SCRIPT)) {
    return { ok: false, output: 'Agent-team controls are unavailable: team.mjs was not found.' };
  }
  const result = runner(process.execPath, [TEAM_SCRIPT, command, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    ok: result.status === 0,
    output: output || (result.status === 0 ? 'Command completed.' : 'Agent-team command failed.'),
  };
}

export function startAgentTeam({
  cwd = ROOT,
  launcher = spawn,
} = {}) {
  if (!existsSync(BOSS_SCRIPT)) {
    return { ok: false, output: 'Agent-team controls are unavailable: boss.mjs was not found.' };
  }
  try {
    const child = launcher(process.execPath, [BOSS_SCRIPT, 'start'], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref?.();
    return {
      ok: true,
      output: 'Agent-team boss start requested. Check Status for provider availability.',
    };
  } catch (error) {
    return {
      ok: false,
      output: `Could not start the agent-team boss: ${error.message}`,
    };
  }
}
