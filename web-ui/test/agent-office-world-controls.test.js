const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APP = path.join(__dirname, '..', 'app')
const read = file => fs.readFileSync(path.join(APP, file), 'utf8')

test('agent-office world route is admin-only and only runs fixed manager commands', () => {
  const route = read('api/worlds/agent-office/route.ts')
  assert.match(route, /requirePermission\(request, 'admin_tools'\)/)
  assert.equal((route.match(/requirePermission\(/g) || []).length, 2, 'GET and POST both check permission')
  assert.match(route, /const WORLD = 'agent-office'/)
  assert.match(route, /'scripts', 'worlds\.mjs'/)
  assert.match(route, /action !== 'start' && action !== 'stop'/)
  assert.match(route, /MAX_BODY_BYTES/)
  assert.doesNotMatch(route, /shell:\s*true/)
  assert.doesNotMatch(route, /\bexec\(/)
})

test('/agent-world office view mounts Start/Stop/Open controls with a sandboxed loopback iframe', () => {
  const page = read('agent-world/page.tsx')
  assert.match(page, /import AgentOfficeControls from '\.\/AgentOfficeControls'/)
  assert.match(page, /world === 'office' && \([\s\S]*?<AgentOfficeControls \/>/)
  const controls = read('agent-world/AgentOfficeControls.tsx')
  assert.match(controls, /fetch\('\/api\/worlds\/agent-office'/)
  // Whitespace/line-ending tolerant: Windows checkouts use CRLF.
  assert.match(controls, />\s*Start\s*<\/button>/, 'Start')
  assert.match(controls, />\s*Stop\s*<\/button>/, 'Stop')
  assert.match(controls, /'Open'/, 'Open')
  assert.match(controls, /<iframe[\s\S]*?sandbox="allow-forms allow-scripts allow-same-origin"/)
  assert.match(controls, /src=\{status\.url\}/)
  assert.doesNotMatch(controls, /\b(ml|mr|pl|pr)-\d|text-(left|right)\b/, 'logical utilities only (RTL)')
})
