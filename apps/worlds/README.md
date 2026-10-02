# Agent Worlds

Optional full upstream apps that run next to GhostForge. Nothing from upstream
is committed here: `setup` clones each repo at a pinned commit into the
gitignored `apps/worlds/<name>/checkout/` (ai-town: `upstream/`) and installs
it per its README.

| World | Upstream | Pinned commit | Ports (127.0.0.1) |
|-------|----------|---------------|-------------------|
| `ai-town` | a16z-infra/ai-town (MIT) | `8e05997f2409` | 5173 (frontend), 3210/3211 (Convex), 6791 (dashboard) |
| `agent-office` | harishkotra/agent-office (MIT) | `58f11f9b3177` | 3000 (server), 5174 (ui) |

The worlds use different ports, so both can run at once (`status` shows
`port-in-use` if something else holds a port).

```bash
ghostforge worlds setup ai-town        # or: node apps/worlds/ai-town/setup.mjs
ghostforge worlds start ai-town
ghostforge worlds status [ai-town|agent-office|all] [--json]
ghostforge worlds stop ai-town
```

- **Loopback only.** Children are launched with `scripts/worlds/loopback-guard.cjs`
  preloaded, which forces every `listen()` onto 127.0.0.1 and refuses other hosts.
  `status` only probes loopback, with a 1s timeout.
- **State.** pid files live in `<agent state dir>/worlds/` (`GF_AGENT_STATE` or
  `.agent-sync/state`).
- **LLM.** Local Ollama (`OLLAMA_HOST`, default `http://127.0.0.1:11434`) or the
  GhostForge gateway env (`OMNIROUTE_URL`, `OMNIROUTE_API_KEY`) read from your
  environment. Other `*_API_KEY` vars are stripped from the child env; nothing is committed.
- **AI Town runtime.** `ai-town` is handled by `scripts/worlds.mjs`, which runs
  the upstream Docker Compose stack (local Convex backend + frontend) with every
  port bound to 127.0.0.1. See [`docs/AI-TOWN.md`](../../docs/AI-TOWN.md) for
  prerequisites, LLM configuration and the smoke test. `agent-office` uses the
  lightweight process manager in `scripts/worlds/` and is patched for loopback
  and the LLM env at setup; see [`docs/AGENT-OFFICE.md`](../../docs/AGENT-OFFICE.md).
  `all` runs both.
- Controls: TUI menu and Start/Stop/Open on `/agent-world` (Town view for
  AI Town, Office view for Agent Office).
