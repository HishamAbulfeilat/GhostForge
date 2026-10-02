# Agent Worlds

Optional full upstream apps that run next to GhostForge. Nothing from upstream
is committed here: `setup` clones each repo at a pinned commit into the
gitignored `apps/worlds/<name>/checkout/` and installs it per its README.

| World | Upstream | Pinned commit | Ports (127.0.0.1) |
|-------|----------|---------------|-------------------|
| `ai-town` | a16z-infra/ai-town (MIT) | `8e05997f2409` | 5173 (frontend) |
| `agent-office` | harishkotra/agent-office (MIT) | `58f11f9b3177` | 3000 (server), 5173 (ui) |

Both worlds use port 5173 for their UI, so run one at a time (`status` shows
`port-in-use` if something else holds the port).

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
- **AI Town backend.** Upstream needs a Convex backend (self-hosted docker
  compose); `start` runs the frontend only. Follow the upstream README for it.
- Follow-ups: TUI menu and `/agent-world` iframe controls.
