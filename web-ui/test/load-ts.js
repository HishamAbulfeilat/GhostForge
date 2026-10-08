// Load a web-ui TypeScript module from node:test without a build step.
//
// lib/*.ts used to have hand-maintained CommonJS twins (.js) just so tests
// could require them; the twins drifted. Tests now compile the real .ts with
// ts.transpileModule (the same pattern the route tests use) and cache it.
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const WEB_ROOT = path.resolve(__dirname, '..')
const cache = new Map()

/** @param {string} rel path relative to web-ui/, e.g. 'lib/agent-team-api.ts' */
function loadTs(rel) {
  const file = path.resolve(WEB_ROOT, rel)
  if (cache.has(file)) return cache.get(file)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  mod._compile(compiled, file)
  cache.set(file, mod.exports)
  return mod.exports
}

module.exports = { loadTs }
