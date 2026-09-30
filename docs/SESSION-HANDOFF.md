# Session Handoff — 2026-09-30

Read this first when picking up GhostForge on another machine or in a new agent
session. It records what the cloud session did, the repo's current state, and
what's next. (Durable architecture decisions live in `knowledge/decisions.md`;
day-to-day agent rules in `AGENTS.md` / `CLAUDE.md`.)

## What shipped this session (all merged to `main`)

**PR #6 — marketplace fixes, OSS + security tools, docs & CI**
- Fixed marketplace install-state divergence: `marketplace/registry.json` is now
  the single source of truth (with a `removed[]` list); the TUI and web API
  compute the installed set identically. No more writing state into `catalog.json`.
- Added ~25 open-source tools to the catalog (AI agents, defensive security
  scanners, dual-use recon tools framed authorized-use-only, DevOps/Quality
  tools) + `AllHackingTools` as a review-first pointer.
- Added the `.claude/skills/security-scan` defensive-audit skill + a TUI
  "Security & DevOps Tools" submenu.
- Added `CLAUDE.md`, ADR-004/005 in `knowledge/decisions.md`, and a
  dependency-free root `npm test` (`scripts/test.js`) wired into CI.
- Resolved the CodeQL findings the changes surfaced (command-injection sinks,
  a TOCTOU race).

**PR #7 — unify the bridge on Mark-LV (latest) + OpenJarvis**
- Refreshed `vendor/mark-liv` to the current `FatihMakes/Mark-LV` release.
  **Mark-L is retired; Mark-LV is the kept engine** (CC BY-NC 4.0, LICENSE intact).
- Folded **OpenJarvis** (`open-jarvis/OpenJarvis`, Apache-2.0) into the one
  bridge as an **opt-in dependency** (not vendored — its repo ships a 73 MB
  Ollama binary + ~2,000 files).
- Catalog: Mark-L → Mark-LV + an OpenJarvis entry. Added `mark-l-bridge/README.md`;
  updated `CLAUDE.md`.
- Fixed a pre-existing flaky MCP stdio test (`web-ui/test/mcp-server.test.js`)
  that waited a fixed timeout — now waits for the response deterministically.

## Current repo state

- `main` is at the PR #7 merge; both PRs green through CI (CodeQL, Security
  regression tests, quality gate, npm audit, SBOM, dependency review).
- The single bridge = `mark-l-bridge/` (FastAPI `:8765`) wrapping
  `vendor/mark-liv` + opt-in OpenJarvis. Wired into web-ui, electron, TUI.
- Root `npm test` = `scripts/test.js` (TUI syntax + marketplace JSON validity).

## Environment gotchas (cloud session)

- **Branch deletion is blocked** by org egress policy (HTTP 403). Stale branches
  `mark-l`, `openjarvis`, `ultimate`, and the merged `ccr-b8ed7f0d-f7pgml` must
  be deleted by a human (`git push origin --delete …` or the GitHub UI).
- The outdated `mark-l`/`openjarvis`/`ultimate` branches (2026-08-03 base, 37
  commits behind, huge stale vendored trees) were deliberately **not** merged.

## Next up (see `.agent-sync/BOARD.md` for the live list)

1. **T-01** Deeper OpenJarvis wiring: `/api/openjarvis/*` endpoints in the bridge.
2. **T-02** Web UI OpenJarvis panel + client.
3. **T-03** Verify catalog install commands cross-platform.
4. **T-04/05** web-ui ESLint config + resolve knip unused-file warnings.
5. **T-06** Root unit tests. **T-07** README refresh.

## How to continue (multi-agent, Claude Code + Copilot CLI)

1. `git pull` on `main`.
2. Read `AGENTS.md`, then `docs/MULTI-AGENT-WORKFLOW.md`.
3. Start Claude Code: `claude` → `/team start`.
4. Start Copilot CLI: `copilot` → paste `prompts/multi-agent-kickoff.md`.
5. Both coordinate through `.agent-sync/BOARD.md` + `MESSAGES.md`.
