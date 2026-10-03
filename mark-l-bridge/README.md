# GhostForge Bridge

The single Python bridge behind JARVIS. It exposes one FastAPI service
(`127.0.0.1:8765`) that the web UI, the Electron app, and the TUI all call,
and it unifies two engines under that one surface:

| Engine | What it adds | Source | License |
|--------|--------------|--------|---------|
| **Mark-LV** | Real-time Gemini Live voice, screen + webcam vision, computer/browser/file control, wake word, avatar HUD, ~20 action modules | vendored at `../vendor/mark-liv` ([FatihMakes/Mark-LV](https://github.com/FatihMakes/Mark-LV)) | CC BY-NC 4.0 |
| **OpenJarvis** | Local-first on-device agent primitives (runs with Ollama, cloud only when needed) | opt-in pip / installer ([open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis)) | Apache-2.0 |

Plus the bridge's own intelligence layer: `ai_memory`, `ai_agents`,
`ai_browser`, `ai_models`, `ai_unified`.

> **Note:** the directory is named `mark-l-bridge` for backward compatibility
> with existing web-ui/electron wiring; it is the unified bridge for **Mark-LV**
> (the current release — "Mark-L" is retired). `MARK_LIV_DIR` overrides the
> vendored Mark-LV copy.

## Run

```bash
./start.sh          # creates .venv, installs requirements.txt, serves on :8765
```

Auth: requests carry a token from `~/.ghostforge/bridge/token` (or
`MARKL_BRIDGE_TOKEN`). Endpoints live under `/api/mark-l/*`, `/api/mark-liv/*`,
`/api/openjarvis/*`, and the JARVIS feature contracts (`/api/jarvis/collab`,
`/api/jobs`, `/api/workflows`, `/api/webhook`, `/api/devices`, and
`/api/release`).

### OpenJarvis endpoints

OpenJarvis ships as the `jarvis` CLI (not a pip-importable package), so the
bridge shells out to it with a fixed argv (never `shell=True`):

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/openjarvis/health` | GET | `{ installed, binary }` — whether `jarvis` is on PATH |
| `/api/openjarvis/doctor` | GET | Runs `jarvis doctor`, returns its output |
| `/api/openjarvis/ask` | POST | `{ prompt, timeout_s? }` → `{ response }`; 503 if not installed |

### JARVIS feature contracts

These endpoints use the same bridge token and provide local, bridge-native
access to the web feature contracts. Collaboration `GET` without an `id`
creates a session and returns `{ id, shareUrl }`; workflow updates preserve
the existing status when `status` is omitted. Jobs, workflows, webhooks, and
devices are persisted under `~/.ghostforge/bridge/`.

### GitHub dashboard

`GET /api/github/dashboard` (bridge token required, read-only) returns open
issues, open PRs and recent workflow runs (20 each) for `GHOSTFORGE_GITHUB_REPO`
(`owner/name`, else `GITHUB_REPOSITORY`, else the `origin` remote). It uses the
`gh` CLI, falling back to `GITHUB_TOKEN`/`GH_TOKEN` over the REST API; the token
is never logged or returned. If neither is available, or the call fails, it
returns `{ ok: false, available: false, reason, ... }` with empty lists.

### Security scan

Defensive scanners only (`security_scan.py`), bridge token required:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/security-scan` | GET | `{ running, timeout_s, scanners: [{ id, available, install_hint }] }` |
| `/api/security-scan` | POST | Optional `{ scanner: "gitleaks" \| "osv-scanner" \| "semgrep" }` (default: all) → `{ results: [...] }` |

Each scanner runs against the repository root with a fixed argv (no shell, no
caller-supplied paths, arguments or environment; extra body keys are rejected),
a minimal environment, a 120 s timeout and 20 KB of captured output, which is
ANSI-stripped and secret-redacted. A scanner that is not on PATH returns
`{ status: "unavailable", reason, install_hint }`. Other statuses: `ok`,
`findings` (exit 1), `error`, `timeout`. One scan at a time; a second POST gets 409.

## Licensing

Mark-LV is **CC BY-NC 4.0 (non-commercial)**. Its source is vendored under
`../vendor/mark-liv` with its original `LICENSE` intact; do not relicense it,
and keep any embedding non-commercial. OpenJarvis is Apache-2.0 and is not
vendored — it is installed on demand.
