# claude-switch

Lets Claude Code run on your Claude Pro subscription for planning/review,
while free OpenAI-compatible model providers do the actual coding work —
with per-agent model assignment so each worker gets the best free model for
its task type.

Claude Code only speaks Anthropic's `/v1/messages` API, so this is a small
local proxy that translates to/from OpenAI's `/chat/completions` format for
the non-Anthropic providers. It never touches your Pro traffic's content —
Pro requests are forwarded byte-for-byte to `api.anthropic.com` and only
inspected for a 429 status.

## Architecture

```
Claude Code → ANTHROPIC_BASE_URL → claude-switch proxy (127.0.0.1:3457)
  ├─ mode=pro|auto → Anthropic API (Claude Opus for planning/review)
  └─ mode=free|best → free provider chain:
       ranked best-first, re-ordered live by measured health
```

Per-agent model pinning: the GhostForge boss (`scripts/agents/boss.mjs`)
sends `x-claude-switch-agent: <name>` on every worker request. The proxy
looks up `config.agentModels[<name>]` and routes that agent to its exact
assigned free provider/model. This is how Claude Pro manages/coordinates
while free models do the work.

## Finding and switching free models

Four commands cover everything — no need to know provider or model IDs.

```powershell
node ~/.claude-switch/claude-mode.mjs models       # list every free model + live status
node ~/.claude-switch/claude-mode.mjs probe        # test all of them now, show speed
node ~/.claude-switch/claude-mode.mjs probe --apply # re-order the chain best-first
node ~/.claude-switch/claude-mode.mjs use 3        # switch by list number
node ~/.claude-switch/claude-mode.mjs use deepseek # ...or by partial name
node ~/.claude-switch/claude-mode.mjs unpin        # stop pinning, follow the chain
```

`models` output looks like:

```
   1. 200     q 88  4248ms  kilo/nvidia/nemotron-3-super-120b-a12b:free
   2. 200     q 86   225ms  llm7/DeepSeek-V4-Flash-0731
   3. 429     q 95      -  gemini/gemini-3.6-flash   quota exceeded
```

`q` is `modelQuality` — an explicit 0-100 rating of how good the model is at
agentic coding work. Edit it in `config.json` to taste; `probe --apply` puts
the highest-quality model that is *currently answering* first, with measured
latency breaking ties. Ranking by speed alone would promote small weak models
that merely reply first.

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

`claude-mode <mode>` points Claude Code at the right place by setting
`env.ANTHROPIC_BASE_URL` in `~/.claude/settings.json` (other settings are
left alone):

- `pro` → `https://api.anthropic.com` (direct, the proxy isn't involved)
- `auto`, `free`, `openrouter`, `omniroute` → `http://127.0.0.1:3457`
  (the proxy is started first if it isn't running)

This applies to Claude Code sessions started afterwards; restart running ones
to switch. `claude-mode` with no argument shows the mode, the current
`ANTHROPIC_BASE_URL`, and warns if they don't match.

To start the proxy at logon, add a hidden `.vbs` in the Startup folder that
runs `node ~/.claude-switch/proxy.mjs`.

## Modes

| Command                      | Behavior                                               |
|-------------------------------|---------------------------------------------------------|
| `claude-mode auto` (default)   | Pro first; on a 429 switch to the free chain until Anthropic's own reset time, then back to Pro automatically. A 5xx/529 or Anthropic being unreachable falls back for that one request only |
| `claude-mode pro`              | Anthropic directly (bypasses the proxy), never falls back |
| `claude-mode free`             | Skip Pro, use the free provider chain in configured order |
| `claude-mode best`             | Quality-ranked free chain, re-ordered live by measured health — the hands-off default |
| `claude-mode <provider>`       | Force one provider's own models (`openrouter`, `kilo`, `gemini`, `omniroute`) |
| `claude-mode models`           | List every free model with its live status, quality and speed |
| `claude-mode probe [--apply]`  | Test every model now; `--apply` re-orders the chain best-first |
| `claude-mode use <n\|query>`  | Pin one model by list number or partial name |
| `claude-mode unpin`            | Clear a pin and follow the chain again |
| `claude-mode status`           | Mode, chain health, last model served, agent assignments |
| `claude-mode start` / `stop`   | Manage the background proxy process                     |

The chain order (`config.json` → `freeChain`) starts quality-ranked and is
re-ordered at request time by measured provider health: a provider that is slow
or erroring drops to the back, and one that recovers comes forward. Keyed
providers without a key are skipped. A provider may list several `models`;
each is tried in turn. A rate-limited model cools down on its own (honoring
`retry-after`), while an auth failure or daily quota cools down the whole
provider.

## Per-agent model assignment

The GhostForge boss assigns each worker agent a specific free model via
`config.json` → `agentModels`. Workers send `x-claude-switch-agent: <name>`
on every request; the proxy routes to that agent's exact provider/model:

```json
"agentModels": {
  "boss":      { "provider": "openrouter", "model": "stealth/space-bunny-alpha" },
  "claude":    { "provider": "gemini",    "model": "gemini-2.5-flash" },
  "claude-2":  { "provider": "openrouter", "model": "nvidia/nemotron-3.5-lightning:free" },
  "claude-3":  { "provider": "kilo",      "model": "kilo-auto/free" },
  "copilot":   { "provider": "llm7",      "model": "DeepSeek-V4-Flash-0731" },
  "copilot-2": { "provider": "pollinations", "model": "openai-fast" },
  "copilot-3": { "provider": "omniroute", "model": "auto" }
}
```

Manage at runtime:

```powershell
node ~/.claude-switch/claude-mode.mjs agent              # show all assignments
node ~/.claude-switch/claude-mode.mjs agent claude       # show one agent
node ~/.claude-switch/claude-mode.mjs agent claude openrouter deepseek/deepseek-r1:free  # reassign
```

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
