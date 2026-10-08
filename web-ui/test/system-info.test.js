const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const libPath = path.resolve(__dirname, '../lib/system-info.ts')
const spawned = []
const childProcess = {
  execSync(command) {
    spawned.push(command)
    if (command.startsWith('df')) return Buffer.from('Filesystem 1K-blocks Used Available Use% Mounted\n/dev/x 2097152 1048576 1048576 50% /\n')
    return Buffer.from('')
  },
}

function load() {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'child_process') return childProcess
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const compiled = ts.transpileModule(fs.readFileSync(libPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const mod = new Module(libPath, module)
    mod.filename = libPath
    mod.paths = Module._nodeModulePaths(path.dirname(libPath))
    mod._compile(compiled, libPath)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

test('disk and battery readings are reused instead of spawning a process per poll', { skip: process.platform === 'win32' }, () => {
  const info = load()
  const first = info.getDisk()
  const battery = info.getBattery()
  const afterFirst = spawned.length
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(info.getDisk(), first)
    assert.deepEqual(info.getBattery(), battery)
  }
  assert.equal(spawned.length, afterFirst, 'no extra child processes within the cache window')
  if (process.platform === 'linux') {
    assert.equal(first.totalGB, 2)
    assert.ok(!spawned.some(c => c.startsWith('cat ')), 'Linux battery is read from /sys directly')
  }
})
