# AI Town world

GhostForge manages [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
as an optional local world app. The setup script checks out commit
`8e05997f2409275669c8344b84a51692e83f3f33` into the ignored
`apps/worlds/ai-town/upstream/` directory and installs dependencies with the
upstream README's `npm install` command. The checkout, installed packages,
local Convex data, generated admin key, and Compose loopback settings are not
committed or vendored.
The upstream project is MIT-licensed by a16z-infra; its license remains in the
ignored checkout.

## Prerequisites

- Git, Node.js 18 or later with npm, and Docker with the Compose plugin.
- For local inference, Ollama must be running and have the upstream default
  models available: `ollama pull llama3` and
  `ollama pull mxbai-embed-large`.
  Set `GF_AI_TOWN_OLLAMA_MODEL` and
  `GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL` to use different installed models, and
  `GF_AI_TOWN_OLLAMA_HOST` if Ollama listens on a non-default address or port.
  The default host is `http://host.docker.internal:11434`.
- Alternatively, configure an OpenAI-compatible GhostForge model gateway
  before starting the world. Supply `GF_AI_TOWN_LLM_API_URL`,
  `GF_AI_TOWN_LLM_MODEL`, and `GF_AI_TOWN_LLM_EMBEDDING_MODEL`; optionally set
  `GF_AI_TOWN_LLM_API_KEY`. The embedding model must be compatible with the
  upstream vector dimensions. Keys are passed only to the local Convex
  deployment and must never be committed.

Docker must be able to reach the host's Ollama or gateway through
`host.docker.internal`. The managed app publishes its frontend, Convex backend,
site proxy, and dashboard only on `127.0.0.1`. Default ports are 5173, 3210,
3211, and 6791; if 6791 is busy, the manager selects the next available
dashboard port and reports it in status. Override the ports with `GF_AI_TOWN_FRONTEND_PORT`,
`GF_AI_TOWN_PORT`, `GF_AI_TOWN_SITE_PROXY_PORT`, and
`GF_AI_TOWN_DASHBOARD_PORT` respectively.

## Setup and lifecycle

From the GhostForge repository root:

```sh
node apps/worlds/ai-town/setup.mjs
ghostforge worlds start ai-town
ghostforge worlds status ai-town
```

Setup pins the ignored upstream checkout and runs the upstream `npm install`.
Start uses the upstream Docker Compose self-hosted Convex setup, stores its
local admin key in the ignored upstream `.env.local`, applies the configured
LLM environment, and runs the README's `npm run predev` initialization. The
Convex mutation reuses an existing world, and the manager resumes an inactive
simulation engine, so start remains safe after a stop.
Open `/agent-world`, select **Agent Town**, and use **Start**, **Stop**, and
**Open** to manage the app and display it in an iframe. The API controls require
the `admin_tools` permission.

The standalone app is available at
[http://127.0.0.1:5173](http://127.0.0.1:5173). To stop it from a terminal:

```sh
ghostforge worlds stop ai-town
```

Stopping preserves the Convex Docker volume and world data. To use a gateway,
set the `GF_AI_TOWN_LLM_*` variables in the environment of the GhostForge
process before running `start`. The local Convex environment retains those
settings; never put API keys in tracked files.

## Smoke test

After starting the app, verify the managed status and both local HTTP services:

```sh
ghostforge worlds status ai-town
curl.exe --fail http://127.0.0.1:5173/
curl.exe --fail http://127.0.0.1:3210/version
```

Status reports success only when the frontend responds on port 5173 and the
Convex backend responds on port 3210. To verify inference end to end, open AI
Town, send a message to a character, and confirm an AI response; that final
check requires the configured Ollama model or compatible gateway to be
available.

Web-start diagnostics are captured at the ignored
`apps/worlds/ai-town/.state/start.log`.
