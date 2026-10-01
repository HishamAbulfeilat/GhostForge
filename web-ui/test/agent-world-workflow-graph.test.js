const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const componentPath = path.resolve(__dirname, '../components/agent-world/WorkflowDependencyGraph.tsx')
const pagePath = path.resolve(__dirname, '../app/agent-world/page.tsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')
const pageSource = fs.readFileSync(pagePath, 'utf8')
const compiledComponent = ts.transpileModule(componentSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const componentModule = new Module(componentPath, module)
componentModule.filename = componentPath
componentModule.paths = Module._nodeModulePaths(path.dirname(componentPath))
componentModule._compile(compiledComponent, componentPath)
const WorkflowDependencyGraph = componentModule.exports.default

test('Agent World renders the workflow graph from loaded snapshot tasks', () => {
  assert.match(pageSource, /import WorkflowDependencyGraph from ['"]\.\.\/\.\.\/components\/agent-world\/WorkflowDependencyGraph['"]/)
  assert.match(pageSource, /<WorkflowDependencyGraph tasks=\{state\.data\.tasks\} \/>/)
})

test('workflow graph renders only reported tasks and uniquely resolved dependency edges', () => {
  const markup = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, {
    tasks: [
      { id: 'T-1', title: 'Build bridge', status: 'done', dependencies: [] },
      { id: 'T-2', title: 'Connect UI', status: 'in-progress', dependencies: ['T-1', 'missing', 'T-1'] },
      { id: 'T-3', title: 'Duplicate id', dependencies: [] },
      { id: 'T-3', title: 'Duplicate id again', dependencies: [] },
    ],
  }))

  assert.equal((markup.match(/<li id="agent-world-workflow-task-/g) ?? []).length, 4)
  assert.match(markup, /Workflow dependency graph/)
  assert.match(markup, /Connect UI/)
  assert.match(markup, /href="#agent-world-workflow-task-0"/)
  assert.match(markup, /T-1: Build bridge/)
  assert.doesNotMatch(markup, /href="#agent-world-workflow-task-2"/)
  assert.doesNotMatch(markup, /missing/)
  assert.doesNotMatch(markup, /task count|live|running/i)
})

test('workflow graph exposes dependency links as text and reports an empty snapshot', () => {
  const connected = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, {
    tasks: [{ id: 'T-1', title: 'Prepare' }, { id: 'T-2', title: 'Ship', dependencies: ['T-1'] }],
  }))
  const empty = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, { tasks: [] }))

  assert.match(connected, /aria-labelledby="agent-world-workflow-graph-heading"/)
  assert.match(connected, /Reported dependencies/)
  assert.match(connected, /T-1: Prepare/)
  assert.match(empty, /No workflow tasks were reported by the available snapshots\./)
})
