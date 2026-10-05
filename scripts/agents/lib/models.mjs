// Task-aware model routing for the agent team.
//
// Every task on the board has a `kind`. The router maps (agent, kind) → model
// so heavy reasoning goes to the deepest model, routine work to a balanced one,
// and chores to the fastest. `auto` lets a provider pick for itself (Copilot's
// `--model auto`), which is the default for any agent without a routing table.

/** Task kinds, ordered roughly by how much reasoning they need. */
export const TASK_KINDS = ['plan', 'review', 'security', 'merge', 'architecture', 'feature', 'bugfix', 'test', 'refactor', 'docs', 'chore']

/** Tier each kind needs. Providers map tiers to concrete model ids. */
export const KIND_TIER = {
  plan: 'deep', review: 'deep', security: 'deep', merge: 'deep', architecture: 'deep',
  feature: 'balanced', bugfix: 'balanced', test: 'balanced', refactor: 'balanced',
  docs: 'fast', chore: 'fast',
}

/** Default tier → model per provider. Overridable in .agent-sync/team.json `models`. */
export const DEFAULT_TIER_MODELS = {
  claude:  { deep: 'opus', balanced: 'sonnet', fast: 'haiku' },
  copilot: { deep: 'auto', balanced: 'auto', fast: 'auto' },
  codex:   { deep: 'auto', balanced: 'auto', fast: 'auto' },
  gemini:  { deep: 'auto', balanced: 'auto', fast: 'auto' },
}

// Order matters: the first matching kind wins.
const KEYWORDS = [
  ['security', /\b(security|vuln\w*|cve|xss|ssrf|csrf|injection|secrets?|owasp|codeql)\b/i],
  ['review', /\b(review|audit)\b/i],
  ['test', /\b(tests?|spec|coverage|e2e|playwright|jest|vitest)\b/i],
  ['bugfix', /\b(fix\w*|bugs?|broken|crash\w*|errors?|fail\w*|regression)\b/i],
  ['docs', /\b(docs?|readme|changelog|documentation)\b/i],
  ['refactor', /\b(refactor\w*|cleanup|clean up|dedupe|simplif\w*|rename|knip|unused)\b/i],
  ['architecture', /\b(architecture|adr|redesign|migrat\w*)\b/i],
  ['chore', /\b(chore|bump|lint|format\w*|typo|config)\b/i],
]

/** Guess a task kind from free text; falls back to `feature`. */
export function classifyTask(text = '') {
  for (const [kind, re] of KEYWORDS) if (re.test(text)) return kind
  return 'feature'
}

/**
 * Pick the model for an agent doing a task.
 * @param {string} provider   agent provider id (claude, copilot, codex, gemini…)
 * @param {{kind?: string, title?: string, model?: string}} task
 * @param {Record<string, Record<string,string>>} [overrides] team.json `models`
 * @returns {{model: string, tier: string, kind: string}}
 */
export function routeModel(provider, task = {}, overrides = {}) {
  const kind = TASK_KINDS.includes(task.kind) ? task.kind : classifyTask(task.title)
  const tier = KIND_TIER[kind] ?? 'balanced'
  if (task.model) return { model: task.model, tier, kind } // an explicit pin wins
  const table = { ...(DEFAULT_TIER_MODELS[provider] ?? {}), ...(overrides[provider] ?? {}) }
  return { model: table[tier] ?? 'auto', tier, kind }
}

/**
 * Keep Claude Pro for the boss: Claude workers ask the claude-switch proxy for
 * free models by tier (deep/balanced/fast), sent as a request header.
 * Deep-tier work (plan, review, security, merge, architecture) stays on Pro and
 * is flagged so the boss can tell the user. team.json `workersOnFree: false`
 * turns this off.
 * @returns {{ env: Record<string,string>, needsPro: boolean }}
 */
export function workerRoute(provider, route, cfg = {}) {
  if (provider !== 'claude' || cfg.workersOnFree === false) return { env: {}, needsPro: false }
  if (route.tier === 'deep') return { env: {}, needsPro: true }
  return { env: { ANTHROPIC_CUSTOM_HEADERS: `x-claude-switch-route: free:${route.tier}` }, needsPro: false }
}
