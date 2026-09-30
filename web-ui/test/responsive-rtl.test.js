const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync, statSync } = require('node:fs')
const { join, extname } = require('node:path')

/**
 * T-12 (cross-device QA): responsive breakpoints + RTL rendering.
 *
 * There's no Playwright/browser harness wired into this repo yet (no
 * @playwright/test dependency, no playwright.config.*), so full viewport
 * screenshots aren't possible from `node --test`. This file instead:
 *   1. Statically audits app/**, components/** for physical-direction
 *      Tailwind classes that break RTL (AGENTS.md: use ms-/me-/ps-/pe-/
 *      text-start/text-end instead of ml-/mr-/pl-/pr-/text-left/text-right).
 *      A fixed allowlist of already-known violations keeps this test green
 *      while still failing on *new* regressions.
 *   2. Verifies the root layout declares a direction-aware `dir` and a
 *      responsive viewport so mobile/tablet/desktop all get correct
 *      layout + text direction.
 *   3. Verifies Tailwind's default responsive breakpoints (sm/md/lg/xl/2xl)
 *      are not overridden away, since components rely on the defaults for
 *      mobile/tablet/desktop layout switches.
 *
 * Manual verification steps for the parts this can't automate (documented
 * here rather than skipped, per the T-12 task fallback):
 *   - Open the app with Chrome DevTools device toolbar at 375×667 (mobile),
 *     834×1194 (tablet), 1440×900 (desktop) and confirm the Navbar collapses
 *     into a mobile menu below the `md` breakpoint (768px).
 *   - Switch the browser/OS language to Arabic and confirm: the command
 *     palette, Navbar and JARVIS chat bubbles mirror correctly (icons that
 *     imply direction, like chevrons, should flip; icons that don't, like a
 *     robot avatar, should not).
 *   - Resize the JARVIS chat page between 320px and 2560px width and confirm
 *     no horizontal scrollbar appears and the input bar stays reachable.
 */

const APP_DIR = join(__dirname, '..', 'app')
const COMPONENTS_DIR = join(__dirname, '..', 'components')

// Known pre-existing physical-direction classes (flagged for the [design]
// lane to convert to logical utilities; not touched here per T-08/T-12 scope
// — QA doesn't own web-ui/app or web-ui/components).
const KNOWN_VIOLATIONS = new Set([
  'app/workflows/page.tsx::text-left',
  'app/marketplace/page.tsx::text-left',
])

const PHYSICAL_CLASS_RE = /\b(?:ml|mr|pl|pr)-(?:\d|px|auto|\[)|\btext-(?:left|right)\b/g

function listFiles(dir) {
  let out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out = out.concat(listFiles(full))
    else if (['.tsx', '.ts', '.jsx', '.js'].includes(extname(entry))) out.push(full)
  }
  return out
}

function relKey(file) {
  return file.replace(join(__dirname, '..') + require('node:path').sep, '').split(require('node:path').sep).join('/')
}

function scanForPhysicalClasses() {
  const files = [...listFiles(APP_DIR), ...listFiles(COMPONENTS_DIR)]
  const found = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const rel = relKey(file)
    for (const match of text.matchAll(PHYSICAL_CLASS_RE)) {
      // Normalize e.g. "ml-4" -> "ml", "text-left" -> "text-left"
      const token = match[0].startsWith('text-') ? match[0] : match[0].replace(/-.*$/, '')
      found.push(`${rel}::${token}`)
    }
  }
  return found
}

test('no *new* physical-direction Tailwind classes were introduced (RTL regression guard)', () => {
  const found = new Set(scanForPhysicalClasses())
  const unexpected = [...found].filter(f => !KNOWN_VIOLATIONS.has(f))
  assert.deepEqual(unexpected, [], `New physical-direction class(es) found — use logical utilities (ms-/me-/ps-/pe-/text-start/text-end) instead:\n${unexpected.join('\n')}`)
})

test('root layout is direction-aware (dir attribute) so RTL locales render correctly', () => {
  const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
  assert.match(layout, /<html[^>]*\bdir=/, 'app/layout.tsx <html> must declare a dir attribute for RTL support')
  assert.match(layout, /<html[^>]*\blang=/, 'app/layout.tsx <html> must declare a lang attribute')
})

test('root layout declares a responsive, mobile-safe viewport', () => {
  const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
  assert.match(layout, /width:\s*['"]device-width['"]/, 'viewport must use device-width so mobile/tablet layouts scale correctly')
})

test('tailwind config does not override away the default responsive breakpoints', () => {
  const config = readFileSync(join(__dirname, '..', 'tailwind.config.ts'), 'utf8')
  // A custom `screens` block would replace Tailwind's default sm/md/lg/xl/2xl
  // breakpoints that components rely on for mobile/tablet/desktop switches.
  assert.doesNotMatch(config, /\bscreens\s*:/, 'tailwind.config.ts should not override the default sm/md/lg/xl/2xl breakpoints used across the app')
})
