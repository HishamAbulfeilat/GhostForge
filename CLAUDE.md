# CLAUDE.md — GhostForge

Guidance for Claude / AI agents working in this repo. Keep it short and current.

## What this is

GhostForge JARVIS — a desktop + web AI development studio (voice assistant,
Copilot supercharger, agents, and a plugin/tool **marketplace**). Multiple
surfaces share one repo:

- `web-ui/` — Next.js 15 + Tailwind (App Router). The React app lives here, **not** at repo root.
- `electron-app/` — Electron desktop app.
- `tui/index.js` — terminal UI (single large file; `node --check` it after edits).
- `mark-l-bridge/` — the single Python FastAPI bridge (`:8765`) behind JARVIS.
  Unifies **Mark-LV** (vendored at `vendor/mark-liv`, [FatihMakes/Mark-LV](https://github.com/FatihMakes/Mark-LV), CC BY-NC 4.0) and opt-in **OpenJarvis** (Apache-2.0). See `mark-l-bridge/README.md`. Named for legacy wiring; "Mark-L" is retired in favour of Mark-LV.
- `marketplace/` — catalog + registry for installable agents/skills/tools.
- `agents/`, `commands/`, `.claude/skills/`, `instructions/`, `knowledge/`, `prompts/` — content.

## Agent team

`scripts/agents/boss.mjs` assigns tasks, reviews worker commits, and merges
approved work into `agent/integration`; workers do not claim or merge tasks.
The boss uses Claude Opus for planning, security, and high-risk reviews, Sonnet
for routine reviews, and Copilot as fallback. Copilot workers use model `auto`.
The watchdog keeps the boss running (Windows checks every five minutes).
Interactive Copilot is co-lead; follow `prompts/copilot-colead.md`.
**`docs/SESSION-HANDOFF.md` is the single handoff** for current state and
continuation.

## Marketplace (read before touching it)

Two files, **`marketplace/registry.json` is the single source of truth for install state**:

- `catalog.json` — every available item (`id`, `name`, `type`, `category`,
  `description`, optional `source`/`url`/`file`/`install_command`/`tags`).
  An item may ship pre-installed with `"installed": true`.
- `registry.json` — `installed[]` (user-installed ids) and `removed[]`
  (explicit uninstalls of catalog-seeded items, so they aren't re-added).

Effective installed set = `registry.installed ∪ {catalog items with installed:true}` − `registry.removed`.
Both the web API (`web-ui/app/api/marketplace/route.ts`) and the TUI
(`screenMarketplace` in `tui/index.js`) compute it this way — keep them in
sync if you change the rule. Do **not** go back to writing install state into
`catalog.json`.

**Adding an item:** append to `catalog.json items[]` (unique `id`), give it a
category that has an icon in `web-ui/app/marketplace/page.tsx` (`CATEGORY_ICONS`),
and — if it's a tool — a real `install_command`. Run `npm test` after.

## Security tooling policy

The marketplace lists security/pentest tools. Rules:

- **Defensive scanners** (Gitleaks, OSV-Scanner, Semgrep, Trivy, Syft, Grype,
  TruffleHog) and **standard dual-use recon/scanning tools** (Nmap, ZAP,
  sqlmap, Nikto, ffuf, Amass) get real install commands, framed **authorized
  testing / your own systems only**.
- **Offensive suites** that bundle DDoS or phishing/credential-harvesting
  (e.g. HackingTool, AllHackingTools, Strix) are listed as **review-first
  pointers** to upstream — never a one-click "install everything" wiring.
- The `.claude/skills/security-scan` skill is defensive: it scans, reports,
  and suggests fixes; it does not exploit or attack.

## Testing

- Root: `npm test` → `scripts/test.js`, dependency-free (TUI syntax +
  marketplace JSON validity + unique ids + required fields). Runs in CI
  (`.github/workflows/pr-check.yml`).
- Web UI: `cd web-ui && npm ci && npm test` (needs deps; includes auth/security
  regressions).

## Conventions

- RTL/i18n: use Tailwind **logical** utilities (`ms-`/`me-`/`ps-`/`pe-`,
  `text-start/end`) — physical `ml-/mr-/text-left` breaks the Arabic layout and
  the RTL CI check.
- Commits: conventional (`feat:`, `fix:`, `docs:`…). Keep changes minimal and
  validated before pushing.
- ADRs / durable decisions go in `knowledge/decisions.md`.
