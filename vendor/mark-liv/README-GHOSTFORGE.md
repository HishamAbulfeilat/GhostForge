# Mark-LIV — vendored JARVIS engine

This directory vendors [Mark-LIV](https://github.com/FatihMakes/Mark-LIV)
(MIT-style license, see `LICENSE`) — FatihMakes' cross-platform, Gemini Live
voice assistant — as the **engine behind GhostForge's JARVIS / G.F.A.I. mode**.

GhostForge integrates it in three layers:

1. **Desktop engine (this directory).** The full Mark-LIV app: holographic
   avatar HUD, wake word ("Hey Jarvis"), push-to-talk, lip-sync, 20+ action
   tools (`actions/*.py`), plugin system (`plugins/`), persistent memory,
   undo, and the phone-pairing dashboard (`dashboard/server.py`, port 8000).
   Launch it with `scripts/mark-liv.sh start` (mac/Linux/Windows Git Bash) —
   deps via `scripts/mark-liv.sh setup`, health check via `doctor`.
2. **Web UI skill registry.** The same action surface is exposed to the web
   UI's chat/JARVIS pages through `web-ui/lib/mark-liv-actions.ts`
   (`MARK_LIV_ACTIONS`) — rendered by `MarkLPanel` in `/jarvis` and resolved
   by `/api/jarvis` into tool prompts.
3. **Shared identity.** Assistant name, user name, voice, and the Gemini API
   key are forwarded from GhostForge config (`GEMINI_API_KEY` /
   `GOOGLE_GENERATIVE_AI_API_KEY` env or `web-ui/.env`) into Mark-LIV's
   `config/api_keys.json` on start — one brain, two front-ends.

## Updating the vendored copy

```bash
git clone --depth 1 https://github.com/FatihMakes/Mark-LIV /tmp/Mark-LIV
rm -rf vendor/mark-liv && cp -r /tmp/Mark-LIV vendor/mark-liv && rm -rf vendor/mark-liv/.git
```

Keep changes minimal in this tree — prefer GhostForge-side wrappers so future
upstream pulls stay clean.
