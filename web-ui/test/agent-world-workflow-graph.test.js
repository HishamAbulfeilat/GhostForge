const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const componentPath = path.resolve(__dirname, '../components/agent-world/WorkflowDependencyGraph.tsx')
const viewPath = path.resolve(__dirname, '../components/AgentWorldView.tsx')
const pagePath = path.resolve(__dirname, '../app/agent-world/page.tsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')
const viewSource = fs.readFileSync(viewPath, 'utf8')
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
  assert.match(pageSource, /variant="product"/)
  assert.match(viewSource, /import WorkflowDependencyGraph from ['"]@\/components\/agent-world\/WorkflowDependencyGraph['"]/)
  assert.match(viewSource, /<WorkflowDependencyGraph tasks=\{data\.tasks\} \/>/)
})

test('workflow graph renders reported nodes and only uniquely resolved dependency edges', () => {
  const markup = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, {
    tasks: [
      { id: 'T-1', title: 'Build bridge', status: 'done', dependencies: [] },
      { id: 'T-2', title: 'Connect UI', status: 'in-progress', dependencies: ['T-1', 'missing', 'T-1', 'T-3'] },
      { id: 'T-3', title: 'Duplicate ID one', dependencies: [] },
      { id: 'T-3', title: 'Duplicate ID two', dependencies: [] },
    ],
  }))

  assert.equal((markup.match(/data-node-index="/g) ?? []).length, 4)
  assert.equal((markup.match(/data-edge-from="/g) ?? []).length, 1)
  assert.match(markup, /data-edge-from="1" data-edge-to="0"/)
  assert.match(markup, /Workflow dependency graph/)
  assert.match(markup, /4 reported task nodes · 1 uniquely resolved dependency edge\./)
  assert.match(markup, /Connect UI/)
  assert.match(markup, /Depends on Build bridge \(ID: T-1\)/)
  assert.match(markup, /1 task ID appears more than once/)
  assert.match(markup, /1 target ID was not reported, 1 reference matches duplicate task IDs/)
  assert.match(markup, /Dependency ID &quot;T-3&quot; from Connect UI \(ID: T-2\) is ambiguous, so no edge is drawn/)
  assert.match(markup, /Unresolved dependency ID: missing/)
  assert.doesNotMatch(markup, /href="#/)
  assert.doesNotMatch(markup, /data-edge-from="1" data-edge-to="2"/)
  assert.doesNotMatch(markup, /task count|live|running/i)
})

test('workflow graph has a textual equivalent and reports unavailable dependency data', () => {
  const markup = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, {
    tasks: [
      { id: 'T-1', title: 'No dependency field' },
      { title: 'Unknown identity', dependencies: ['T-404', '', 42] },
      { id: 'T-3', title: 'No prerequisites', dependencies: [] },
    ],
  }))

  assert.match(markup, /aria-labelledby="agent-world-workflow-graph-heading"/)
  assert.match(markup, /aria-hidden="true"/)
  assert.match(markup, /class="sr-only"/)
  assert.match(markup, /Task: Unknown identity \(ID not reported\)/)
  assert.match(markup, /Dependencies were not reported/)
  assert.match(markup, /Dependency ID &quot;T-404&quot; from Unknown identity is unresolved, so no edge is drawn/)
  assert.match(markup, /Unresolved dependency ID: T-404/)
  assert.match(markup, /Invalid dependency references were omitted/)
  assert.match(markup, /No dependency IDs were reported/)
  assert.match(markup, /1 task did not report dependencies/)
  assert.match(markup, /1 task included invalid dependency references/)
})

test('workflow graph handles an empty snapshot without inventing nodes or edges', () => {
  const markup = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, { tasks: [] }))

  assert.match(markup, /No workflow tasks were reported by the available snapshots, so no graph can be shown\./)
  assert.doesNotMatch(markup, /data-node-index|data-edge-from/)
})

test('workflow graph sizes its canvas to the reported node count', () => {
  const singleTask = renderToStaticMarkup(React.createElement(WorkflowDependencyGraph, {
    tasks: [{ id: 'T-1', title: 'Single node', dependencies: [] }],
  }))

  assert.match(singleTask, /viewBox="0 0 284 140"/)
  assert.match(singleTask, /style="min-width:284px"/)
})
