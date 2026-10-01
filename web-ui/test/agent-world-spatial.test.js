const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const componentPath = path.resolve(__dirname, '../components/agent-world/AgentOfficeMap.tsx')
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
const AgentOfficeMap = componentModule.exports.default

const emptyMessage = 'No sessions were reported by the available snapshots.'

test('Agent World mounts the office map with connector-attributed snapshot sessions', () => {
  assert.match(pageSource, /import AgentOfficeMap from ['"]\.\.\/\.\.\/components\/agent-world\/AgentOfficeMap['"]/)
  assert.match(pageSource, /<AgentOfficeMap sessions=\{state\.officeSessions\}/)
  assert.match(pageSource, /source: typeof session\.source === 'string'[\s\S]*?connector\.id/)
  assert.match(pageSource, /connector\.stale === true \|\| connector\.status === 'stale'/)
})

test('office view groups reported sessions by source and role with reported status and task', () => {
  const markup = renderToStaticMarkup(React.createElement(AgentOfficeMap, {
    emptyMessage,
    sessions: [
      {
        id: 'local-1',
        name: 'Local worker',
        source: 'ghostforge-local',
        role: 'implementer',
        status: 'working',
        task: 'T-127',
      },
      {
        id: 'local-2',
        name: 'Local reviewer',
        source: 'ghostforge-local',
        role: 'implementer',
        status: 'idle',
      },
      {
        id: 'remote-1',
        name: 'Remote reviewer',
        source: 'remote-desk',
        role: 'reviewer',
      },
    ],
  }))

  assert.match(markup, /Agent office/)
  assert.match(markup, /aria-label="ghostforge-local — implementer"/)
  assert.match(markup, /aria-label="remote-desk — reviewer"/)
  assert.equal((markup.match(/aria-label="ghostforge-local implementer sessions"/g) ?? []).length, 1)
  assert.equal((markup.match(/role="listitem"/g) ?? []).length, 3)
  assert.match(markup, /Local worker/)
  assert.match(markup, /<dt[^>]*>Status<\/dt><dd[^>]*>working/)
  assert.match(markup, /<dt[^>]*>Task<\/dt><dd[^>]*>T-127/)
  assert.match(markup, /Status unknown/)
  assert.match(markup, /Task not reported/)
  assert.match(markup, /href="https:\/\/www\.gather\.town\/"/)
  assert.match(markup, /href="https:\/\/workadventu\.re\/"/)
})

test('empty office view explicitly reports that no sessions were snapshotted', () => {
  const markup = renderToStaticMarkup(React.createElement(AgentOfficeMap, {
    emptyMessage,
    sessions: [],
  }))

  assert.match(markup, /No sessions were reported by the available snapshots\./)
  assert.match(markup, /aria-label="Session view"/)
  assert.match(markup, /aria-pressed="true"[^>]*>Office/)
  assert.match(markup, />List<\/button>/)
  assert.match(componentSource, /<SessionList sessions=\{sessions\} emptyMessage=\{emptyMessage\} \/>/)
})

test('stale snapshot sessions are labelled stale without replacing their reported task', () => {
  const markup = renderToStaticMarkup(React.createElement(AgentOfficeMap, {
    emptyMessage,
    sessions: [{
      id: 'stale-session',
      name: 'Stale worker',
      source: 'remote-desk',
      role: 'worker',
      status: 'working',
      stale: true,
      task: 'T-126',
    }],
  }))

  assert.match(markup, /Stale/)
  assert.match(markup, /T-126/)
  assert.doesNotMatch(markup, /Task not reported/)
})

test('reduced-motion preference forces the accessible list fallback', () => {
  assert.match(componentSource, /prefers-reduced-motion: reduce/)
  assert.match(componentSource, /const visibleView = prefersReducedMotion \? 'list' : view/)
  assert.match(componentSource, /disabled=\{prefersReducedMotion\}/)
  assert.match(componentSource, /Reduced motion is enabled; showing the accessible session list\./)
})
