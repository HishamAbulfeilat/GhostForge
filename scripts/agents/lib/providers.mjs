// Provider adapters: how to run one headless task on each agent CLI.
//
// Every adapter returns { cmd, args } for a single non-interactive run. The
// prompt is always the same short line pointing at a task file, which keeps
// argument quoting trivial on every shell. Workers may edit and commit in their
// own worktree but are denied `git push` and PR merges — only the boss
// integrates. To add a provider, add an entry here and an agent in team.json.

/** `mode`: 'work' (edits allowed) or 'readonly' (boss review/planning). */
export const PROVIDERS = {
  claude: ({ prompt, model, mode }) => ({
    cmd: 'claude',
    args: [
      '-p', prompt,
      ...(model && model !== 'auto' ? ['--model', model] : []),
      ...(mode === 'readonly'
        ? ['--permission-mode', 'plan']
        : ['--permission-mode', 'bypassPermissions', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh pr merge:*)']),
    ],
  }),

  copilot: ({ prompt, model, mode }) => ({
    cmd: 'copilot',
    args: [
      '-p', prompt,
      '--model', model || 'auto',
      '--no-color',
      ...(mode === 'readonly'
        ? ['--allow-tool', 'read', '--deny-tool', 'write', '--deny-tool', 'shell']
        : ['--allow-all-tools', '--deny-tool', 'shell(git push)', '--deny-tool', 'shell(gh pr merge)']),
    ],
  }),

  codex: ({ prompt, model, mode }) => ({
    cmd: 'codex',
    args: [
      'exec',
      ...(model && model !== 'auto' ? ['-m', model] : []),
      ...(mode === 'readonly' ? ['-s', 'read-only'] : ['--full-auto']),
      prompt,
    ],
  }),

  gemini: ({ prompt, model, mode }) => ({
    cmd: 'gemini',
    args: [
      '-p', prompt,
      ...(model && model !== 'auto' ? ['-m', model] : []),
      '--approval-mode', mode === 'readonly' ? 'plan' : 'yolo',
    ],
  }),

  // Codex speaks the OpenAI API and can target any compatible gateway via
  // environment variables. Keep credentials out of argv so they never appear
  // in process listings or the agent log.
  openai: ({ prompt, model, mode, config = {} }) => openAICompatible({ prompt, model, mode, config }),
  'openai-compatible': ({ prompt, model, mode, config = {} }) => openAICompatible({ prompt, model, mode, config }),
  openrouter: ({ prompt, model, mode, config = {} }) => gatewayProvider({
    prompt, model, mode, config,
    endpointEnv: 'OPENROUTER_BASE_URL',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-r1:free',
  }),
  omniroute: ({ prompt, model, mode, config = {} }) => gatewayProvider({
    prompt, model, mode, config,
    endpointEnv: 'OMNIROUTE_URL',
    defaultEndpoint: 'http://127.0.0.1:20128/v1',
    apiKeyEnv: 'OMNIROUTE_API_KEY',
    defaultModel: 'auto',
    passAutoModel: true,
  }),
}

function gatewayProvider({ prompt, model, mode, config, endpointEnv, defaultEndpoint, apiKeyEnv, defaultModel, passAutoModel = false }) {
  const configuredEndpoint = config.endpoint ?? config.baseUrl ?? process.env[endpointEnv] ?? defaultEndpoint
  const endpoint = normalizeOpenAIEndpoint(configuredEndpoint)
  return openAICompatible({
    prompt,
    model: model && model !== 'auto' ? model : (config.model || defaultModel),
    mode,
    config: {
      ...config,
      endpoint,
      apiKeyEnv: config.apiKeyEnv ?? apiKeyEnv,
      clearMissingKey: true,
      passAutoModel,
    },
  })
}

function normalizeOpenAIEndpoint(value) {
  const endpoint = String(value).trim().replace(/\/+$/, '')
  return endpoint.endsWith('/v1') ? endpoint : `${endpoint}/v1`
}

function openAICompatible({ prompt, model, mode, config = {} }) {
  const endpoint = config.endpoint ?? config.baseUrl ?? process.env.OPENAI_BASE_URL
  const apiKeyName = config.apiKeyEnv ?? 'OPENAI_API_KEY'
  const apiKey = process.env[apiKeyName]
  const env = {}
  if (endpoint) env.OPENAI_BASE_URL = endpoint
  if (apiKey) env.OPENAI_API_KEY = apiKey
  else if (config.clearMissingKey) env.OPENAI_API_KEY = ''

  return {
    cmd: 'codex',
    args: [
      'exec',
      ...(model && (model !== 'auto' || config.passAutoModel) ? ['-m', model] : []),
      ...(mode === 'readonly' ? ['-s', 'read-only'] : ['--full-auto']),
      prompt,
    ],
    env,
  }
}

export function commandFor(provider, opts) {
  const make = PROVIDERS[provider]
  if (!make) throw new Error(`Unknown provider "${provider}" — add it to scripts/agents/lib/providers.mjs`)
  return make(opts)
}

/** Output meaning "out of quota / rate limited" → cool the agent down, don't fail the task. */
export const RATE_LIMIT_RE = /rate.?limit|usage limit|quota|\b429\b|too many requests|credit balance|limit reached|session limit|hit your (?:\w+ )?limit|limit · resets/i

/**
 * Quote one arg for `spawn(..., { shell: true })` on Windows, where npm-installed
 * CLIs are .cmd shims. Our args never contain double quotes, but guard anyway.
 */
export function winQuote(arg) {
  const s = String(arg)
  // cmd.exe has no safe escape for an embedded double quote (and \" breaks on a
  // trailing backslash), so refuse it instead of half-escaping.
  if (s.includes('"')) throw new Error(`winQuote: refusing an argument containing a double quote: ${s.slice(0, 80)}`)
  return /[\s&|<>^()]/.test(s) ? `"${s}"` : s
}
