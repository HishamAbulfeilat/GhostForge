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
and `/api/openjarvis/*`.

### OpenJarvis endpoints

OpenJarvis ships as the `jarvis` CLI (not a pip-importable package), so the
bridge shells out to it with a fixed argv (never `shell=True`):

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/openjarvis/health` | GET | `{ installed, binary }` — whether `jarvis` is on PATH |
| `/api/openjarvis/doctor` | GET | Runs `jarvis doctor`, returns its output |
| `/api/openjarvis/ask` | POST | `{ prompt, timeout_s? }` → `{ response }`; 503 if not installed |

## Licensing

Mark-LV is **CC BY-NC 4.0 (non-commercial)**. Its source is vendored under
`../vendor/mark-liv` with its original `LICENSE` intact; do not relicense it,
and keep any embedding non-commercial. OpenJarvis is Apache-2.0 and is not
vendored — it is installed on demand.
