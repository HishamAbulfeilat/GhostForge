# GhostForge — Session Handoff (read this first)

**Any AI, any provider, any new session: this is the one file that tells you
what is going on.** The top half is written by humans/lead agents; the
`LIVE STATUS` block at the bottom is rewritten automatically by the boss every
couple of minutes while the agent team runs.

## ▶ START HERE — state at 2026-10-07 (Asia/Amman) — main includes PRs #13–#20, agent team stopped, Job Hunter preparation/approval repaired

**Location:** the project is being moved to `C:\Users\User\Desktop\GhostForge\`
(main repo `GhostForge\GhostForge-public`, worker worktrees `GhostForge\gf-*`,
Copilot worktree under `GhostForge\copilot-worktrees\`). If the main repo is
still at `Desktop\GhostForge-public`, run
`powershell -ExecutionPolicy Bypass -File C:\Users\User\Desktop\GhostForge\finish-move.ps1`
from a terminal that is NOT inside the repo (Claude Code and the Copilot app
closed) — it moves the repo, repairs git worktrees, reinstalls the watchdog
(allowed on battery) and restarts the boss.

**Team now:** boss = Claude (Opus plans/security/large diffs, Sonnet routine
reviews) with Copilot fallback; workers = 5 Copilot CLI agents (model `auto`).
Claude workers are disabled to save Claude tokens. Interactive Copilot is
co-lead (`prompts/copilot-colead.md`).

**Done (merged / on main):** PR #11 merged to `main` (ccc4c29, all 14 checks
green). Since then on `agent/integration` (PR to main opens every 5 merges):
`/agents` command center + kanban + workflow graph + team/workflow builder
(T-135), Agent World switcher + Forge World (T-133), standalone Dev Monitor
(T-136 → `npm run monitor`, http://127.0.0.1:4177), OpenRouter/OmniRoute model
gateways in GhostForge routing (T-137), marketplace entries for gstack, ruflo,
ponytail, agentic-os, hermes-workspace (T-138, catalog only), docs aligned to
the boss model (T-139), BA analysis `docs/PRODUCT-ANALYSIS.md` (T-140), Claude
Design reference for all screens in `docs/design/agent-worlds/`
(canvas https://claude.ai/artifact/6bSqAGRGFDSHJemEVfdbeC).

**In flight:** T-143 AI Town run as its README (finished in `c18ef40`, pinned as
`wip/T-143-done` — merge it, don't redo); T-141 AI Town front-end with our
agents, T-142 Agent Office front-end (redo), T-144 Agent Office run as its README
(`wip/T-144-agent-office-runtime`); T-132 Agent World branch integration is
blocked — redo from `wip/T-132-agent-world` WITHOUT the stray gitlink
`apps/worlds/agent-office/checkout` (checkouts must stay gitignored).

**Open items for the human:**
1. OmniRoute for Claude Code: installed + `scripts/claude-free.ps1` ready, but
   it needs an OpenRouter key and an OmniRoute API key (dashboard at
   http://127.0.0.1:20128). Its old DB `~/.omniroute/storage.sqlite` can't be
   decrypted (missing STORAGE_ENCRYPTION_KEY) — restore the key or move the DB.
2. `/doctor` findings awaiting a yes/no: disable 10 unused plugins (frontend-
   design, skill-creator, code-simplifier, claude-md-management,
   claude-code-setup, figma, huggingface-skills, feature-dev, commit-commands,
   firecrawl); set auto mode as default; quiet ECC GateGuard's routine fact
   prompts (env `GATEGUARD_BASH_ROUTINE_DISABLED=1`,
   `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force`).
3. Install gstack/ruflo/ponytail into Claude Code itself? (currently catalog only)
4. Restart Claude Code to load the downloaded update (2.1.287).
5. Run `/claude-security` last, after the above.
6. A Copilot prototype of the agents kanban/page is preserved in `git stash`
   ("copilot prototype: agents kanban/page") — apply or drop.

**Lessons (don't repeat):** narrow task areas made workers block — workers may
now edit shared files (package.json, mounting page, tests, notices); orphaned
`next dev` previews lock node_modules — the boss now kills strays; the
watchdog task must be allowed to run on battery.

## Mission

Make GhostForge production-perfect: every feature works end to end and is
reachable from the **web UI, TUI, terminal CLI and JARVIS**; the Electron app
runs on **Windows, macOS and Linux** and the **Android** app builds; security
is hardened; the **Agentic OS dashboard** (`/agents`) shows every agent's
progress. Keep going until every check is green, then keep improving.

## How the work runs (autonomous agent team)

- **Boss** — `scripts/agents/boss.mjs` (Node, detached). The only writer of the
  board and the only one that merges/pushes. Loop: assign tasks → worker
  commits in its own worktree → boss **reviews** (read-only model run) →
  merges into `agent/integration` → health check (rolls back regressions) →
  every 5 merges pushes `agent/integration` and updates **one PR to `main`**
  (never auto-merges). When the board is empty it runs the full health score;
  failing checks become tasks, and at 100/100 it plans the next tasks toward
  the current phase goal (phase 4 = the mission above).
- **Boss model** — `claude` / `opus`, **fallback `copilot`**: when Claude is out
  of quota the boss cools Claude down and reviews/plans with Copilot, then
  retries Claude later. (`.agent-sync/team.json` → `boss`.)
- **Workers** — `claude` (worktree `../gf-claude`) plus five Copilot CLI
  workers: `copilot-tui`, `copilot-desktop`, `copilot-web`,
  `copilot-integration`, `copilot-quality` (`../gf-boss-*`). A rate-limited
  worker cools down 20 min and its task goes back to the queue, so Copilot
  keeps going when Claude hits its limit and vice versa.
- **Skills for workers** — ECC v2.2.2 (pinned, `.agent-sync/ecc.json`) is
  staged per task into `.agent-sync/state/ecc-context.md` for every worker
  (Copilot included). The Claude worker also loads the native Claude plugins
  on this machine (ECC, oh-my-claudecode, superpowers).
- **Watchdog** — `scripts/agents/watchdog.mjs`, run every 5 min by the Windows
  scheduled task **"GhostForge Boss Watchdog"**; restarts the boss if it died.
  An explicit `team.mjs stop` (STOP file) is respected.

## Claude ⇄ Copilot leadership

Claude Code leads (boss reviewer/planner = Claude Opus, hourly lead check-ins). When Claude is rate-limited the boss falls back to Copilot automatically and the **interactive Copilot CLI session is acting lead** — its rules and handover steps are in **`prompts/copilot-colead.md`** (paste it into Copilot). Copilot steers via `team.mjs add/say`, never edits this checkout while the boss runs, and logs what it did in History (signed — copilot). When Claude's quota resets, Claude reads History + boss.log and resumes command.

## Operate it

| Want to… | Command |
|---|---|
| See status | `npm run agents:status` · dashboard `http://localhost:3000/agents` (admin login) |
| Add a task | `node scripts/agents/team.mjs add "title" --area path/` |
| Message the team / boss | `node scripts/agents/team.mjs say boss "…"` |
| Stop (stays stopped) | `npm run agents:stop` |
| Start / resume | `npm run agents:watchdog` (starts the boss if down) |
| Remove the scheduler | `node scripts/agents/watchdog.mjs --uninstall` |
| Logs | `.agent-sync/state/boss.log`, `.agent-sync/state/logs/<agent>.log` |
| Board / messages (raw) | `.agent-sync/state/board.json`, `.agent-sync/state/messages.jsonl` |

## Taking over as a new lead (Claude, Copilot, or any other model)

1. `git status` on `feat/agent-boss` in `GhostForge-public`; read `AGENTS.md`.
2. Read the LIVE STATUS block below and `.agent-sync/state/boss.log` tail.
3. Review what merged since you last looked:
   `git log --oneline feat/agent-boss..agent/integration`.
4. Unblock **blocked** tasks (they failed 3 attempts): fix directly, or re-queue
   with better notes via `team.mjs add`.
5. Don't run a second boss — `boss.pid` is a lock; the watchdog restarts it.

## Branches

- `main` — the only current local and remote branch, per the user's request.
- `agent/integration` and `fix/job-hunter-free-models` were deleted on
  2026-10-07 after verifying both were ancestors of `main` (no unmerged commits).
- The team is stopped. Restarting its workflow can recreate integration and
  worker branches; the historical workflow instructions above describe that setup.

## History

- **2026-10-07** — Verified `main` contains both remaining branch tips, deleted
  the merged remote branches at the user's request, and repaired Job Hunter:
  compact AI-writing retry, clearly labelled original-CV/basic-letter drafts
  when AI is unavailable (manual approval only), automatic review opening,
  accurate application-result notices, and prepared-CV DOCX uploads. Added
  outage, approval-queue, UI, and real-browser upload/submission regressions.
  The full web suite has three pre-existing macOS failures (temporary-path
  canonicalization in agent/bridge tests and Bash 3.2 in the project wizard);
  Job Hunter regressions, root smoke, typecheck and changed-file lint pass.
  React Doctor changed-scope score is 81 with no new findings. — copilot

- **2026-09-30** — PRs #6–#10 merged (marketplace source of truth, Mark-LV +
  OpenJarvis bridge, Job Hunter autopilot, workflows engine). Built the
  boss/worker framework; Copilot ran it: 76 commits (agent-team API +
  `/agents` dashboard, TUI/JARVIS agent-team controls, templates,
  OpenAI-compatible provider, security fixes, Playwright/TUI/Electron tests).
- **2026-10-01 ~01:30** — Claude took over as boss: merged `agent/integration`
  into `feat/agent-boss` (ECC context layer + hardened prompt staging), added
  phase 4 (the mission), Claude boss with Copilot fallback, Claude worker,
  watchdog + scheduled task, and this auto-updated handoff.
- **2026-10-01 01:40–05:40 (overnight)** — 32 merges, health 100/100, PR #11
  updated: CLI/TUI/web parity (workflows, webhooks, collab, users, push,
  maintenance), bridge workflow/jobs APIs + contract tests, Electron headless
  smoke + Electron/Android CI, security sweep, `/agents` login redirect.
  Copilot boss fallback worked while Claude was out of quota.
- **2026-10-01 05:45 check-in** — Bug: Claude's "You've hit your session limit"
  wasn't recognised as a rate limit, so the Claude worker burned 3 instant
  attempts and blocked 13 tasks. Fixed `RATE_LIMIT_RE` (+ test), requeued the
  13, closed 4 superseded blocked tasks, restarted the boss.
- **2026-10-01 morning (11:10)** — ~55 tasks merged overnight; health 100/100.
  PR #11: 100 commits, 160 files, mergeable; CI 8 pass / 4 pending / 1 fail
  (Desktop linux — Electron SUID sandbox on Ubuntu 24.04; fix queued). Local
  verification on `agent/integration`: root `npm test` ✓, web-ui `tsc` ✓,
  web-ui tests 177/177 ✓. Bug fixed: a task pinned to rate-limited `claude`
  kept the board "active" ~4h (03:47–08:04 UTC) so planning stopped and all
  Copilot workers idled — pinned tasks now fall back to `any`.
- **2026-10-01 11:15–16:20** — User asked for a Claude-only team. Claude fixed
  the Linux Electron sandbox CI and 4 high CodeQL alerts, then hit its session
  limit (reset 16:00); Copilot took over meanwhile (T-094/096/097/098: token-
  bearing outbound URL validation, desktop smoke exits, React Doctor) and
  stopped the boss. **All 14 PR #11 checks green → PR #11 merged to `main`
  (`ccc4c29`).** Team restarted Claude-only (boss opus + claude, claude-2,
  claude-3) on top of the new `main`.

## Environment gotchas

- Windows host, no tmux; Git Bash + PowerShell. Node v23 (odd release — some
  native modules have no prebuilds, e.g. the `omc` CLI's better-sqlite3).
- `gh` must be logged in as **HishamAbulfeilat** (a second, old work account
  caused 403 push failures before 2026-10-01).
- Worker worktrees live next to the repo: `C:\Users\User\Desktop\gf-*`.

## LIVE STATUS

<!-- LIVE-STATUS:START -->
_Handoff updated by interactive session at 2026-10-06._

**State:** `main` = `e1840a87` (PR #12, merge 2026-10-05, all checks green).
PR #13 **merged** 2026-10-05; PRs #15–#19 merged. **No open PRs.** The boss /
watchdog agent team is **stopped** — `.agent-sync/state/boss.pid` is stale;
restart with `node scripts/agents/team.mjs start` from GhostForge-public.
`GhostForge-public` sits detached at `origin/main`. Worktree `gf-integration`
is on `agent/integration` (one commit behind origin/main; bump it when resumed).

**This session (2026-10-06), Job Hunter model fix (uncommitted):**
- `web-ui/lib/ai.ts`: new `ModelOverride.preferFree`; when set, `buildModelChain`
  skips the paid model saved in Settings and starts at free providers →
  OmniRoute → Pollinations (keyless) → local.
- `web-ui/lib/job-hunter/index.ts`: `generatorFor(null)` now passes
  `preferFree: true`, so Job Hunter defaults to best free models with **no API
  key** instead of silently using the paid Settings model. Any explicit choice
  (provider/model, custom, ollama) still leads the chain.
- `web-ui/app/jobs/page.tsx`: the AI-model dropdown defaults to
  "Free models (automatic — no API key needed)", lists **all** provider models
  (the `available` filter that hid keyless free models is removed), and has an
  inline "+ Add another model" form posting to `/api/models/custom`; new
  models auto-select.
- Verified: `node --test test/job-hunter.test.js test/job-autopilot.test.js
  test/job-agent.test.js` → 35/35 pass; `tsc --noEmit` clean. Mirrored into
  `gf-integration` (uncommitted there too).

**Then the recurring items below still apply.** Restart command:
`node C:\Users\User\Desktop\GhostForge\GhostForge-public\scripts\agents\team.mjs start`
<!-- LIVE-STATUS:END -->
