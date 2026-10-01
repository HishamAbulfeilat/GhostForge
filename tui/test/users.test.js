import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TUI = readFileSync(resolve(ROOT, 'tui/index.js'), 'utf8');

test('user administration is reachable from the home menu dispatch', () => {
  assert.match(TUI, /User Administration/);
  assert.match(TUI, /'users'\)/);
  assert.match(TUI, /async function screenUsers\(\)/);
  assert.match(TUI, /case 'users':\s+await screenUsers\(\); break/);
});

test('user screen reuses the authenticated users API client for list and updates', () => {
  assert.match(TUI, /parseArgs as parseUsersArgs, request as requestUsersApi.*scripts\/users\.mjs/);
  assert.match(TUI, /requestUsersApi\(parseUsersArgs\(\['list', '--json'\]\)\)/);
  assert.match(TUI, /parseUsersArgs\(args\)/);
  assert.match(TUI, /await requestUsersApi\(options\)/);
  assert.match(TUI, /GF_SESSION_TOKEN/);
});

test('user mutations are explicitly owner-only, confirmed, and protect the owner role/status', () => {
  assert.match(TUI, /if \(data\.canManage !== true\)/);
  assert.match(TUI, /Role, status, and permission changes are owner-only/);
  assert.match(TUI, /Owner-only user administration:/);
  assert.match(TUI, /Apply this owner-only change/);
  assert.match(TUI, /const canChangeRole = !user\.owner/);
  assert.match(TUI, /const canDeactivate = !user\.owner/);
});

test('user API errors and malformed list entries are surfaced clearly', () => {
  assert.match(TUI, /Could not load users/);
  assert.match(TUI, /The users API returned an invalid user entry/);
  assert.match(TUI, /User update failed/);
  assert.match(TUI, /safeUsersText\(error\.message/);
});
