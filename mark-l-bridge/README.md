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

### Command catalog

`GET /api/commands` (bridge token required, read-only) returns
`{ ok, count, commands: [{ name, description, kind, path }] }` for the repo's
`commands/*.md` (`kind: "command"`) and top-level `scripts/*` (`kind: "script"`).
`commands_catalog.py` only lists names and reads a one-line description from the
first 2 KB of each file; it never executes or serves file contents, and entries
or directories that resolve outside `commands/` / `scripts/` are skipped.

### Snippets, changelog and README

Read-only, bridge token required (`snippets_docs.py`):

| Endpoint | Returns |
|----------|---------|
| `GET /api/snippets` | `{ ok, count, snippets: [name], docs: ["CHANGELOG.md", "README.md"] }` |
| `GET /api/snippets/{name}` | `{ ok, name, content }` for a regular file directly in `snippets/` |
| `GET /api/docs/{name}` | `{ ok, name, content }` for `CHANGELOG.md` or `README.md` only |

Names must match `[A-Za-z0-9][A-Za-z0-9._-]*` and be listed; anything else is
404. Symlinks are never followed, files over 256 KB are refused, and nothing is
written or executed.

### Setup status

`GET /api/setup/status` (bridge token required, read-only, `setup_status.py`)
returns `{ ok, bridge_version, required_env, required_env_ok, optional_env,
ollama_reachable, openjarvis_enabled, mark_lv_vendor_present }`. Environment
variables are reported by name as `true`/`false` (set or not); values are never
returned. Ollama is probed with a 1 s request to `localhost:11434`.

### Free APIs/models and design resources

Read-only, bridge token required (`resource_catalogs.py`); both reuse existing
sources rather than duplicating data:

| Endpoint | Returns | Source |
|----------|---------|--------|
| `GET /api/free-apis` | `{ ok, count, providers: [{ id, name, paid, key_env, key_set, key_url, default_model }], free_api_resources }` | `web-ui/lib/providers.ts`, `marketplace/catalog.json` |
| `GET /api/design-resources` | `{ ok, design_resources, design_marketplace, vigolium, open_source_tools }` | `web-ui/app/design-resources`, `web-ui/app/open-source-tools`, `marketplace/catalog.json` |

`key_set` is `true`/`false` for whether the provider's key environment variable
is set (`null` when no key is needed); key values are never returned. Only
`http(s)` URLs are emitted.

### Security scan

Defensive scanners only (`security_scan.py`), bridge token required:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/security-scan` | GET | `{ running, timeout_s, scanners: [{ id, available, install_hint }] }` |
| `/api/security-scan` | POST | Optional `{ scanner: "gitleaks" \| "osv-scanner" \| "semgrep" }` (default: all) → `{ results: [...] }` |

Each scanner runs against the repository root with a fixed argv (no shell, no
caller-supplied paths, arguments or environment; extra body keys are rejected),
a minimal environment (Windows system locations kept), a throwaway working
directory (so stray writes never land in the repo), a 120 s timeout and 20 KB
of captured output, which is ANSI-stripped and secret-redacted. A scanner that is not on PATH returns
`{ status: "unavailable", reason, install_hint }`. Other statuses: `ok`,
`findings` (exit 1), `error`, `timeout`. One scan at a time; a second POST gets 409.

### Code health and coverage

Allowlisted scripts only (`code_health.py`), bridge token required:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/code-health` | GET | `{ running, timeout_s, scripts: [{ id, available, description }] }` |
| `/api/code-health` | POST | `{ script: "perf" \| "bundle" \| "unused" \| "dep-health" \| "coverage" }` → `{ result }` |

Each id runs `bash scripts/<name>.sh` with a fixed argv (`perf.sh` against
`http://localhost:3000`, `bundle.sh track web-ui`, `unused.sh` report only,
`dep-health.sh full`, `coverage.sh history`): no shell, no caller-supplied
paths, arguments or environment (extra body keys are rejected, unknown ids
get 400), a minimal environment, a 180 s timeout and 20 KB of captured output,
ANSI-stripped and secret-redacted. Statuses: `ok`, `error` (non-zero exit),
`timeout`, `unavailable`. One run at a time; a second POST gets 409.

### Tickets, Azure DevOps and estimates

Read-only script wrappers only (`tickets.py`), bridge token required:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/tickets` | GET | `{ running, timeout_s, tools: [{ id, available, subcommands, description, credentials_configured? }] }` |
| `/api/tickets` | POST | `{ tool: "ticket" \| "ado" \| "estimate", action: string }` → `{ result }` |

`action` is the tool's one argument — a ticket id, a description, or one of
`ado.sh`'s read-only actions (`status`, `pipelines`, `tickets`, `config`). It is
validated (printable, bounded, no control characters) and reaches the child as a
single argv entry: no shell, no caller-supplied path, argument or environment
(extra body keys are rejected), a minimal environment, a 180 s timeout and 20 KB
of captured output, ANSI-stripped and secret-redacted. `estimate.sh` is always
pointed at the repository root with a fixed `--path`. Nothing here creates or
updates a ticket, work item or build — the action allow-list is the gate, and a
test fails if a mutating verb is ever added to it.

`ado.sh` needs an Azure DevOps org, project and PAT. It resolves them the way the
script does (environment, then `.env.local`); the values reach the child process
only — they are never returned, never logged, and are redacted from any output
the child prints, including a `Basic <base64>` auth header. Status reports only
whether they are set. Missing bash, missing script or missing credentials give
`{ status: "unavailable", reason }` rather than an error. One run at a time; a
second POST gets 409.

## Licensing

Mark-LV is **CC BY-NC 4.0 (non-commercial)**. Its source is vendored under
`../vendor/mark-liv` with its original `LICENSE` intact; do not relicense it,
and keep any embedding non-commercial. OpenJarvis is Apache-2.0 and is not
vendored — it is installed on demand.
