// Baseline accessibility check: render key pages with realistic API data and
// fail on any axe-core violation (WCAG 2.1 A/AA + best practices; color
// contrast is skipped because jsdom has no CSS layout).
const test = require('node:test')
const assert = require('node:assert/strict')
const { renderPage, formatViolations } = require('./a11y-harness.js')

const agent = (extra = {}) => ({ provider: 'claude', state: 'idle', task: null, model: 'opus', since: null, cooldownUntil: null, ...extra })

const AGENTS_ROUTES = {
  '/api/auth/me': { user: { role: 'admin', permissions: ['admin_tools'] }, isAdmin: true },
  '/api/agents': {
    snapshot: {
      health: 92,
      running: false,
      phase: 4,
      agents: {
        claude: agent({ state: 'working', task: 'T-2', since: '2026-10-03T12:00:00Z' }),
        'claude-2': agent({ provider: 'copilot', model: 'auto' }),
      },
      boss: agent({ leader: true }),
      tasks: [
        { id: 'T-1', title: 'Write the spec', kind: 'docs', status: 'done', owner: 'claude-2' },
        { id: 'T-2', title: 'Add accessibility tests', kind: 'test', status: 'in-progress', owner: 'claude', dependencies: ['T-1'], acceptanceCriteria: ['axe passes'] },
        { id: 'T-3', title: 'Fix flaky build', kind: 'bugfix', status: 'blocked', owner: null, dependencies: ['T-9'] },
      ],
      messages: [{ from: 'boss', to: 'all', ts: '2026-10-03T12:45:00Z', text: 'Boss online.' }],
      workflow: { leader: 'boss', mode: 'parallel', specialists: ['claude'] },
    },
  },
  '/api/agents/templates': {
    templates: [{ id: 'tpl-1', name: 'Nightly tests', title: 'Run the test suite', kind: 'test', leader: 'boss', assignee: 'any', workflow: 'parallel', dependencies: [], acceptanceCriteria: [], createdAt: '2026-10-01T00:00:00Z' }],
  },
}

const MARKETPLACE_ROUTES = {
  '/api/marketplace': {
    sources: [
      { id: 'src-1', name: 'Claude Skills', type: 'skills', description: 'Official skills.', url: 'https://example.com/skills', install_claude_code: '/plugin install skills', categories: ['Code', 'Quality'] },
      { id: 'src-2', name: 'MCP Servers', type: 'mcp', description: 'Reference MCP servers.', categories: ['Tools'] },
    ],
    items: [
      { id: 'gitleaks', name: 'Gitleaks', type: 'tool', category: 'Security', description: 'Find secrets in git history.', source: 'github', tags: ['secrets'], install_command: 'brew install gitleaks' },
      { id: 'reviewer', name: 'Code Reviewer', type: 'agent', category: 'Quality', description: 'Reviews diffs.', source: 'local', tags: ['review'] },
    ],
    installed: ['src-1', 'reviewer'],
  },
  '/api/huggingface': {
    items: [{ id: 'org/model', author: 'org', name: 'model', type: 'LLM', downloads: 12000, likes: 340, license: 'mit', size: '7B', pipelineTag: 'text-generation', tags: ['llama', 'chat'], lastModified: null }],
  },
  '/api/awesome-llm-apps': {
    items: [{ id: 'app-1', name: 'RAG Chat', path: 'rag/chat', category: 'rag', description: 'Chat with documents.', url: 'https://example.com/rag' }],
    categories: ['rag', 'agents'],
  },
}

const step = (id, title, kind, ref, status, deps = [], log = []) => ({ id, title, kind, ref, deps, status, notes: '', log })
const WORKFLOWS_ROUTES = {
  '/api/workflows': {
    workflows: [{
      id: 'wf-1', name: 'Release readiness', goal: 'Check the release is safe to ship.', status: 'draft',
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      progress: { done: 1, total: 3, pct: 33 },
      steps: [
        step('s1', 'Bridge health', 'command', 'bridge:health', 'done', [], [{ at: '2026-10-01T00:00:00Z', msg: 'Completed bridge:health' }]),
        step('s2', 'Review diff', 'agent', 'ecc:code-reviewer', 'pending', ['s1']),
        step('s3', 'Sign off', 'manual', 'Owner approves', 'pending', ['s2']),
      ],
    }],
  },
}

const SETUP_PROFILES = [
  { id: 'engineering', label: 'Software Engineering', description: 'Code, terminal and agents.', permissions: [{ key: 'terminal', label: 'Terminal' }, { key: 'files', label: 'Files' }], pages: [{ path: '/terminal', label: 'Terminal', icon: '🖥️' }, { path: '/files', label: 'Files', icon: '📁' }] },
  { id: 'general', label: 'General', description: 'Chat and files.', permissions: [{ key: 'files', label: 'Files' }], pages: [{ path: '/files', label: 'Files', icon: '📁' }] },
]
const setupRoutes = isAdmin => ({
  '/api/setup': {
    user: { name: 'Ada', username: 'ada', role: isAdmin ? 'admin' : 'user', jobTitle: 'Software Engineer', profileId: null, setupComplete: false },
    isAdmin,
    profiles: SETUP_PROFILES,
  },
  '/api/bridge-status': { status: 'connected' },
  '/api/models': { providers: [{ id: 'anthropic', name: 'Anthropic', configured: true }] },
})

async function assertAccessible(page, label) {
  const violations = await page.violations()
  assert.equal(violations.length, 0, `${label} has accessibility violations:\n${formatViolations(violations)}`)
}

const text = el => el.textContent.trim()

test('agents page has no axe violations', async () => {
  const page = await renderPage('agents/page.tsx', AGENTS_ROUTES)
  assert.match(page.document.body.textContent, /Add accessibility tests/, 'snapshot did not render')
  await assertAccessible(page, '/agents')
  await page.unmount()
})

test('marketplace page has no axe violations on every tab', async () => {
  const page = await renderPage('marketplace/page.tsx', MARKETPLACE_ROUTES)
  assert.match(page.document.body.textContent, /Claude Skills/, 'sources did not render')
  await assertAccessible(page, '/marketplace (Claude tab)')
  for (const [tab, marker] of [['Commands', /Gitleaks/], ['HuggingFace', /org\/model|model/], ['Awesome LLM Apps', /RAG Chat/]]) {
    await page.click(el => text(el).endsWith(tab))
    assert.match(page.document.body.textContent, marker, `${tab} tab did not render`)
    await assertAccessible(page, `/marketplace (${tab} tab)`)
  }
  await page.unmount()
})

test('workflows page has no axe violations in map, steps, log and edit views', async () => {
  const page = await renderPage('workflows/page.tsx', WORKFLOWS_ROUTES)
  assert.match(page.document.body.textContent, /Release readiness/, 'workflows did not render')
  await assertAccessible(page, '/workflows (map)')
  for (const tab of ['steps', 'log']) {
    await page.click(el => el.getAttribute('role') === 'tab' && text(el) === tab)
    await assertAccessible(page, `/workflows (${tab})`)
  }
  await page.click(el => text(el) === 'Edit')
  assert.ok(page.document.getElementById('wf-name'), 'editor did not open')
  await assertAccessible(page, '/workflows (edit)')
  await page.unmount()
})

test('setup page has no axe violations for users and admins', async () => {
  for (const isAdmin of [false, true]) {
    const page = await renderPage('setup/page.tsx', setupRoutes(isAdmin))
    assert.ok(page.document.getElementById('gf-name'), 'setup form did not render')
    await assertAccessible(page, `/setup (${isAdmin ? 'admin' : 'user'})`)
    await page.unmount()
  }
})
