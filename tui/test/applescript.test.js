import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeAppleScriptString } from '../lib/applescript.js';

const TUI = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

/**
 * Decode an AppleScript string literal body the way AppleScript would, so the
 * tests assert on the *round trip* (what osascript actually types) rather than
 * on the exact escape spelling.
 */
function decodeLiteral(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { out += body[i]; continue; }
    const next = body[++i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === '"') out += '"';
    else if (next === '\\') out += '\\';
    else throw new Error(`unsupported escape \\${next}`);
  }
  return out;
}

/** Extract the text between the quotes that open the `needle "..."` literal. */
function literalBody(script, needle) {
  const at = script.indexOf(needle);
  assert.notEqual(at, -1, `expected to find ${needle} in generated script`);
  const start = script.indexOf('"', at + needle.length);
  const end = script.indexOf('"', start + 1);
  assert.notEqual(end, -1, 'expected a closing quote on the same literal');
  return script.slice(start + 1, end);
}

test('escapes backslashes before quotes so the escape itself cannot be defeated', () => {
  // The attack: a trailing backslash consumes the backslash this function adds
  // in front of a quote, leaving the quote to close the literal early.
  const attack = 'pwn" & (do shell script "touch /tmp/pwned") & "';
  const escaped = escapeAppleScriptString(attack);

  // Round-trips back to exactly the original — no quote escaped out of the literal.
  assert.equal(decodeLiteral(escaped), attack);
  // Every quote is preceded by an odd number of backslashes (i.e. escaped),
  // and no backslash run leaves a quote unescaped.
  assert.match(escaped, /^pwn\\" & \(do shell script \\"/);
  assert.equal(escaped.includes('" & (do shell script "'), false);
});

test('escapes every occurrence, not just the first', () => {
  const input = 'a"b"c"d';
  const escaped = escapeAppleScriptString(input);
  assert.equal(decodeLiteral(escaped), input);
  assert.equal((escaped.match(/\\"/g) || []).length, 3);
});

test('escapes lone backslashes and backslash-quote pairs', () => {
  assert.equal(escapeAppleScriptString('a\\b'), 'a\\\\b');
  assert.equal(decodeLiteral(escapeAppleScriptString('a\\b')), 'a\\b');
  assert.equal(decodeLiteral(escapeAppleScriptString('a\\"b')), 'a\\"b');
});

test('escapes newlines and carriage returns, which are illegal in a literal', () => {
  const multi = 'line1\nline2\r\nline3';
  const escaped = escapeAppleScriptString(multi);
  assert.equal(escaped.includes('\n'), false, 'no literal newline may survive');
  assert.equal(decodeLiteral(escaped), multi);
});

test('is a no-op on ordinary text', () => {
  assert.equal(escapeAppleScriptString('hello world'), 'hello world');
  assert.equal(escapeAppleScriptString(''), '');
  assert.equal(escapeAppleScriptString(null), '');
  assert.equal(escapeAppleScriptString(undefined), '');
});

test('tui/index.js no longer builds AppleScript literals with quotes-only escaping', () => {
  const src = readFileSync(TUI, 'utf8');
  assert.equal(
    /\.replace\(\/"\/g/.test(src),
    false,
    'quotes-only .replace(/"/g) escaping reintroduces the CodeQL js/incomplete-sanitization finding'
  );
  assert.match(src, /import \{ escapeAppleScriptString \} from '\.\/lib\/applescript\.js'/);
});

test('every user-supplied value in a generated AppleScript is escaped', () => {
  // Values that came from `input()` must round-trip back to themselves.
  const contact = 'Ada "A\\';
  const msg = 'hi\nthere';
  assert.equal(decodeLiteral(escapeAppleScriptString(contact)), contact);
  assert.equal(decodeLiteral(escapeAppleScriptString(msg)), msg);
  assert.match(escapeAppleScriptString(msg), /\\n/, 'multi-line input must not emit a raw newline');
});

test('tui/index.js runs osascript without a shell', () => {
  const src = readFileSync(TUI, 'utf8');
  const fn = src.slice(src.indexOf('async function runAppleScript'));
  assert.match(fn, /execFileSync\('osascript', \[tmpPath\]/);
  assert.equal(/execSync\(`osascript/.test(fn), false, 'must not interpolate the path into a shell string');
});

test('tui/index.js has no require() calls — it is an ES module', () => {
  // `require` is not defined at runtime in tui/index.js (package.json has
  // "type": "module"), so any require() there throws on the code path that
  // reaches it. Dynamic import() is the working form.
  const src = readFileSync(TUI, 'utf8');
  const offenders = src.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\brequire\s*\(/.test(line) && !line.includes('//'));
  assert.deepEqual(offenders, [], `require() is not defined in this ESM file:\n${offenders.map(([n, l]) => `${n}: ${l.trim()}`).join('\n')}`);
});

test('vigolium npm install runs on Windows, where npm is a .cmd shim', () => {
  // execFileSync('npm') is ENOENT on Windows and 'npm.cmd' is EINVAL without a
  // shell, so the shell is enabled there only; the args must stay literals.
  const src = readFileSync(TUI, 'utf8');
  assert.match(
    src,
    /execFileSync\('npm', \['install', '-g', '@vigolium\/vigolium'\], \{[^}]*shell: process\.platform === 'win32'[^}]*\}\)/
  );
});

test('vigolium scan passes the target as an argv entry, not a shell string', () => {
  const src = readFileSync(TUI, 'utf8');
  assert.match(src, /spawn\('vigolium', \['scan', '-t', target, '--strategy', strategy\]/);
  assert.equal(
    /exec\(\s*`vigolium scan/.test(src),
    false,
    'exec() with a template literal lets `target` inject shell metacharacters'
  );
});