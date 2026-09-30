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
}

export function commandFor(provider, opts) {
  const make = PROVIDERS[provider]
  if (!make) throw new Error(`Unknown provider "${provider}" — add it to scripts/agents/lib/providers.mjs`)
  return make(opts)
}

/** Output meaning "out of quota / rate limited" → cool the agent down, don't fail the task. */
export const RATE_LIMIT_RE = /rate.?limit|usage limit|quota|\b429\b|too many requests|credit balance|limit reached/i

/**
 * Quote one arg for `spawn(..., { shell: true })` on Windows, where npm-installed
 * CLIs are .cmd shims. Our args never contain double quotes, but guard anyway.
 */
export function winQuote(arg) {
  const s = String(arg).replace(/"/g, '\\"')
  return /[\s&|<>^()]/.test(s) ? `"${s}"` : s
}
