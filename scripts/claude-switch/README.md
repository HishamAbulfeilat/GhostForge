# claude-switch

Lets Claude Code run on your Claude Pro subscription first, then automatically
fall back to free OpenAI-compatible model providers when your Pro usage limit
is hit (HTTP 429) — plus a manual override to force any single source.

Claude Code only speaks Anthropic's `/v1/messages` API, so this is a small
local proxy that translates to/from OpenAI's `/chat/completions` format for
the non-Anthropic providers. It never touches your Pro traffic's content —
Pro requests are forwarded byte-for-byte to `api.anthropic.com` and only
inspected for a 429 status.

## One-time setup

```powershell
# Runtime files (config with real keys, mode state, logs) live outside the
# repo so secrets are never committed.
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude-switch"
Copy-Item scripts\claude-switch\config.example.json "$env:USERPROFILE\.claude-switch\config.json"
Copy-Item scripts\claude-switch\*.mjs "$env:USERPROFILE\.claude-switch\"

node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" start
```

It works with **no keys at all**: `kilo` (Kilo Gateway's anonymous `:free`
models), `llm7` and `pollinations` need no key, and `omniroute` uses your
local OmniRoute gateway (`omniroute serve --daemon`) if it has providers
connected. Optionally add keys for more/better free providers:

```powershell
node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" key groq       <your-groq-key>
node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" key gemini     <your-gemini-key>
node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" key openrouter <your-openrouter-key>
node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" key cerebras   <your-cerebras-key>
node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" key nvidia     <your-nvidia-key>
node "$env:USERPROFILE\.claude-switch\claude-mode.mjs" key mistral    <your-mistral-key>
```

Point Claude Code at the proxy. Per session:

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:3457"
claude
```

Or for every session, add `"ANTHROPIC_BASE_URL": "http://127.0.0.1:3457"` to
`env` in `~/.claude/settings.json` and start the proxy at logon (a hidden
`.vbs` in the Startup folder running `node ~/.claude-switch/proxy.mjs`).
If the proxy is down, Claude Code can't reach Anthropic until
`claude-mode start`.

## Modes

| Command                      | Behavior                                               |
|-------------------------------|---------------------------------------------------------|
| `claude-mode auto` (default)   | Pro first; on a 429 switch to the free chain until Anthropic's own reset time, then back to Pro automatically. A 5xx/529 or Anthropic being unreachable falls back for that one request only |
| `claude-mode pro`              | Pro only, never falls back                             |
| `claude-mode free`             | Skip Pro, use the free provider chain                   |
| `claude-mode openrouter`       | Force OpenRouter's free (`:free`) models only            |
| `claude-mode omniroute`        | Force the local OmniRoute gateway only                  |
| `claude-mode status`           | Show current mode, Pro cooldown, and which providers have keys |
| `claude-mode start` / `stop`   | Manage the background proxy process                     |

The free chain order (`config.json` → `freeChain`) is: openrouter,
omniroute, gemini, groq, cerebras, nvidia, mistral, kilo, llm7, pollinations.
Keyed providers without a key are skipped. A provider may list several
`models`; each is tried in turn. A rate-limited model cools down on its own
(honoring `retry-after`), while an auth failure or daily quota cools down the
whole provider.

Claude Code's MCP tool schemas can be hundreds of KB per request. They are
stripped before going to free providers (they break small models and burn free
daily quotas); set `"keepMcpTools": true` globally or per provider to keep
them. Built-in tools (Bash, Read, Edit, …) are always kept.

## Notes

- Bound to `127.0.0.1` only; nothing is exposed on the network.
- Free providers may log prompt content on their side — don't route secrets
  through `free`/`openrouter`/`omniroute` modes.
- `~/.claude-switch/config.json`, `state.json`, and `proxy.log` hold live keys
  and state and must never be committed — only `config.example.json` (keys
  blanked) lives in the repo.
