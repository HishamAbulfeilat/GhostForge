# Agent Office world app

GhostForge can run the upstream [harishkotra/agent-office](https://github.com/harishkotra/agent-office)
(MIT) app exactly as its README sets it up — Colyseus server + Vite/Phaser
client — as a managed world next to GhostForge. Nothing from upstream is
committed: setup clones it at a pinned commit into the gitignored
`apps/worlds/agent-office/checkout/`.

This is separate from the `/agent-world?world=office` scene, which renders the
vendored Agent Office front-end from GhostForge's own agent snapshot (T-142).

| | |
|---|---|
| Upstream commit | `58f11f9b31770c10bcf3d7a0618325d22bd0ee9e` |
| Server (Colyseus + REST) | `127.0.0.1:3000` |
| Client (Vite) | `127.0.0.1:5174` (AI Town owns 5173, so both can run at once) |
| Manager | `scripts/worlds/lib.mjs` (via `scripts/worlds.mjs`) |
| Patches | `apps/worlds/agent-office/configure.mjs` |

## Prerequisites

- Git, Node.js 18+ and npm 9+ (the server builds the native `sqlite3` module).
- An LLM, one of:
  - **Local Ollama** (default): Ollama on `http://127.0.0.1:11434` with the
    model pulled — `ollama pull llama3.2`. Override with `OLLAMA_HOST` and
    `OLLAMA_MODEL`.
  - **GhostForge model gateway**: set `OMNIROUTE_URL` (an http(s) origin,
    optionally ending in `/v1`), plus `OMNIROUTE_API_KEY` if your gateway
    needs one and `OMNIROUTE_MODEL` (default `auto`). `AGENT_OFFICE_MODEL_GATEWAY_URL`,
    `AGENT_OFFICE_MODEL_GATEWAY_API_KEY` and `AGENT_OFFICE_MODEL` override these
    for Agent Office only.

Keys are read from the environment of the process that runs `start`; they are
never written to the repo or the checkout. Every other `*_API_KEY` variable is
stripped from the world's environment.

## Setup

```bash
ghostforge worlds setup agent-office     # or: node apps/worlds/agent-office/setup.mjs
```

This follows the upstream README (`npm install`, `npm run build`) with two
additions:

1. Before installing, `configure.mjs` resets five upstream files to the pinned
   commit and patches them: the Colyseus server listens on `127.0.0.1`, the Vite
   client on `127.0.0.1:5174` with `strictPort` and its `/api` proxy on
   `127.0.0.1:3000`, the hard-coded `localhost:11434` Ollama is replaced by the
   env-selected Ollama or gateway, and an empty gateway key sends no
   `Authorization` header. If upstream text has drifted, setup fails rather
   than running an unpatched app.
2. `@agent-office/core` is built before the workspace build, because the
   upstream root build compiles the adapters before their core dependency.

## Run

```bash
ghostforge worlds start agent-office
ghostforge worlds status agent-office [--json]
ghostforge worlds stop agent-office
```

`start` launches `npm run start --workspace=@agent-office/server` and
`npm run dev --workspace=@agent-office/ui` as detached processes, with pid files
in `<agent state dir>/worlds/`. `scripts/worlds/loopback-guard.cjs` is
preloaded into both processes, so a listen on any non-loopback host fails.
`start` refuses a checkout that has not been configured.

The same controls are in the TUI (**Agent Worlds → Agent Office**) and on
`/agent-world` → **Office** (admin only): **Start**, **Stop** and **Open**. Open
embeds `http://127.0.0.1:5174/` in a sandboxed iframe; the client connects to
the Colyseus server at `ws://<page host>:3000`.

## Smoke test

`status` is `running` only when both processes are ours, both ports are
listening, and both smoke URLs answer HTTP 200:

```bash
ghostforge worlds status agent-office --json   # "status": "running", httpStatus 200 for server and ui
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/            # 200
curl -s http://127.0.0.1:3000/api/offices                                  # {"status":"ok","offices":[]}
```

On Windows PowerShell:

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5174/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/offices).StatusCode
```

`netstat -ano | findstr ":3000 :5174"` should show both listening on
`127.0.0.1` only. A passing smoke test proves the app answers; the agents only
think and talk once the configured Ollama model or gateway is reachable.

## Troubleshooting

- `not configured for GhostForge` — run `ghostforge worlds setup agent-office` again.
- `port-in-use` in `status` — something else holds 3000 or 5174; stop it first.
- Agents sit idle — check `ollama list` (or the gateway URL and model); the
  server logs inference errors.
