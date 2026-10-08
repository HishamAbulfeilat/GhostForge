import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INDEX = fileURLToPath(new URL('../index.js', import.meta.url));
const VERSION = readFileSync(fileURLToPath(new URL('../../VERSION', import.meta.url)), 'utf8').trim();

test('--version answers without loading any third-party module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-tui-startup-'));
  try {
    // A resolve hook that fails the run if a bare (npm) specifier is imported.
    const hooks = join(dir, 'hooks.mjs');
    writeFileSync(hooks, `export async function resolve(specifier, context, next) {
  if (!/^(node:|\\.|\\/|file:|data:)/.test(specifier) && !specifier.startsWith('${'${'}')) {
    const builtins = new Set(['child_process','fs','path','os','url','module','util','http','https','events','crypto','readline']);
    if (!builtins.has(specifier)) throw new Error('loaded third-party module: ' + specifier);
  }
  return next(specifier, context);
}\n`);
    const register = join(dir, 'register.mjs');
    writeFileSync(register, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(register).href, INDEX, '--version'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), VERSION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('heavy, screen-only modules are loaded lazily', () => {
  const source = readFileSync(INDEX, 'utf8');
  const eager = source.slice(source.indexOf('await Promise.all(['), source.indexOf(']);', source.indexOf('await Promise.all([')));
  assert.ok(eager.includes("import('@inquirer/prompts')"), 'first-screen modules load in the eager block');
  for (const mod of ['ora', 'cli-table3', './lib/gfai-client.js', './lib/llmfit-client.js']) {
    assert.ok(!eager.includes(`'${mod}'`), `${mod} must not be in the eager block`);
    assert.doesNotMatch(source, new RegExp(`^import [^\\n]* from '${mod.replace(/[.\/]/g, '\\$&')}';$`, 'm'), mod);
  }
});

test('doctor shows the shared health-at-a-glance contract', () => {
  const source = readFileSync(INDEX, 'utf8');
  assert.match(source, /import\('\.\.\/web-ui\/lib\/health-core\.mjs'\)/);
  assert.match(source, /async function screenDoctor\(\) \{[\s\S]{0,200}printHealthAtAGlance\(\)/);
});
