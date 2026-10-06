# Multi-Agent Workflow

GhostForge's autonomous team is coordinated by `scripts/agents/boss.mjs`. The
boss assigns tasks, reviews worker commits, and merges approved changes into
`agent/integration`; workers work in their own worktrees and do not claim tasks,
merge branches, or push to `main`. The boss updates the single PR to `main`.

## Roles and models

- **Claude is the boss**: Opus handles planning, security work, and high-risk
  reviews; Sonnet handles routine reviews. If Claude is unavailable, the boss
  falls back to Copilot automatically.
- **Copilot workers** use model `auto`; the provider selects the model for each
  task.
- **Interactive Copilot is co-lead**, not a second boss. Follow
  `prompts/copilot-colead.md` and coordinate work through
  `scripts/agents/team.mjs`.
- **Watchdog** (`scripts/agents/watchdog.mjs`) restarts a crashed boss; the
  Windows scheduled task checks every five minutes. An explicit team stop is
  respected.

## Working with the team

Workers follow the task assigned by the boss, stay within its file area, run
relevant validation, commit with a conventional message that includes the task
id, and report completion or blockers with `scripts/agents/team.mjs`. The boss
performs review and integration. Do not start a second boss or bypass it by
merging worker branches yourself.

Use `npm run agents:status` to inspect the team. Use
`node scripts/agents/team.mjs add "title" --area path/` to queue work and
`node scripts/agents/team.mjs say boss "message"` to contact the boss. Start or
resume the team through `npm run agents:watchdog`; stop it only when needed via
the team stop command.

**`docs/SESSION-HANDOFF.md` is the single handoff** for current team state,
history, and takeover instructions. Read it first when continuing work or
acting as co-lead.

## ECC workflow context

The boss uses pinned ECC configuration in `.agent-sync/ecc.json` to stage
task-specific guidance in `.agent-sync/state/ecc-context.md` for workers,
reviews, and planning. ECC is supplementary to repository instructions.
Configure or verify the cache with `npm run agents:setup`; run
`npm run test:agents` after changing its pinned version. Claude Code users
should not duplicate a native ECC plugin install with a manual Claude install.
