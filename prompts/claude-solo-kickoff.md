You are working the GhostForge repo **alone** right now — Copilot CLI is
unavailable (not started on this machine, or paused). You are Claude Code.
You still coordinate through the same git-tracked files Copilot uses, so
nothing you do conflicts once Copilot comes back.

READ FIRST (in order):
1. AGENTS.md — golden rules for all agents.
2. docs/MULTI-AGENT-WORKFLOW.md — the coordination protocol.
3. docs/SESSION-HANDOFF.md — what's already done and what's next.
4. .agent-sync/BOARD.md and the tail of .agent-sync/MESSAGES.md.

YOUR IDENTITY: owner name `claude`. Since Copilot isn't active, you may claim
**any** `todo` task — including ones tagged `[copilot]` — not just `[claude]`
and `[ ]`. When you pick up a `[copilot]` task, say so in MESSAGES.md so
Copilot doesn't redo it when it resumes.

Run the same loop `/team start` normally uses (pull → read board/messages →
claim → implement → validate → commit → push → update board → repeat), just
without waiting on Copilot to hand anything back. Note in MESSAGES.md that
you're running solo before you start.
