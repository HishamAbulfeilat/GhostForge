// Static checks on the main-process sources (no Electron or build needed):
// every IPC handler goes through the trusted-sender guard, navigation is
// locked down for every webContents, and no shell string is built with
// interpolated values in the modules that handle renderer input.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const mainDir = new URL('../src/main/', import.meta.url)
const sources = Object.fromEntries(
  readdirSync(mainDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => [f, readFileSync(new URL(f, mainDir), 'utf8')]),
)

test('every ipcMain handler is registered through the guarded helpers', () => {
  const offenders = []
  for (const [file, src] of Object.entries(sources)) {
    if (file === 'ipc-guard.ts') continue
    for (const m of src.matchAll(/ipcMain\s*\.\s*(handle|handleOnce|on|once|addListener)\s*\(/g)) {
      offenders.push(`${file}: ipcMain.${m[1]}(`)
    }
    // Passing ipcMain around would let a module register unguarded handlers.
    if (/\(\s*ipcMain\s*[,)]/.test(src)) offenders.push(`${file}: ipcMain passed as an argument`)
  }
  assert.deepEqual(offenders, [], 'register IPC with secureHandle/secureOn from ipc-guard.ts')

  const handled = Object.values(sources).join('\n').match(/\bsecure(Handle|On)\(/g) || []
  assert.ok(handled.length > 200, `expected the app's handlers to use the guard, found ${handled.length}`)
})

test('the guarded helpers check the sender before running the handler', () => {
  const guard = sources['ipc-guard.ts']
  assert.match(guard, /export function trusted\([\s\S]*?if \(!isTrustedSender\(event\)\) \{\s*throw new Error/)
  assert.match(guard, /export function secureHandle\([\s\S]*?ipcMain\.handle\(channel, trusted\(handler\)\)/)
  assert.match(guard, /export function secureOn\([\s\S]*?if \(!isTrustedSender\(event\)\) \{[\s\S]*?return;[\s\S]*?listener\(event, \.\.\.args\)/)
  // Only ipc-guard.ts touches ipcMain directly, and only these two times.
  assert.equal((guard.match(/ipcMain\.(handle|on)\(/g) || []).length, 2)
})

test('navigation guards cover redirects, pop-ups and every webContents', () => {
  const guard = sources['ipc-guard.ts']
  const index = sources['index.ts']
  assert.match(guard, /contents\.on\('will-navigate', \(event, url\) => \{[\s\S]*?isAllowedNavigationUrl\(url\)[\s\S]*?event\.preventDefault\(\)/)
  assert.match(guard, /contents\.on\('will-redirect', \(event, url\) => \{[\s\S]*?isAllowedNavigationUrl\(url\)[\s\S]*?event\.preventDefault\(\)/)
  const openHandler = guard.slice(guard.indexOf('setWindowOpenHandler('))
  assert.match(openHandler, /return \{ action: 'deny' \}/)
  assert.doesNotMatch(guard, /action: 'allow'/, 'child windows would inherit the preload')
  assert.doesNotMatch(index, /action: 'allow'/, 'child windows would inherit the preload')
  assert.match(index, /app\.on\('web-contents-created', \(_event, contents\) => \{\s*attachNavigationGuards\(contents\);/)
  assert.match(index, /attachNavigationGuards\(mainWindow\.webContents\)/)
})

// exec-family calls whose command is a template literal with ${...}.
const SHELL_TEMPLATE = /\b(exec|execSync|execAsync|runShell)\s*\(\s*`[^`]*\$\{/g

test('modules reached from IPC build no shell strings from interpolated values', () => {
  const fixed = ['code-modifier.ts', 'browser-automation.ts', 'youtube.ts', 'game-updater.ts']
  for (const file of fixed) {
    const src = sources[file]
    assert.deepEqual([...src.matchAll(SHELL_TEMPLATE)].map(m => m[0]), [], file)
  }
  for (const file of ['browser-automation.ts', 'youtube.ts', 'game-updater.ts']) {
    assert.doesNotMatch(sources[file], /import \{[^}]*\bexec\b[^}]*\} from 'child_process'/, `${file} should not import exec`)
  }
  const cm = sources['code-modifier.ts']
  assert.match(cm, /execFileAsync\('git', \['add', '--', filePath\]/)
  assert.match(cm, /execFileAsync\('git', \['commit', '-m', message\]/)
  assert.match(cm, /execFileAsync\('grep', \['-rlF', \.\.\.includes, '--', pattern, searchDir\]/)

  const ba = sources['browser-automation.ts']
  assert.match(ba, /runFile\('xdotool', \['type', '--delay', '30', '--', text\]\)/)
  assert.match(ba, /'-e', 'on run argv',[\s\S]*?keystroke \(item 1 of argv\)[\s\S]*?'-e', 'end run',\s*text,/)

  const opener = sources['external-open.ts']
  assert.match(opener, /shell\.openExternal\(href\)/)
  assert.match(opener, /return parsed\.href/)
})

test('no new shell-template exec calls outside the known legacy modules', () => {
  // These still interpolate internal values (PROJECT_ROOT, timestamps,
  // app names) into shell strings; tracked separately. Do not add to this list.
  const legacy = new Set(['omniroute.ts', 'self-updater.ts'])
  const offenders = Object.entries(sources)
    .filter(([file, src]) => !legacy.has(file) && [...src.matchAll(SHELL_TEMPLATE)].length > 0)
    .map(([file]) => file)
  assert.deepEqual(offenders, [])
})
