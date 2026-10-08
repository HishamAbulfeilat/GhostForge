import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCommandFor } from '../lib/platform-utils.js';

test('openCommandFor passes the URL as a single argv entry on every platform', () => {
  const url = "https://example.com/a?b=1&c='x'|y";
  assert.deepEqual(openCommandFor(url, 'darwin'), { cmd: 'open', args: [new URL(url).href] });
  assert.deepEqual(openCommandFor(url, 'linux'), { cmd: 'xdg-open', args: [new URL(url).href] });
  // Windows must not go through `cmd /c start`, which would treat & and | as shell syntax.
  assert.deepEqual(openCommandFor(url, 'win32'), {
    cmd: 'rundll32',
    args: ['url.dll,FileProtocolHandler', new URL(url).href],
  });
});

test('openCommandFor rejects non-http(s) values', () => {
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', '/Applications/Calculator.app',
    "x' ; rm -rf ~ ; '", '', 'ssh://host']) {
    assert.equal(openCommandFor(value, 'linux'), null, value);
  }
});

test('tui/index.js opens URLs through crossPlatformOpen, not shell strings', () => {
  const source = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');
  const shellOpens = source.split('\n').filter(line => /exec(Sync)?\(\s*[`'"](open|xdg-open|start) /.test(line));
  assert.deepEqual(shellOpens, []);
});
