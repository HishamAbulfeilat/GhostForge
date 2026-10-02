# Agent Office world

Managed run of the upstream [harishkotra/agent-office](https://github.com/harishkotra/agent-office)
app at commit `58f11f9b31770c10bcf3d7a0618325d22bd0ee9e`. The checkout lives in
the gitignored `checkout/`; upstream source is not committed.

- `setup.mjs` — clone at the pinned commit, configure, install, build.
- `configure.mjs` — patches the checkout for 127.0.0.1 binds, the UI on :5174,
  and the LLM from local Ollama or the GhostForge model gateway env.

```bash
ghostforge worlds setup agent-office
ghostforge worlds start|stop|status agent-office
```

Prerequisites, LLM configuration and the smoke test:
[`docs/AGENT-OFFICE.md`](../../../docs/AGENT-OFFICE.md).
