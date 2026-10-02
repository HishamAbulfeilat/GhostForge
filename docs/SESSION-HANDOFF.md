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
- `gh` must be logged in as **HishamAbulfeilat** (a second account,
  `habulfeilat_ejadasa`, caused 403 push failures before 2026-10-01).
- Worker worktrees live next to the repo: `C:\Users\User\Desktop\gf-*`.

## LIVE STATUS

<!-- LIVE-STATUS:START -->
_Auto-updated by the boss (pid 17148) at 2026-10-02T09:01:50.718Z._

**Phase 4:** Production-perfect on every surface: every GhostForge feature works end to end and is reachable from the web UI, the TUI, the terminal CLI and JARVIS (feature parity — record gaps in docs/FEATURE-MATRIX.md and close them); the Electron desktop app builds and runs on Windows, macOS and Linux and the Android (Capacitor) app builds, with CI proving it; security hardened (fix every real finding from CodeQL, npm audit, secret/dependency scanners and security reviews); the Agentic OS dashboard (/agents) shows each agent's progress, the todo/in-progress/review/done/blocked board, messages, health and history; accessible, RTL-safe, polished UI. Keep going until every check is green, then keep improving.

**Health:** ?/100 · **merges this run:** 0 · **PR:** none yet · **boss:** claude (fallback copilot)

**Board:** todo 3 · in-progress 1 · review 0 · done 129 · blocked 17

**Agents**
- **copilot-tui** (copilot): working on T-141
- **copilot-desktop** (copilot): idle
- **copilot-web** (copilot): idle
- **copilot-integration** (copilot): idle
- **copilot-quality** (copilot): idle

**In progress / review**
- T-141 [test] Agent Town = the real a16z-infra/ai-town front-end running inside GhostForge: vendor its client rendering code VERBATIM at a pinned commit (src/components Game/PixiGame/PixiStaticMap/PixiViewport/Character/Player/PositionIndicator, spritesheet + world map data, needed utils) into web-ui/vendor/ai-town/ with its MIT LICENSE and a NOTICE (commit sha). Keep upstream visuals and interaction. Replace only the Convex/Clerk data layer with an adapter that maps the GhostForge agent snapshot (agents -> players/characters, tasks -> descriptions/speech, boss -> its own character) - no fake autonomous movement. Upstream art: include each asset only if its own license permits redistribution (document every asset + license in THIRD_PARTY_NOTICES.md); otherwise substitute a CC0 asset and note it. Pixi deps pinned to upstream majors, dynamic import with ssr:false on /agent-world?world=town. Tests + tsc + build. — copilot-tui

**Next up (todo)**
- T-142 [test] Agent Office = the real harishkotra/agent-office front-end running inside GhostForge: vendor its client scene code VERBATIM at a pinned commit (office scene, agent sprites/containers, name tags, thought bubbles, emotes, focus ring, camera follow; plus the vendored pixel-agents renderer if used) into web-ui/vendor/agent-office/ with BOTH MIT licenses (Harish Kotra; Pablo De Lucca for pixel-agents) and a NOTICE (commit sha). Keep upstream visuals and interaction. Replace only the Colyseus/Ollama/server state with an adapter from the GhostForge agent snapshot (agents -> office agents at desks, current task -> thought bubble, boss -> boss office). Upstream assets only where their license permits redistribution (document in THIRD_PARTY_NOTICES.md), else CC0 substitutes. Client-only dynamic import on /agent-world?world=office. Tests + tsc + build.
- T-143 [test] Run a16z-infra/ai-town exactly as its README sets it up, as a managed GhostForge world app: clone at a pinned commit into apps/worlds/ai-town (gitignored checkout + a setup script, not vendored into git), install deps, run its local Convex backend + frontend per README with LLM via local Ollama or GhostForge's model gateway env (no keys committed), bound to 127.0.0.1. Add 'ghostforge worlds start|stop|status ai-town' (CLI + TUI menu) and Start/Stop/Open controls on /agent-world that embed the running app in an iframe. Document prerequisites and a smoke test that the app answers on its port.
- T-144 [test] Run harishkotra/agent-office exactly as its README sets it up, as a managed GhostForge world app: clone at a pinned commit into apps/worlds/agent-office (gitignored checkout + a setup script), install deps, run its Colyseus server + client per README with LLM via local Ollama or GhostForge's model gateway env (no keys committed), bound to 127.0.0.1. Reuse 'ghostforge worlds start|stop|status agent-office' (CLI + TUI) and the /agent-world Start/Stop/Open iframe controls. Document prerequisites and a smoke test that the app answers on its port.

**Blocked (needs a human or a fresh approach)**
- T-104 [bugfix] Fix failing health check: Root smoke test (TUI parse, marketplace JSON): Health regressed 85 → 82. Broken checks: 
- T-108 [feature] Integrate the completed Agent World operations center from commit 762b11a on branch habulfeilat-ejadasa-ghostforge-agent-visualization after T-107 lands: cherry-pick only 762b11a onto current agent/integration (T-106 is already present, so do not cherry-pick ecb0eb2); connect its typed optional sources/sessions model to the federated snapshot contract, preserve standalone /agent-world and integrated /agents, keep every value snapshot-derived, resolve docs/tests carefully, and rerun focused web tests, full web tests, typecheck, lint, build, React Doctor changed scope, root tests, health, plus desktop/mobile no-overflow validation.: …eported role are labeled `worker` rather than unknown/not reported. - The `/agents` redesign drops the snapshot-reported workflow leader and specialists summary, regressing existing workflow metadata.
- T-109 [bugfix] Integrate and independently review JARVIS explicit-quit fix from commit 746d3b5 on branch habulfeilat-ejadasa-fix-jarvis-quit: cherry-pick only 746d3b5 onto current agent/integration; verify the explicit-quit guard prevents minimize-to-tray close interception during tray Quit, daemon Quit, renderer window:close, and app.quit; ensure before-quit/will-quit cleanup remains idempotent and child services/timers stop exactly once; preserve normal close-to-tray behavior and Windows/macOS/Linux semantics. Run electron-app tests, focused lifecycle regression tests, applicable typecheck/lint/headless smoke with bounded timeouts, root npm test, and health validation.: …own when minimizeToTray is enabled. - electron-app/src/main/index.ts: headless smoke emits shutdown-clean after cleanup failures or timeout, allowing the smoke test to pass despite incomplete cleanup.
- T-120 [test] Upgrade /agent-world from list view into a spatial agent-office visualization. The merged T-112 page renders honest data but only as flat card lists, which does not satisfy the product requirement for a TaskVille / AI Town / Agent Office style operations center. Requirements: (1) Render a spatial 'virtual forge' map where every real agent session from the /api/agents snapshot (local workers, boss/leader, and federated connector sessions) is a placed, labelled figure in a room/zone grouped by source and role, with status and current task visible on hover/focus. (2) Render a real workflow dependency graph (nodes + edges) derived ONLY from snapshot workflow data - never hard-code nodes, counts, or 'live' badges. (3) Per-agent progress derived from real task state; show explicit stale/unknown states instead of inventing progress. (4) Keep a fully accessible non-spatial fallback (the existing card/table lists) toggled by a control and used automatically for prefers-reduced-motion, plus keyboard navigation and aria labels for every figure. (5) Credit the inspirations with links in the UI and in a new docs/AGENT-WORLD.md: TaskVille https://taskville.co/ , a16z AI Town https://github.com/a16z-infra/ai-town , Agent Office https://github.com/harishkotra/agent-office . (6) RTL-safe Tailwind logical utilities only, no horizontal overflow at 1440x1000 and 390x844. (7) Tests in web-ui/test covering the spatial model derivation and the empty/stale states; full web suite, tsc --noEmit, and root npm test must pass. Reference implementation available for ideas at commit 762b11a on branch habulfeilat-ejadasa-ghostforge-agent-visualization (AgentWorld.tsx / AgentWorldShell.tsx) - reuse its ideas but re-derive against the current merged connector snapshot contract.: …ates every local worker in the map and every local task in the workflow graph; normalize or exclude the duplicate local connector records and add a regression test using the actual API response shape.
- T-123 [feature] Create accessible Agent Office map: …the change: - Incomplete: AgentOfficeMap is not imported or rendered by web-ui/app/agent-world/page.tsx, so users cannot access the new map. Wire it into the page and add a page-level regression test.
- T-125 [feature] Integrate Agent World views: …sk scope permits edits only to page.tsx and agent-world-view.test.js and says to integrate after both components are available. Please integrate/provide the component, then unblock for implementation.
- T-126 [docs] Document Agent World and its inspirations: …/messages state directory, and distinguish the local connector heartbeat path: projectLocalConnector reads status.json from the default state directory even when the team snapshot uses GF_AGENT_STATE.
- T-132 [test] Integrate Copilot's verified Agent World branch: git fetch origin && git merge origin/habulfeilat-ejadasa-agent-world-monitor (e4cc8d7, 230/230 web tests). Resolve the conflicts in web-ui/app/agent-world/agent-world-model.ts and page.tsx by KEEPING BOTH lines of work: the branch's public-sanitized vs maintainer worlds, modular Forge/Office/Town scenes, abortable polling and THIRD_PARTY_NOTICES, plus integration's Agent Office map (T-127) and workflow graph (T-128). No third-party art assets. Run root npm test, web-ui tsc + npm test.: …ndling, and contradicts the docs' claim that upstream Agent Office is not vendored. Fix: git rm --cached apps/worlds/agent-office/checkout, commit, then re-run root npm test and web-ui tsc + npm test.
- T-145 [feature] Add model and bridge readiness to setup: Boss review rejected the change: - Remove the unrelated apps/worlds/agent-office/checkout git submodule addition; it is outside the assigned task area.
- T-146 [feature] Make the snippets page discoverable: Boss review rejected the change: - Unrelated apps/worlds/ai-town submodule addition is outside the T-146 area.
- T-147 [test] Check web feature-matrix evidence in root tests: …t would fail until docs/FEATURE-MATRIX.md is corrected, also outside the assigned area. Please clear the root path conflict and authorize the narrowly scoped test location/docs correction or reassign.
- T-150 [feature] Add live Agent World snapshot refresh: …tch handler replaces the loaded state with an error state, hiding the last successful snapshot during a transient polling failure. Keep the existing snapshot visible while surfacing the refresh error.
- T-153 [bugfix] Keep the last Agent World snapshot visible on refresh errors: Boss review rejected the change: - Remove or separately justify the unrelated apps/worlds/ai-town/upstream submodule addition.
- T-154 [test] Validate feature-matrix evidence in the root smoke suite: …here is no web packaging surface. Keep Web marked ❌ unless actual web packaging support exists. - The diff adds apps/worlds/agent-office/checkout, an unrelated submodule gitlink outside the task area.
- T-155 [security] Close the AppleScript shell-execution bypass: Boss review rejected the change: - Remove the unrelated apps/worlds/ai-town/upstream submodule addition; it is outside the T-155 review scope.
- T-156 [bugfix] Refresh Agent World without losing the last snapshot: Boss review rejected the change: - Remove the unrelated apps/worlds/ai-town/upstream submodule addition; it is outside the assigned area.
- T-157 [test] Add root-smoke coverage for feature-matrix evidence: Boss review rejected the change: - The diff adds the unrelated apps/worlds/agent-office/checkout gitlink, outside the assigned task area.

**Recently done**
- T-133 [bugfix] Agent World shell: world switcher on /agent-world (Forge World | Agent Town | Agent Office | Maintainer | Team) and the original Forge World scene per docs/design/agent-worlds/ForgeWorld.dc.html, rendering only real snapshot data, keyboard + reduced-motion accessible. Agent Town and Agent Office are separate tasks (vendored upstream code). — copilot-tui
- T-134 [test] Agents dashboard defects: wire --leader/leader through team.mjs add/dispatch, the /api/agents POST and the boss so it is never dropped or null; default assignee 'any' (never 'boss'); exclude disabled agents from pickers/defaults; live polling with abort; show the boss itself; confirmation dialog before stop. Tests for each. — copilot-tui
- T-135 [test] Team + workflow builder on /agents: compose a team (leader/boss + chosen workers, provider and model per agent, or a template from .agent-sync/templates), define a workflow as ordered/dependent tasks with acceptance criteria, save it as a reusable template, launch it, and view it as a live dependency graph with per-node status. Admin-only, validated input, tests. — copilot-tui
- T-136 [security] Standalone Dev Monitor outside GhostForge: tools/dev-monitor/ — a tiny zero-dependency Node server bound to 127.0.0.1 only + one static page that shows every agent/session working on THIS repo: the boss, its workers and board (.agent-sync/state), plus read-only metadata (name, cwd, branch, last activity, last message summary) of local Copilot CLI sessions (~/.copilot/session-state) and Claude Code sessions for this project. Show progress, tasks, messages and a workflow graph; auto-refresh. Never expose secrets or full transcripts; no network beyond loopback. npm script 'monitor'. Tests. — copilot-quality
- T-137 [test] Model gateway option: add OpenRouter and OmniRoute (diegosouzapw/OmniRoute, MIT) as optional OpenAI-compatible providers in GhostForge's model routing with an ordered policy: subscription/paid models first, then free models (e.g. DeepSeek via OpenRouter free tier) when quota/rate limits hit. Keys via env/settings only, never logged; loopback default for OmniRoute; docs + tests. Do NOT reconfigure Claude Code or Copilot themselves. — copilot-web
- T-138 [review] Marketplace: add review-first catalog entries (MIT, with upstream links) for garrytan/gstack (Claude Code skills), ruvnet/ruflo (agent harness), DietrichGebert/ponytail (minimal-code agent discipline), modimihir07/agentic-os and outsourc-e/hermes-workspace. Each needs category, tags and description; installs must be explicit and user-initiated (no auto-install, no curl|sh). Run npm test. — copilot-integration
- T-139 [security] Docs alignment: AGENTS.md 'Multi-agent workflow' and docs/MULTI-AGENT-WORKFLOW.md still describe the old BOARD.md/MESSAGES.md claim-and-push protocol. Rewrite them (and the agent sections of CLAUDE.md and .github/copilot-instructions.md) for the current boss model: boss.mjs assigns/reviews/merges, Claude = boss (Opus plans/security, Sonnet routine reviews) with Copilot fallback, Copilot workers use model auto, interactive Copilot = co-lead per prompts/copilot-colead.md, watchdog keeps it 24/7, docs/SESSION-HANDOFF.md is the single handoff. Keep them short and consistent; no contradictory instructions. — copilot-integration
- T-140 [docs] BA analysis: write docs/PRODUCT-ANALYSIS.md as a business analyst — target users and jobs-to-be-done, value proposition, full feature inventory cross-checked against docs/FEATURE-MATRIX.md and the code, UX/UI pain points per surface (web, TUI, CLI, JARVIS, Electron, Android), cross-platform gaps, competitor comparison (Cursor, Copilot Workspace, Devin-style agents, agentic-os, hermes-workspace) and a prioritised improvement backlog (impact x effort, each item with acceptance criteria). End with the top 10 backlog items as concrete, independently verifiable tasks. — copilot-quality
- T-148 [docs] Document a repeatable Android companion smoke flow — copilot-integration
- T-149 [docs] Update the MCP health-path security finding — copilot-quality
- T-151 [refactor] Remove remaining RTL utility exceptions — copilot-quality
- T-152 [docs] Align Agent Worlds design notes with shipped state — copilot-quality

**Latest messages**
- 2026-10-01T23:06 boss → copilot-desktop: T-156 BLOCKED after 3 attempts: Boss review rejected the change: - Remove the unrelated apps/worlds/ai-town/upstream submodule addition; it is outside the assigned area.
- 2026-10-01T23:23 boss → all: Boss online. Template: null. Agents: copilot-tui, copilot-desktop, copilot-web, copilot-integration, copilot-quality. Phase 4.
- 2026-10-01T23:38 boss → copilot-tui: …View polls every 20 seconds (20_000); make them match. - Minor: the public view always sends an empty sessions list, so its Agent Office map is always empty; the docs should say only the maintainer view has session data.
- 2026-10-01T23:45 boss → copilot-tui: …S.md rule against vendored trees, contradicts THIRD_PARTY_NOTICES ('does not redistribute their source code'), and breaks recursive submodule checkouts. Remove it with `git rm --cached apps/worlds/agent-office/checkout`.
- 2026-10-01T23:56 boss → copilot-tui: …ones/CI submodule handling, and contradicts the docs' claim that upstream Agent Office is not vendored. Fix: git rm --cached apps/worlds/agent-office/checkout, commit, then re-run root npm test and web-ui tsc + npm test.
- 2026-10-02T00:06 boss → copilot-tui: …o .gitmodules entry, far outside T-135's area and the same defect that got T-132 rejected; run `git rm --cached apps/worlds/agent-office/checkout`, gitignore it if it's a local checkout, and re-run root and web-ui tests.
- 2026-10-02T00:18 boss → all: …ates/route.ts, web-ui/app/agents/builder/workflow-server.ts, web-ui/app/agents/page.tsx, web-ui/lib/agent-workflows.ts, web-ui/package.json, web-ui/test/agent-workflow-server.test.js, web-ui/test/agents-dashboard.test.js
- 2026-10-02T09:01 boss → all: Boss online. Template: null. Agents: copilot-tui, copilot-desktop, copilot-web, copilot-integration, copilot-quality. Phase 4.
<!-- LIVE-STATUS:END -->
