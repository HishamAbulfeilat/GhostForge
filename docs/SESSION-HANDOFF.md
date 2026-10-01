# GhostForge — Session Handoff (read this first)

**Any AI, any provider, any new session: this is the one file that tells you
what is going on.** The top half is written by humans/lead agents; the
`LIVE STATUS` block at the bottom is rewritten automatically by the boss every
couple of minutes while the agent team runs.

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

## Environment gotchas

- Windows host, no tmux; Git Bash + PowerShell. Node v23 (odd release — some
  native modules have no prebuilds, e.g. the `omc` CLI's better-sqlite3).
- `gh` must be logged in as **HishamAbulfeilat** (a second account,
  `habulfeilat_ejadasa`, caused 403 push failures before 2026-10-01).
- Worker worktrees live next to the repo: `C:\Users\User\Desktop\gf-*`.

## LIVE STATUS

<!-- LIVE-STATUS:START -->
_Auto-updated by the boss (pid 43972) at 2026-10-01T02:42:54.761Z._

**Phase 4:** Production-perfect on every surface: every GhostForge feature works end to end and is reachable from the web UI, the TUI, the terminal CLI and JARVIS (feature parity — record gaps in docs/FEATURE-MATRIX.md and close them); the Electron desktop app builds and runs on Windows, macOS and Linux and the Android (Capacitor) app builds, with CI proving it; security hardened (fix every real finding from CodeQL, npm audit, secret/dependency scanners and security reviews); the Agentic OS dashboard (/agents) shows each agent's progress, the todo/in-progress/review/done/blocked board, messages, health and history; accessible, RTL-safe, polished UI. Keep going until every check is green, then keep improving.

**Health:** ?/100 · **merges this run:** 0 · **PR:** none yet · **boss:** claude (fallback copilot)

**Board:** todo 7 · in-progress 6 · review 0 · done 60 · blocked 0

**Agents**
- **claude** (claude): working on T-039
- **copilot-tui** (copilot): working on T-042
- **copilot-desktop** (copilot): working on T-043
- **copilot-web** (copilot): working on T-041
- **copilot-integration** (copilot): working on T-045
- **copilot-quality** (copilot): working on T-077

**In progress / review**
- T-039 [security] Blocking symlink escapes in MCP health checks — claude
- T-041 [feature] Agentic OS dashboard: add a kanban board (todo/in-progress/review/done/blocked) with per-agent progress, current task, model/provider, elapsed time and recent history to /agents, backed by the existing /api/agents snapshot — copilot-web
- T-042 [bugfix] Electron cross-platform: make electron-app build and pass a headless launch smoke test on Windows, macOS and Linux, and add a CI matrix job that proves it — copilot-tui
- T-043 [bugfix] Android: make the Capacitor Android app build in CI (debug APK artifact) and document how to run it — copilot-desktop
- T-045 [feature] Terminal CLI parity: a `ghostforge` bin exposing marketplace, agent-team, workflow and job-hunter commands (reusing existing libs), with --help and tests — copilot-integration
- T-077 [docs] Refresh feature parity matrix after completed workflow surfaces — copilot-quality

**Next up (todo)**
- T-048 [feature] Expose agent-team controls in the terminal CLI
- T-049 [feature] Add an Awesome LLM Apps CLI command
- T-050 [feature] Expose YouTube and game updater controls in the web UI
- T-055 [feature] Add TUI and CLI surfaces for workflow runs, n8n, and webhook triggers
- T-059 [feature] Add terminal collaboration CLI command
- T-064 [feature] Adding collaboration controls to the terminal CLI
- T-074 [feature] Expose bounded workflow runs in the web UI

**Blocked (needs a human or a fresh approach)**

**Recently done**
- T-067 [feature] Exposing user administration in the TUI — copilot-web
- T-068 [docs] Refresh phase-four feature matrix after completed surface work — copilot-quality
- T-069 [feature] Add visible push-notification management page — copilot-web
- T-070 [feature] Implement authenticated workflow execution in the bridge — copilot-integration
- T-071 [test] Add cross-platform Electron and Android CI validation — copilot-desktop
- T-072 [bugfix] Make the Android build script CI-safe and host-portable — copilot-desktop
- T-073 [feature] Expose JARVIS deployment/Azure operations through a bounded bridge contract — copilot-integration
- T-075 [feature] Add workflow execution to the terminal CLI — copilot-integration
- T-076 [feature] Add workflow controls to the TUI — copilot-tui
- T-078 [feature] Add TUI webhook management controls — copilot-tui
- T-079 [feature] Replace bridge job search and autopilot stubs — copilot-integration
- T-080 [test] Add Electron headless launch smoke validation — copilot-desktop

**Latest messages**
- 2026-10-01T02:19 boss → claude: T-077 bounced: Finished without committing anything. You've hit your session limit · resets 5:40am (Asia/Amman) 
- 2026-10-01T02:20 boss → claude: T-077 bounced: Finished without committing anything. You've hit your session limit · resets 5:40am (Asia/Amman) 
- 2026-10-01T02:20 boss → claude: T-077 BLOCKED after 3 attempts: Finished without committing anything. You've hit your session limit · resets 5:40am (Asia/Amman) 
- 2026-10-01T02:23 boss → all: …t; it validates malformed responses and bridge failures with sanitized terminal output. Added focused TUI coverage for the menu path, bridge contract, and config validation. Files: tui/index.js, tui/test/webhooks.test.js
- 2026-10-01T02:23 boss → all: PR to main updated with 54 task(s): https://github.com/HishamAbulfeilat/GhostForge/pull/11
- 2026-10-01T02:25 boss → all: … autopilot review-only with no external submission. Added contract tests covering successful search/autopilot flow and the expected CV-required failure path. Files: mark-l-bridge/server.py, mark-l-bridge/test_contract.py
- 2026-10-01T02:31 boss → all: …oid-validation.yml, electron-app/src/main/auto-start.ts, electron-app/src/main/clipboard-intel.ts, electron-app/src/main/headless-smoke.ts, electron-app/src/main/index.ts, electron-app/test/headless-launch-smoke.test.mjs
- 2026-10-01T02:42 boss → all: Boss online. Template: null. Agents: claude, copilot-tui, copilot-desktop, copilot-web, copilot-integration, copilot-quality. Phase 4.
<!-- LIVE-STATUS:END -->
