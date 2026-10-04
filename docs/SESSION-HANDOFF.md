# GhostForge — Session Handoff (read this first)

**Any AI, any provider, any new session: this is the one file that tells you
what is going on.** The top half is written by humans/lead agents; the
`LIVE STATUS` block at the bottom is rewritten automatically by the boss every
couple of minutes while the agent team runs.

## ▶ START HERE — state at 2026-10-02 12:00 (Asia/Amman)

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

- `main` — protected; changes arrive only via the agent-team PR.
- `feat/agent-boss` — this checkout; agent framework + everything integrated so far.
- `agent/integration` — the boss's merge branch (worktree `../gf-integration`), PR → `main`.
- `agent/<provider>/…` — per-worker branches, reset onto integration before each task.

## History

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
_Auto-updated by the boss (pid 26576) at 2026-10-04T13:03:03.063Z._

**Phase 1:** Make GhostForge fully working and polished: every feature in web-ui, TUI, Electron, the Python bridge, MCP server, marketplace and Job Hunter works end to end; every JARVIS tool works and is covered by tests; fix bugs, add missing tests, remove dead code, improve UX and accessibility.

**Health:** 100/100 · **merges this run:** 12 · **PR:** https://github.com/HishamAbulfeilat/GhostForge/pull/12 · **boss:** claude

**Board:** todo 1 · in-progress 1 · review 2 · done 12 · blocked 2

**Agents**
- **claude** (claude): waiting-merge on T-012
- **claude-2** (claude): working on T-017
- **claude-3** (claude): waiting-merge on T-013

**In progress / review**
- T-017 [test] Tests: add a pytest suite for voice-pipeline (server contract, wake phrases, missing-engine degradation) — claude-2
- T-012 [bugfix] Push notifications: store subscriptions and actually send via web-push (honest 'not configured' without VAPID keys) — claude
- T-013 [test] Health score blind spots: run mcp, tui, electron-app tests and bridge pytest in scripts/agents/health.mjs — claude-3

**Next up (todo)**
- T-016 [bugfix] A11y: label unlabeled inputs and make clickable divs keyboard-accessible (jarvis, jobs, dashboard, Mark-LV, AI providers, terminal)

**Blocked (needs a human or a fresh approach)**
- T-014 [docs] Bridge: document every mark-l-bridge/server.py endpoint in README and test the table stays complete: …s only ~11172 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- T-018 [docs] Docs: correct stale CHANGELOG claims (bridge endpoint count, partial features): …s only ~11622 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 

**Recently done**
- T-001 [feature] Deeper OpenJarvis bridge: expose /api/openjarvis/* endpoints in mark-l-bridge/server.py with a graceful stub when the package is not installed — claude-2
- T-002 [bugfix] Marketplace: verify every catalog install_command works cross-platform (Windows/macOS/Linux); fix macOS-only ones — claude
- T-003 [chore] Add a web-ui ESLint flat config (eslint.config.mjs) so `eslint .` and CI lint work — claude-3
- T-004 [refactor] Knip: remove or wire up the unused files reported by `cd web-ui && npx knip` — claude
- T-005 [test] JARVIS: add tests proving every tool in web-ui/lib/tool-permissions.ts is registered, permission-gated, and callable — claude-2
- T-006 [test] Tests: add root unit tests under tests/*.test.js and run them from scripts/test.js — claude-2
- T-007 [docs] Docs: refresh README.md feature list and bridge section to match the current code — claude-3
- T-008 [docs] Add root LICENSE file or fix README license links — claude-3
- T-009 [docs] extension/LICENSE is a truncated MIT missing the liability disclaimer — claude-3
- T-010 [bug] api-route-auth test must ignore dot-directories in web-ui/app — claude-3
- T-011 [bugfix] Fix failing health check: web-ui production build — claude
- T-015 [bugfix] Electron: stop advertising Outlook OAuth/ops that throw 'not implemented' — claude-2

**Latest messages**
- 2026-10-04T12:22 boss → claude-3: … this conversation is only ~10995 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- 2026-10-04T12:22 boss → claude-3: … this conversation is only ~11622 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- 2026-10-04T12:23 boss → claude-3: … this conversation is only ~11172 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- 2026-10-04T12:23 boss → claude-3: … this conversation is only ~11172 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- 2026-10-04T12:23 boss → claude-3: … this conversation is only ~11172 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- 2026-10-04T12:24 boss → claude-3: … this conversation is only ~11622 tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context. 
- 2026-10-04T12:29 claude-2 → boss: …sh path, so any Outlook account persisted by an earlier build still refreshes and lists/sends mail. Outlook sign-in being offered is a separate feature (needs an MSAL/auth-URL step) if anyone wants it - I did not add it.
- 2026-10-04T12:53 boss → all: …contacts-integration.ts, electron-app/src/main/email-integration.ts, electron-app/src/main/index.ts, electron-app/src/main/oauth-providers.ts, electron-app/src/preload/index.ts, electron-app/test/oauth-providers.test.mjs
<!-- LIVE-STATUS:END -->
