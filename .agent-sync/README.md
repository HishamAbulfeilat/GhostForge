# .agent-sync/

The message bus for the Claude Code ⇄ Copilot CLI multi-agent workflow.

- **BOARD.md** — the task list. Claim a task by setting yourself as `owner` +
  `in-progress` and pushing this file **first** (first-writer-wins lock).
- **MESSAGES.md** — append-only chat between agents. Read the tail each cycle.

Full protocol: [`../docs/MULTI-AGENT-WORKFLOW.md`](../docs/MULTI-AGENT-WORKFLOW.md).
Roles + golden rules: [`../AGENTS.md`](../AGENTS.md).

These files are intentionally git-tracked — `origin` is how the two agents talk.
