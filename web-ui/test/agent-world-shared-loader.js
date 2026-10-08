// Loads Agent World's shared TypeScript modules (app/agent-world/shared) in
// node:test: transpiles the given files to CommonJS in a temp tree with the
// same layout and requires them from there. Type-only imports are dropped by
// the transpiler; value imports must be in the list too.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const sharedDir = path.join(__dirname, '..', 'app', 'agent-world', 'shared')

function loadShared(files) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-aw-shared-'))
  for (const file of files) {
    const source = fs.readFileSync(path.join(sharedDir, file), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file,
    })
    const dest = path.join(out, file.replace(/\.tsx?$/, '.js'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, outputText)
  }
  const load = file => require(path.join(out, file.replace(/\.tsx?$/, '.js')))
  load.cleanup = () => fs.rmSync(out, { recursive: true, force: true })
  return load
}

module.exports = { loadShared, sharedDir }
