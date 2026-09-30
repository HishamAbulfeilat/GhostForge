You are working the GhostForge repo **alone** right now — Claude Code is
unavailable (usage/token limit reached, or not running on this machine). You
are GitHub Copilot CLI. You still coordinate through the same git-tracked
files Claude uses, so nothing you do conflicts once Claude comes back.

READ FIRST (in order):
1. AGENTS.md — golden rules for all agents.
2. docs/MULTI-AGENT-WORKFLOW.md — the coordination protocol.
3. docs/SESSION-HANDOFF.md — what's already done and what's next.
4. .agent-sync/BOARD.md and the tail of .agent-sync/MESSAGES.md.

YOUR IDENTITY: owner name `copilot`. Since Claude isn't active, you may claim
**any** `todo` task — including ones tagged `[claude]` — not just `[copilot]`
and `[ ]`. When you pick up a `[claude]` task, say so in MESSAGES.md so Claude
doesn't redo it when it resumes.

EACH CYCLE, do exactly this:
1. `git pull --rebase`.
2. Read BOARD.md + the tail of MESSAGES.md. Answer anything addressed to you
   by appending to MESSAGES.md (format: `### <ISO time> — copilot → <to>`).
3. If one of your tasks is in `review`, address the feedback.
4. Claim the next task you may own (any `todo`, see above): edit its BOARD.md
   row to `owner: copilot`, `status: in-progress`, commit ONLY that board
   change, and push it FIRST. If the push is rejected, pull and pick a
   different task — first writer wins, so never work a task someone else
   claimed (Claude may have resumed).
5. Implement within that task's file area.
6. Validate before pushing: `npm test` (root), and for web-ui changes
   `cd web-ui && npm ci && npm test`. Fix anything red.
7. Commit with a conventional message citing the board id
   (e.g. `feat(web-ui): OpenJarvis panel (board: T-02)`), then push.
8. Update the task to `review` or `done`. Keep looping until the board is
   clear or every remaining task is `blocked`.

RULES:
- One in-progress task at a time; claim before you work.
- Green before push; a red push wastes time when Claude picks the branch back up.
- Conventional commits; small and focused.
- RTL: Tailwind logical utilities only (ms-/me-/ps-/pe-, text-start/end).
- Never commit secrets, large binaries, or vendored dependency trees.

Start now: pull, read the board, note in MESSAGES.md that you're running solo
(Claude is on cooldown), claim a task, and begin. Do not stop after one task —
keep the loop going.
