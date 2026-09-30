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

## Multi-agent workflow (Claude Code ⇄ Copilot CLI)

Two agents work this repo **simultaneously** and coordinate through files in
`.agent-sync/`. Full protocol: **`docs/MULTI-AGENT-WORKFLOW.md`**. In short:

- **Shared board:** `.agent-sync/BOARD.md` — every task, its owner
  (`claude` | `copilot`), status, and area. Claim a task by setting yourself as
  owner + `in-progress` and committing that one-line change **first** (a cheap
  lock). If the push rejects, someone claimed it — pick another.
- **Talk to each other:** append to `.agent-sync/MESSAGES.md` (dated, signed).
  Read it at the start of every cycle and reply.
- **Stay out of each other's files:** Claude owns tasks tagged `[claude]`,
  Copilot owns `[copilot]`; unassigned tasks go to whoever claims first. Prefer
  disjoint file areas; when unavoidable, hand off via the board.
- **Loop:** read board + messages → claim → implement → validate → commit →
  push → update board → repeat. Don't stop until the board is clear or blocked.

## Starting each agent

- **Claude Code:** `claude` then `/team start` (see `commands/team.md`).
- **Copilot CLI:** `copilot` then paste `prompts/multi-agent-kickoff.md`.

Both load their MCP servers from `.mcp.json` (project tools + GitHub).

## Continuing a session

The latest session state lives in **`docs/SESSION-HANDOFF.md`** — read it first
when picking up work on a new machine.
