// Renders a client page from app/ into jsdom with mocked fetch and Next.js
// router/link, then runs axe-core over the result. Not a *.test.js file, so
// `node --test test/*.test.js` only loads it through a11y-pages.test.js.
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
const axeSource = require('axe-core').source

const WEB_ROOT = join(__dirname, '..')

// Color contrast needs real CSS layout, which jsdom does not do.
const DISABLED_RULES = ['color-contrast']
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

function compile(module, filename) {
  const source = readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  })
  module._compile(outputText, filename)
}

let installed = false
const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} }

function installLoader() {
  if (installed) return
  installed = true
  const React = require('react')
  Module._extensions['.tsx'] = compile
  Module._extensions['.ts'] = compile
  const stubs = {
    'next/navigation': {
      useRouter: () => router,
      usePathname: () => '/',
      useSearchParams: () => new URLSearchParams(),
    },
    'next/link': {
      __esModule: true,
      default: ({ href, children, ...rest }) => {
        delete rest.prefetch
        return React.createElement('a', { href: typeof href === 'string' ? href : href?.pathname, ...rest }, children)
      },
    },
  }
  const load = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request]
    return load.call(this, request, parent, isMain)
  }
  const resolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/')) request = join(WEB_ROOT, request.slice(2))
    return resolve.call(this, request, ...rest)
  }
}

function installDom() {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><head><title>GhostForge</title></head><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' },
  )
  const { window } = dom
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
  }
  window.confirm = () => false
  // jsdom has no layout; axe's modal detection calls these and would
  // otherwise skip the page-level landmark/heading rules.
  window.document.elementFromPoint = () => null
  window.document.elementsFromPoint = () => []
  window.Element.prototype.scrollTo ??= () => {}
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * Render the default export of app/<pagePath> with fetch answered by `routes`
 * (pathname → response body or (url, init) → body), wait for data to settle,
 * optionally run `interact`, then return axe violations.
 */
async function renderPage(pagePath, routes) {
  installLoader()
  const window = installDom()
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const handler = routes[url.pathname]
    if (handler === undefined) return jsonResponse({ error: `unmocked ${url.pathname}` }, 404)
    return jsonResponse(typeof handler === 'function' ? handler(url, init) : handler)
  }
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const Page = require(join(WEB_ROOT, 'app', pagePath)).default
  const root = createRoot(window.document.getElementById('root'))
  const settle = () => React.act(async () => { await new Promise(r => setTimeout(r, 0)) })
  await React.act(async () => { root.render(React.createElement(Page)) })
  for (let i = 0; i < 5; i++) await settle()

  window.eval(axeSource)
  const page = {
    window,
    document: window.document,
    settle,
    async click(predicate) {
      const el = [...window.document.querySelectorAll('button, [role="tab"]')].find(predicate)
      if (!el) throw new Error('click target not found')
      await React.act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
      for (let i = 0; i < 5; i++) await settle()
    },
    async violations() {
      const results = await window.axe.run(window.document, {
        runOnly: { type: 'tag', values: AXE_TAGS },
        rules: Object.fromEntries(DISABLED_RULES.map(id => [id, { enabled: false }])),
        resultTypes: ['violations', 'incomplete'],
      })
      // A rule that threw inside axe reports "incomplete"; treat it as a
      // failure so a jsdom gap can't silently disable a check.
      const errored = results.incomplete.filter(r => r.nodes.some(n => n.none.concat(n.any, n.all).some(c => c.id === 'error-occurred')))
      return [...results.violations, ...errored]
    },
    unmount: () => React.act(async () => root.unmount()),
  }
  return page
}

function formatViolations(violations) {
  return violations.map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 5).map(n => `    ${n.target.join(' ')} — ${n.html.slice(0, 160)}`).join('\n')}`).join('\n')
}

module.exports = { renderPage, formatViolations }
