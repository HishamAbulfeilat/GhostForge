# GhostForge agent teams

GhostForge can run a supervisor (“boss”) that assigns board tasks to isolated
agent worktrees, routes each task to a provider/model, reviews the result, and
merges only after the integration health check passes. The source of truth for
the team is `.agent-sync/team.json`; runtime state is kept in the shared
`.agent-sync/state/` directory.

This guide covers the local CLI and TUI controls. The web, desktop, and JARVIS
surfaces may expose the same controls when their bridge/API is enabled, but
they do not replace the CLI: the CLI remains the reliable recovery path when
the local runtime is unavailable.

## Prerequisites and setup

From the repository root:

```bash
npm install
node scripts/agents/boss.mjs setup
```

`setup` creates the configured integration and worker worktrees and installs
the dependencies required by each checkout. It does not start providers or
assign work. Provider CLIs must be installed and authenticated separately:

| Provider | Runtime command | Configuration |
| --- | --- | --- |
| Claude Code | `claude` | Claude Code login/configuration |
| GitHub Copilot CLI | `copilot` | Copilot CLI login/configuration |
| Codex | `codex` | Codex login/configuration |
| Gemini CLI | `gemini` | Gemini CLI login/configuration |
| OpenAI-compatible | `codex` | `OPENAI_API_KEY`, and optionally `OPENAI_BASE_URL` |

Enable providers in `.agent-sync/team.json`. The checked-in configuration
enables `copilot`, `copilot-qa`, `copilot-security`, `copilot-perf`, and
`copilot-design`; Claude, Codex, and Gemini are present but disabled by
default. Each enabled agent needs a distinct worktree path and branch.

## Start, stop, and monitor

The boss supports a one-shot smoke run, setup-only mode, and the continuous
supervisor:

```bash
node scripts/agents/boss.mjs setup
node scripts/agents/boss.mjs once --template pair
node scripts/agents/boss.mjs start --template trio
node scripts/agents/team.mjs status
node scripts/agents/team.mjs stop
```

`start` runs until stopped. `stop` writes a stop request; the boss finishes
in-flight work before exiting. `status` shows the phase, health score, merge
count, agent state/model, and outstanding board tasks. To inspect the message
bus directly:

```bash
node scripts/agents/team.mjs inbox --for copilot
node scripts/agents/team.mjs say --from human --to all "Please prioritize the failing health check."
```

Tasks and messages are shared across worktrees, so use `team.mjs` rather than
editing runtime state by hand. To add a task:

```bash
node scripts/agents/team.mjs add "Add regression coverage for the bridge" `
  --kind test --area web-ui/test --from human
```

On Windows PowerShell, the backtick continues the command; on macOS/Linux use
`\` or put the command on one line. The supported task kinds include
`feature`, `bugfix`, `test`, `security`, `refactor`, `docs`, and `chore`.

## Reusable team templates

Templates are implemented, checked-in JSON presets under
`.agent-sync/templates/` and are selected with `--template` (either before or
after the command). The default is `pair`.

| Template | Enabled roles | Use when |
| --- | --- | --- |
| `pair` | `copilot`, `copilot-qa` | Small implementation plus QA loop |
| `trio` | `copilot`, `copilot-qa`, `copilot-security` | Normal feature work needing QA and security coverage |
| `reviewer-heavy` | `copilot`, `copilot-qa`, `copilot-security`, `copilot-perf`, `copilot-design` | Broad validation, performance, and UX review |

Aliases include `default` and `duo` for `pair`, plus
`reviewer-heavy-team`, `reviewerheavy`, and `reviewer_heavy` for
`reviewer-heavy`. An unknown template fails before the boss starts and lists
the available choices.

Template application clones the base team configuration, enables the selected
agent IDs, disables other configured agents, and adds any selected IDs that
are not already in the base config. It does not mutate `.agent-sync/team.json`.
This makes a template safe to reuse:

```bash
node scripts/agents/boss.mjs start --template reviewer-heavy
```

To add a preset, add a JSON object with `name`, `description`, and either an
agent array or an agent-to-boolean map in `.agent-sync/templates/`, then run:

```bash
node --test scripts/agents/boss-templates.test.mjs
```

The template's agent IDs must correspond to entries in `team.json` (or the
boss will create a minimal enabled entry, which still needs a valid provider
and worktree before it can execute work).

## Providers and model routing

Every board task has a kind. `scripts/agents/lib/models.mjs` maps kinds to
tiers:

| Tier | Task kinds |
| --- | --- |
| Deep | planning, review, security, merge, architecture |
| Balanced | feature, bugfix, test, refactor |
| Fast | docs, chore |

The provider's tier table in `team.json` selects the concrete model. An
explicit task model wins; otherwise `auto` lets the provider choose. The
default Copilot table uses `auto` for every tier. Claude defaults to
`opus`/`sonnet`/`haiku`; Codex and Gemini default to `auto`. You can override
the table in `.agent-sync/team.json` without changing task routing.

The `openai` and `openai-compatible` adapters invoke Codex and pass endpoint
and credentials through the child process environment, never command-line
arguments or logs:

```json
{
  "provider": "openai-compatible",
  "endpoint": "https://gateway.example/v1",
  "apiKeyEnv": "GATEWAY_API_KEY"
}
```

Set `GATEWAY_API_KEY` in the environment before starting the boss. Never put
keys in `team.json`, task text, or the repository.

## Surface controls

### CLI

The CLI is the complete control surface and works from any worktree. Use
`boss.mjs` for lifecycle and `team.mjs` for status, inbox, messages, and task
requests as shown above.

### TUI

Run `node tui/index.js` and choose **Agent Team**. The menu starts the boss
detached and exposes status, inbox, send-message, add-task, and stop actions.
The TUI delegates to the same `team.mjs` commands and reports missing scripts
or provider/startup failures instead of silently succeeding.

### Web, desktop, and JARVIS

These surfaces are control clients, not separate supervisors: they should
delegate lifecycle and board operations to the local agent-team API/bridge,
which in turn uses the same shared runtime state and scripts. If the API or
bridge is not running, use the CLI/TUI recovery path. Do not launch a second
boss for each surface; the boss PID lock prevents concurrent supervisors.

## Permissions and local-runtime limitations

Workers run in their own worktrees. The boss is the only component intended to
integrate or publish changes. Provider adapters deny worker `git push` and PR
merge operations, while read-only reviews receive no write or shell access
where the provider supports those controls. Keep credentials in environment
variables or the provider's own credential store.

The runtime is local and process-based:

- A provider CLI must be installed, logged in, and available on `PATH`; the
  boss cannot install or authenticate it for you.
- The configured worktree paths must be writable and must not already be
  checked out by another branch.
- A stale `.agent-sync/state/boss.pid` is handled when its process is gone;
  an active PID intentionally blocks a second boss.
- `stop` is graceful and does not kill a provider that is already in flight.
- If a provider is unavailable or rate-limited, the boss records the failure
  and applies its cooldown policy; check `status` and the state logs.
- On Windows, provider commands are launched through `.cmd` shims and worker
  termination uses the Windows process tree. Shell quoting and provider
  behavior can still differ from macOS/Linux.
- A web or desktop process closing does not stop the boss. Stop it explicitly
  with `team.mjs stop`.

Before handing off changes, run the repository health check:

```bash
node scripts/agents/health.mjs
```

The supervisor also uses this health result as its merge regression gate.
