# Agent Office world

GhostForge manages the upstream [harishkotra/agent-office](https://github.com/harishkotra/agent-office) app at commit `58f11f9b31770c10bcf3d7a0618325d22bd0ee9e`. The ignored checkout lives in `checkout/`; its source is not vendored or committed. `setup.mjs` follows the upstream README (`npm install`, workspace build, server start, and UI dev server) and adds a core-first build because the upstream root workspace build otherwise compiles adapters before their core dependency. Setup also patches only the ignored checkout to bind the Colyseus server and Vite client to `127.0.0.1`, and enables model configuration through environment variables.

## Prerequisites

- Git, Node.js 18 or later, and npm 9 or later.
- For local inference: Ollama running at `http://127.0.0.1:11434` with `llama3.2` pulled. `OLLAMA_BASE_URL` can select a different local Ollama endpoint.
- Or an OpenAI-compatible GhostForge gateway. Set `AGENT_OFFICE_MODEL_GATEWAY_URL` (or the existing `OMNIROUTE_URL`, `OPENROUTER_BASE_URL`, or `OPENAI_BASE_URL`), `AGENT_OFFICE_MODEL` when the gateway needs a specific model, and its key in `AGENT_OFFICE_MODEL_GATEWAY_API_KEY` or the matching existing gateway key variable. Local OmniRoute does not require a key. Keep credentials in the process environment or secret store; never place them in this directory or source control.

## Setup and lifecycle

From the GhostForge repository root:

```sh
node scripts/worlds.mjs setup agent-office
node scripts/worlds.mjs start agent-office
node scripts/worlds.mjs status agent-office
node scripts/worlds.mjs stop agent-office
```

The shared manager listens on `127.0.0.1:3000` for the server and `127.0.0.1:5174` for the client; startup refuses to take over an already occupied port. Runtime state and logs are kept under the ignored `.runtime/` directory. The repository CLI, TUI, and `/agent-world` controls still need to be wired to these manager commands.

## Smoke test

After `start`, `status` checks both the client and the server endpoint. Both must answer HTTP 200:

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5174/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/offices).StatusCode
```

Expected output is `200` for each request. Open `http://127.0.0.1:5174/` to use the office. `status` only proves that the app endpoints answer; successful model inference additionally requires the configured Ollama model or gateway to be reachable.
