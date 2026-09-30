# Multi-Agent Workflow — Claude Code ⇄ Copilot CLI

How two autonomous coding agents work this repo **at the same time**, coordinate
through git-tracked files, and drive the project to done without stepping on each
other. No live socket is needed — the repo itself is the message bus.

```
        ┌─────────────┐        .agent-sync/BOARD.md         ┌──────────────┐
        │ Claude Code │◀──────  (tasks + owners + status) ─▶│ Copilot CLI  │
        │  agent A    │         .agent-sync/MESSAGES.md      │   agent B    │
        └──────┬──────┘         (append-only chat log)       └──────┬───────┘
               │                                                     │
               └───────────────  git push / pull  ───────────────────┘
                                (origin is the bus)
```

## Roles

- **Claude Code** — planner + implementer. Good at cross-file refactors,
  reasoning, tests, docs. Owns tasks tagged `[claude]`.
- **Copilot CLI** — implementer + reviewer. Owns tasks tagged `[copilot]`.
- Either may **review** the other's `review`-status tasks.
- Unassigned tasks (`[ ]`) go to whichever agent claims first.

## The coordination files (`.agent-sync/`)

| File | Purpose | Who writes |
|------|---------|-----------|
| `BOARD.md` | The task list: id, title, area, owner, status, notes | both |
| `MESSAGES.md` | Append-only chat between agents (dated, signed) | both |
| `README.md` | This protocol in brief | humans |

### BOARD.md task states

`todo → in-progress → review → done` (or `blocked`). One task per row.

### Claiming a task (the "lock")

1. `git pull --rebase origin <shared-branch>`.
2. Read `BOARD.md` + `MESSAGES.md`.
3. Pick an unclaimed `todo` (respect `[claude]`/`[copilot]` tags).
4. Edit its row → set `owner: you`, `status: in-progress`.
5. Commit **just that BOARD.md change** and push it **before** doing the work.
6. If the push is rejected (someone else pushed first), `pull --rebase` and, if
   the task is now taken, pick another. This makes the board a first-writer-wins
   lock — no task is done twice.

### Doing the work

- Keep to the task's file area. Need a file the other agent is editing? Leave a
  note in `MESSAGES.md` and pick a different task meanwhile.
- Validate: `npm test` (root), plus `cd web-ui && npm ci && npm test` for web-ui,
  `node --check tui/index.js` for the TUI.
- Commit with a conventional message referencing the task id (e.g.
  `feat(marketplace): … (board: T-07)`).
- Update the task → `status: review` (hand to the other agent) or `done`.
- Push. Then start the next cycle.

### Talking

Append to `MESSAGES.md`:

```
### 2026-09-30T15:40Z — claude → copilot
T-07 pushed on agent/claude/marketplace. Needs your eyes on the web-ui route.
Blocking on T-11 (you own tui/index.js) — ping when free.
```

Read the tail of `MESSAGES.md` every cycle and answer anything addressed to you.

## Branch strategy

- Shared coordination branch for the board: **`agent-sync`** (both push the
  board + messages here; tiny, rarely conflicts).
- Code goes on per-agent branches to avoid clobbering:
  `agent/claude/<topic>` and `agent/copilot/<topic>`.
- When a topic is green, open a PR to `main`, get the other agent's review
  (board `review` → `done`), merge.
- Never force-push a branch the other agent has checked out.

> Prefer `git worktree` so each agent has its own working directory:
> `git worktree add ../gf-copilot agent/copilot/main`.

## The nonstop loop

Each agent runs this until the board is clear or every remaining task is
`blocked`:

```
loop:
  git pull --rebase
  read BOARD.md + MESSAGES.md
  if a task addressed to me is in `review`: review it → done or comment
  claim next todo (lock via board push)
  implement → validate → commit → push
  set task review/done, answer messages
  repeat
```

- **Claude Code:** drive the loop with `/team start` or the `/loop` skill.
- **Copilot CLI:** a shell wrapper, e.g.
  `while :; do copilot -p "$(cat prompts/multi-agent-kickoff.md)"; sleep 5; done`.

## Guardrails

- One agent, one task in-progress at a time (claim before work).
- Green before push; a red push costs both agents a cycle.
- If both must touch the same file, the board owner of that area wins; the other
  hands off via `MESSAGES.md`.
- Humans can drop tasks or notes into the board/messages at any time.
