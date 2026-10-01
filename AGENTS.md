# AGENTS.md — GhostForge

Canonical guide for **every** coding agent on this repo — Claude Code, GitHub
Copilot CLI, opencode, Cursor. (Claude Code also reads `CLAUDE.md`; Copilot
also reads `.github/copilot-instructions.md`. This file is the shared contract
they all agree on.)

## Project

GhostForge JARVIS — desktop + web AI development studio (voice assistant,
Copilot supercharger, agents, a plugin/tool **marketplace**, and a unified
Python **bridge**). Surfaces share one repo:

- `web-ui/` — Next.js 15 + Tailwind (App Router). React app lives here, not at root.
- `electron-app/` — Electron desktop app.
- `tui/index.js` — terminal UI (single large file; `node --check` after edits).
- `mark-l-bridge/` — the single FastAPI bridge (`:8765`) unifying **Mark-LV**
  (`vendor/mark-liv`, CC BY-NC 4.0) + opt-in **OpenJarvis** (Apache-2.0).
- `marketplace/` — catalog + registry (see CLAUDE.md for the source-of-truth rule).
- `mcp/` — the project's own MCP server (`node mcp/index.js`).
- `agents/`, `commands/`, `.claude/skills/`, `instructions/`, `prompts/`, `knowledge/`.

## Golden rules (all agents)

1. **Validate before you push.** Run `npm test` (root smoke test) and, for
   web-ui changes, `cd web-ui && npm ci && npm test`. `node --check tui/index.js`
   after TUI edits.
2. **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`…). Small, focused.
3. **RTL/i18n:** Tailwind logical utilities only (`ms-`/`me-`/`ps-`/`pe-`,
   `text-start/end`) — physical classes break the Arabic layout + CI.
4. **Marketplace:** `marketplace/registry.json` is the source of truth for
   install state; never write install state into `catalog.json`.
5. **Security tooling policy:** defensive/dual-use tools get real installers
   (authorized-use framing); offensive suites are review-first pointers. See
   CLAUDE.md.
6. **Never** commit secrets, large binaries, or vendored dependency trees.

## Multi-agent workflow

The autonomous team is coordinated by `scripts/agents/boss.mjs`. The boss
assigns tasks, reviews worker commits, and merges approved work into
`agent/integration`; workers do not claim tasks or merge/push to `main`.
Workers use their provider's model auto-selection. The boss uses Claude Opus
for planning, security work, and high-risk reviews, Claude Sonnet for routine
reviews, and falls back to Copilot when Claude is unavailable.

## Agent team operation

The watchdog keeps the boss running (scheduled every five minutes on Windows);
`npm run agents:status` shows team status.
Interactive Copilot is co-lead: follow `prompts/copilot-colead.md` and
coordinate through `scripts/agents/team.mjs`. See
**`docs/MULTI-AGENT-WORKFLOW.md`** for details.

## Continuing a session

**`docs/SESSION-HANDOFF.md` is the single handoff** — read it first when
continuing work or taking over as co-lead.
