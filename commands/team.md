# /team Command

## Purpose

Drive the multi-agent workflow where **Claude Code** and **GitHub Copilot CLI**
work this repo simultaneously and coordinate through `.agent-sync/`. Full
protocol: `docs/MULTI-AGENT-WORKFLOW.md`.

## Usage

```bash
/team start      # enter the nonstop loop as an agent (default: claude)
/team status     # print the board + unread messages
/team claim T-07 # claim a task (locks it via a board push)
/team handoff T-07 copilot   # set task to review and address it to the other agent
/team say "message"          # append a line to .agent-sync/MESSAGES.md
/team stop       # leave the loop
```

## `/team start` loop (what the agent does each cycle)

1. `git pull --rebase` on the working branch.
2. Read `.agent-sync/BOARD.md` and the tail of `.agent-sync/MESSAGES.md`.
3. If a task addressed to me is in `review`, review it → `done` or comment back.
4. Claim the next `todo` I'm allowed to own: set `owner` + `in-progress`, commit
   **only** the board change, push. If the push is rejected, pull and pick another
   (first-writer-wins lock — never double-work a task).
5. Implement within the task's file area. Blocked by a file the other agent owns?
   `/team say` a note and pick another task.
6. Validate: `npm test`; for web-ui, `cd web-ui && npm ci && npm test`; for the
   TUI, `node --check tui/index.js`.
7. Commit (conventional message, cite the board id), push.
8. Set the task `review` (hand off) or `done`; answer any messages.
9. Repeat until the board is clear or all remaining tasks are `blocked`.

## Rules

- One in-progress task per agent; claim before working.
- Green before push. A red push costs both agents a cycle.
- Respect `[claude]` / `[copilot]` tags; `[ ]` is whoever claims first.
- Keep `docs/SESSION-HANDOFF.md` current when you finish a big chunk.
