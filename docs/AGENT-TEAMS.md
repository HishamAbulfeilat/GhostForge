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

The authenticated `/agents` dashboard also supports a lightweight orchestration
composer: choose the workflow leader, assign specialist roles, select an ordered
or parallel mode, and attach task dependencies plus acceptance criteria before
adding a board item. The API snapshot surfaces those values as `workflow`,
`leader`, and `assignee` metadata so the UI can render team ownership and
review state without guessing.

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

## Configure providers and worktrees

`.agent-sync/team.json` is the base configuration. Keep it valid JSON and give
each enabled worker a unique `worktree` and `branch`; worktree paths are
relative to the repository root. The integration worktree and branch are
configured separately. For example:

```json
{
  "integration": {
    "branch": "agent/integration",
    "worktree": "../gf-integration",
    "base": "main"
  },
  "agents": {
    "copilot": {
      "provider": "copilot",
      "enabled": true,
      "worktree": "../gf-copilot",
      "branch": "agent/copilot/work",
      "strengths": ["feature", "bugfix", "test"]
    }
  }
}
```

`provider` selects an installed CLI adapter (`claude`, `copilot`, `codex`,
`gemini`, `openai`, or `openai-compatible`). `enabled` controls whether the
boss schedules that worker. `strengths` are preferred task kinds, not an
access-control list. Provider-specific settings can be placed under `config`
(or `providerConfig`). For an OpenAI-compatible endpoint, use an environment
variable for the key:

```json
{
  "provider": "openai-compatible",
  "config": {
    "endpoint": "https://gateway.example/v1",
    "apiKeyEnv": "GATEWAY_API_KEY"
  }
}
```

Set `GATEWAY_API_KEY` in the environment that launches the boss; never put the
secret in this file. Model routing maps task kinds to `deep`, `balanced`, or
`fast`, then reads the selected provider's model from `models`. An explicit
model on a task takes precedence. Operational limits such as
`tickSeconds`, `taskTimeoutMinutes`, `maxAttempts`, and `cooldownMinutes` are
also configured in `team.json`.

After changing providers, branches, or worktree paths, run `setup` again to
prepare the configured checkouts. It creates missing worktrees and syncs
`web-ui` dependencies when needed; it does not install or log in to provider
CLIs. A branch already checked out elsewhere, a missing provider executable,
or an unauthenticated provider prevents that worker from completing tasks.

## Shared runtime state and `GF_AGENT_STATE`

By default, the boss and team CLI share runtime files in
`.agent-sync/state/`. This is local runtime data, not task-board source files
to commit. Set `GF_AGENT_STATE` before launching the boss and every control
surface if you need a different shared location. Use an absolute path that is
available to the boss, workers, and UI/API process; for the web API, keep the
resolved path inside the repository workspace. A different or inconsistent
value makes each process read a different board/status and appear out of sync.

The principal runtime files are:

| File or directory | Purpose |
| --- | --- |
| `board.json` | Shared task board; the boss is its normal writer |
| `messages.jsonl` | Append-only team messages |
| `status.json` | Boss heartbeat, PID, health, phase, merge count, and worker state |
| `boss.pid` | Prevents multiple active supervisors |
| `STOP` | Graceful stop request, removed at the next boss start |
| `requests.jsonl` | Tasks queued by `team.mjs add` for the boss to ingest |
| `results/<task-id>.json` | A worker's `done` or `block` result for a task |
| `logs/` | Provider and supervisor logs |
| `tasks/`, `reviews/` | Staged worker instructions and read-only review/planning prompts |

The boss passes its resolved state directory to worker processes as
`GF_AGENT_STATE`, so they report results into the same runtime. To override it
in PowerShell before starting any local process:

```powershell
$env:GF_AGENT_STATE = (Resolve-Path ".agent-sync\state").Path
node scripts/agents/boss.mjs start
```

If the directory does not exist yet, create it first or use the default. Keep
the override consistent across separate shells and services.

## Web, desktop, and JARVIS access

The web Agent Teams page is `/agents`; its API is `GET` and `POST /api/agents`.
The page/API can show health, running state, phase, workers (provider, state,
model, current task), board tasks, and messages. Supported API actions are
`status`, `start`, `stop`, `say`, and `add`. A `say` request accepts
`message` and optional `from`/`to` (defaulting to `boss`/`all`); an `add`
request accepts `title`, optional `kind`/`area`/`agent` (defaulting to
`feature`/empty/`any`). The API requires a signed-in user with `admin_tools`
for both reads and commands; the JARVIS `agent_team` tool uses the same
permission. A denied request returns HTTP 403.

The TUI and CLI are local process controls and do not use the web account
permission gate. Treat access to the machine and repository as privileged.
Desktop/web controls rely on the local API/runtime being available; if they
cannot connect, use `team.mjs` or the TUI from the repository checkout.
Starting from a second surface does not create a second team: the boss PID
lock prevents concurrent supervisors.

## Safe shutdown and recovery

Request a graceful shutdown with:

```bash
node scripts/agents/team.mjs stop
```

This creates `STOP`; the boss finishes in-flight worker runs, publishes any
completed merges when appropriate, then exits. `Ctrl-C` in the boss terminal
also requests a graceful stop; a second `Ctrl-C` forces the boss process to
exit and can interrupt that shutdown. Do not remove `boss.pid` or `STOP` while
the boss is active, and do not start another boss to try to recover a stuck
one. Closing the web/desktop app does not stop the local boss.

Use `node scripts/agents/team.mjs status` and inspect
`.agent-sync/state/boss.log` plus the relevant file under `logs/` when a
worker looks stale or blocked:

- **Status heartbeat is old:** compare `status.json`'s timestamp/PID with
  `boss.pid` and check `boss.log`. A live PID may still be working or waiting
  on a provider; request `stop` and allow the current run to finish before
  restarting.
- **A task remains `in-progress` or `review`:** on a normal boss restart,
  unfinished tasks in those states are returned to `todo` and unassigned.
  Check the previous worker log and commit before restarting so you do not
  mistake incomplete work for completed work.
- **A task is `blocked`:** inspect its `lastFailure` in `board.json`, the
  messages, and the provider/supervisor logs. A blocked task is not
  automatically retried; fix the underlying issue and queue a follow-up with
  `team.mjs add`. If you must reopen the same task, stop the boss first and
  make a backed-up, deliberate edit to that task in `board.json`; never edit
  the board while the boss is running.
- **A worker is cooling down or unavailable:** check `status` for
  `cooldownUntil`, verify the provider CLI is on `PATH` and authenticated, and
  check provider quota/rate-limit output in its log. The boss retries eligible
  work after the configured cooldown.
- **The boss reports an active PID but is not running:** first verify that
  PID is actually gone. The next start automatically replaces a stale PID
  lock; if a stale lock persists, remove only `.agent-sync/state/boss.pid`
  after verifying no boss process is active.
- **A web surface shows no data or a stopped team:** confirm it and the boss
  use the same `GF_AGENT_STATE`, then refresh. Use the local CLI/TUI to
  distinguish an API/authentication problem from a stopped boss.

When diagnosing, preserve the runtime logs and state until the issue is
understood. Do not delete the whole state directory as a first recovery step:
it contains the board, task results, messages, and diagnostic logs.
