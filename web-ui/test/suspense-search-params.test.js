const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/**
 * `useSearchParams()` opts its component out of static prerendering, so Next.js
 * refuses to export the page unless the reader sits under a <Suspense>
 * boundary. Getting that wrong is a *build* failure, not a runtime one: it only
 * surfaces in `next build`, which the full health audit runs on a schedule, so
 * it can sit broken for a while. That is how /files broke — it read
 * `useSearchParams()` straight in its default export and
 * "Error occurred prerendering page /files … exiting the build" took the whole
 * web-build check down.
 *
 * These tests read the page sources (the same way nutjs-applescript.test.js
 * does) so the invariant is checked by `npm test` in seconds instead of by a
 * multi-minute build. They are structural, not a React renderer: the rule is
 * "no hook read above a Suspense boundary", so we check that every component
 * which calls the hook is rendered inside one.
 */

const APP = path.resolve(__dirname, '../app')

/** Every App Router page, skipping the non-routable names Next never exports. */
function pageFiles(dir = APP, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // `_`, `(group)`, `[param]` and `@slot` are router conventions, not URLs,
      // and a leading dot is local tool state — none are separate pages.
      if (/^[.([_@]/.test(entry.name)) continue
      pageFiles(full, out)
    } else if (entry.name === 'page.tsx' || entry.name === 'page.jsx' || entry.name === 'page.js') {
      out.push(full)
    }
  }
  return out
}

/**
 * Crude but sufficient JSX scan: the source text of one component function and
 * the JSX it returns. Good enough because the failure we are guarding is a
 * whole-file structural mistake (hook in the default export), not a subtle one
 * buried in a helper three calls deep.
 */
function components(src) {
  const out = []
  // Top-level function declarations: `export default function X` / `function X`.
  const re = /^(?:export\s+default\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm
  let m
  while ((m = re.exec(src))) {
    const start = m.index
    // Walk to the brace that closes the body, so nested helpers do not leak in.
    const open = src.indexOf('{', re.lastIndex)
    if (open === -1) continue
    let depth = 0
    let i = open
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    out.push({ name: m[1], body: src.slice(start, i + 1), start })
  }
  return out
}

/** Strip comments and string/template literals so matches are real code. */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
}

/**
 * Only `useSearchParams` bails out of static prerendering. `useRouter`,
 * `usePathname` and `useParams` are all readable during a static render, so
 * including them here would flag correct pages (app/agent-world/page.tsx calls
 * useRouter in its default export and has always built fine).
 */
const SEARCH_HOOKS = /\buseSearchParams\b/

const pages = pageFiles()
const readers = []
for (const file of pages) {
  const src = fs.readFileSync(file, 'utf8')
  for (const c of components(src)) {
    if (SEARCH_HOOKS.test(stripNoise(c.body))) {
      readers.push({ file: path.relative(APP, file).split(path.sep).join('/'), component: c.name, body: c.body })
    }
  }
}

test('the page scan actually finds the pages that read search params', () => {
  // A scan that silently matches nothing would make every check below pass for
  // the wrong reason, so pin that it found the two real sites.
  const names = readers.map(r => r.file).sort()
  assert.ok(
    names.includes('files/page.tsx'),
    `the scan must find files/page.tsx, found: ${JSON.stringify(names)}`
  )
  assert.ok(
    names.includes('login/page.tsx'),
    `the scan must find login/page.tsx, found: ${JSON.stringify(names)}`
  )
})

for (const r of readers) {
  test(`${r.file}: ${r.component}() reading search params is reachable from a Suspense boundary`, () => {
    const src = fs.readFileSync(path.join(APP, r.file), 'utf8')
    const comps = components(src)

    // Where is this component rendered from?
    const renderers = comps.filter(c => {
      const code = stripNoise(c.body)
      return new RegExp(`<\\s*${r.component}[\\s/>]`).test(code)
    })

    for (const renderer of renderers) {
      // Walk out through the render chain: a component only gets the boundary
      // if the component that renders it is itself inside one.
      assert.ok(
        /<Suspense[\s>]/.test(renderer.body),
        `${r.file}: <${r.component} /> is rendered by ${renderer.name}(), which has no ` +
          `<Suspense> around it — \`next build\` will fail with "useSearchParams() should ` +
          'be wrapped in a suspense boundary"'
      )
    }

    // A reader that is never rendered at all is dead code; if it is exported
    // from a page and never mounted, the boundary check above proves nothing.
    if (renderers.length === 0) {
      assert.ok(
        /<Suspense[\s>]/.test(src),
        `${r.file}: ${r.component}() reads search params but nothing renders it and the ` +
          'page has no <Suspense> at all'
      )
    }
  })
}

test('the default export of a search-param page is a Suspense boundary', () => {
  // The narrow form of the rule above, and the one /files actually broke on:
  // the component Next.js exports as the route must not itself read the hook.
  for (const r of readers) {
    const src = fs.readFileSync(path.join(APP, r.file), 'utf8')
    const m = /export\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(src)
    if (!m) continue
    assert.notEqual(
      m[1],
      r.component,
      `${r.file}: the default export (${m[1]}) is the same component that reads ` +
        'search params — it must be a thin wrapper that renders <Suspense>'
    )
  }
})

test('every page that reads search params imports Suspense', () => {
  const files = new Set(readers.map(r => r.file))
  for (const rel of files) {
    const src = fs.readFileSync(path.join(APP, rel), 'utf8')
    assert.match(
      src,
      /import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*['"]react['"]/,
      `${rel} uses a Suspense boundary but does not import Suspense from react`
    )
  }
})