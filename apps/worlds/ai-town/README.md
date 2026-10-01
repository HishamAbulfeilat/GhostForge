# AI Town world

GhostForge runs the upstream [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
project from a pinned, ignored checkout. Its source and dependencies are not
vendored in this repository.

## Prerequisites

- Git, Node.js/npm, and Docker with the Compose plugin.
- For local inference: Ollama running on the host, with `llama3` and
  `mxbai-embed-large` pulled (`ollama pull llama3` and
  `ollama pull mxbai-embed-large`). Start the Ollama app or run `ollama serve`.
  The Convex container reaches it at
  `http://host.docker.internal:11434`.
- Alternatively, an OpenAI-compatible GhostForge gateway can be configured
  with `GF_AI_TOWN_LLM_API_URL`, `GF_AI_TOWN_LLM_MODEL`, and
  `GF_AI_TOWN_LLM_EMBEDDING_MODEL`. The embedding model must return 1024
  dimensions, matching the pinned upstream Ollama configuration. A gateway key
  is optional and can be supplied in `GF_AI_TOWN_LLM_API_KEY`; it is stored in
  the local Convex deployment, never in this repository.

On Linux, Docker must support the `host-gateway` host alias and the host's
Ollama listener must be reachable from Docker. AI Town's own frontend, Convex
backend, and dashboard are published only on `127.0.0.1`.

## Install and run

```sh
node apps/worlds/ai-town/setup.mjs
ghostforge worlds start ai-town
ghostforge worlds status ai-town
```

The setup script clones the pinned upstream revision into the ignored
`apps/worlds/ai-town/upstream/` directory and installs dependencies using the
upstream README's `npm install` step. Start follows its Docker Compose
self-hosted Convex setup, generates the local admin key in the ignored
upstream `.env.local`, configures Ollama (or the optional gateway), initializes
the world with `npm run predev`, and waits for the app and backend.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The self-hosted Convex
dashboard is normally at `http://127.0.0.1:6791`; if that port is already in
use, the manager picks the next available local port and prints its URL in
`ghostforge worlds status ai-town`.

## Smoke test and lifecycle

```sh
ghostforge worlds status ai-town
curl --fail http://127.0.0.1:5173/
curl --fail http://127.0.0.1:3210/version
```

The status command checks both HTTP endpoints as well as the Compose services.
An HTTP response from the frontend port and a successful Convex `/version`
response confirm the local app and backend are answering. Open the world and
send a message to an AI character to exercise the configured LLM; AI responses
require Ollama or a compatible gateway to be running.

```sh
ghostforge worlds stop ai-town
```

Stop preserves the Compose containers and Convex data volume for the next
start. The manager uses Compose service identities rather than persisted
process IDs, so stale PID files cannot terminate unrelated host processes.

To use a GhostForge gateway, export the `GF_AI_TOWN_LLM_*` variables in the
environment before running `ghostforge worlds start ai-town`. Never put API
keys in tracked files. To change gateways or return to Ollama, remove the
previous `LLM_*` variables from the local Convex deployment using the upstream
Convex CLI and start the world again.

Upstream setup reference: [AI Town README](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/README.md),
commit `8e05997f2409275669c8344b84a51692e83f3f33`.
