const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw error
    }
  },
})

const { PAGE_ACCESS, canAccessPage, getProfile, permissionsForProfile } = require('../lib/title-profiles.ts')
const page = readFileSync(resolve(__dirname, '../app/maintenance/page.tsx'), 'utf8')
const navbar = readFileSync(resolve(__dirname, '../components/Navbar.tsx'), 'utf8')
const executeRoute = readFileSync(resolve(__dirname, '../app/api/execute/route.ts'), 'utf8')

test.after(() => hooks.deregister())

test('maintenance page is authenticated, terminal-permission gated, and included in the navbar', () => {
  const access = PAGE_ACCESS.find(item => item.path === '/maintenance')
  assert.deepEqual(
    { permission: access?.permission, nav: access?.nav },
    { permission: 'terminal', nav: true },
  )
  assert.equal(canAccessPage(null, '/maintenance'), false)
  assert.equal(canAccessPage({ role: 'user', permissions: [] }, '/maintenance'), false)
  assert.equal(canAccessPage({ role: 'user', permissions: ['terminal'] }, '/maintenance/releases'), true)
  assert.equal(canAccessPage({ role: 'admin', permissions: [] }, '/maintenance'), true)
  assert.ok(permissionsForProfile(getProfile('engineer')).includes('terminal'))
  assert.match(navbar, /href: '\/maintenance'.*label: 'Maintenance'/)
  assert.match(page, /fetch\('\/api\/auth\/me'\)/)
  assert.match(page, /response\.status === 401/)
  assert.match(page, /\/login\?next=\/maintenance/)
  assert.match(page, /\/api\/execute/)
  assert.match(executeRoute, /requirePermission\(req, 'terminal'\)/)
})

test('maintenance buttons use commands already registered by the execute route', () => {
  const commands = [
    'ghostforge git-hooks-setup status',
    'ghostforge git-hooks-setup install',
    'ghostforge git-hooks-setup uninstall',
    'ghostforge upgrade --safe',
    'ghostforge upgrade --security',
    'ghostforge upgrade --all',
    'ghostforge release status',
    'ghostforge release prepare patch',
    'ghostforge release prepare minor',
    'ghostforge release prepare major',
    'ghostforge release tag',
    'ghostforge release notes',
    'ghostforge release publish',
  ]
  for (const command of commands) {
    assert.ok(page.includes(command), `maintenance page should expose "${command}"`)
    const subcommand = command.match(/^ghostforge ([a-z-]+)/)[1]
    assert.ok(executeRoute.includes(`['${subcommand}',`), `execute route should register "${subcommand}"`)
  }
  assert.match(executeRoute, /subcommand === 'upgrade' \? \{ timeoutMs: 180_000 \}/)
})

test('mutating maintenance actions require explicit confirmation and report execution outcomes', () => {
  assert.match(page, /action\.confirm && !window\.confirm\(action\.confirm\)/)
  assert.match(page, /!response\.ok \|\| Boolean\(data\.error\)/)
  assert.match(page, /role=\{result\.error \? 'alert' : 'status'\}/)
})
