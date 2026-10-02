# Optional OpenAI-Compatible Gateways

GhostForge can route model requests through OpenRouter or a locally running
OmniRoute server. Both use OpenAI-compatible chat completions; neither changes
Claude Code or GitHub Copilot configuration. OmniRoute is the optional,
MIT-licensed gateway at [diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute).

## Web UI model routing

In **Settings → AI Models**, save an OpenRouter key or select a model from an
already configured provider. API keys saved in Settings are stored server-side
in `~/.ghostforge/provider-keys.json` with owner-only permissions and are never
returned to the browser. Environment variables are also supported:

| Gateway | Key | Optional URL | Default |
| --- | --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| OmniRoute | `OMNIROUTE_API_KEY` | `OMNIROUTE_URL` | `http://localhost:20128/v1` |

OmniRoute is optional and uses loopback by default; no API key is sent unless
`OMNIROUTE_API_KEY` is set. Its default model is the OmniRoute `auto` route.
OpenRouter's curated free list includes `deepseek/deepseek-r1:free` as well as
other models marked `:free`.

The web model chain tries an explicitly selected/saved model first. When it
fails with a fallback-eligible error (including quota, rate-limit, and HTTP 429
responses), GhostForge continues through configured free-tier providers,
including OpenRouter, then a running OmniRoute gateway, Pollinations, and local
runtimes. OpenRouter needs its own key; OmniRoute is included only while its
loopback service is reachable. This is a fallback policy, not a promise that
free services have unlimited capacity or availability.

To use environment configuration, put keys in the server's `.env.local` (or
the deployment's secret store), not in source control, browser storage, logs,
or `.agent-sync/team.json`. Settings keys take precedence over environment
keys. Do not expose these variables with a `NEXT_PUBLIC_` prefix.

## Agent-team CLI gateway adapters

The agent provider adapter accepts `openrouter` and `omniroute` as optional
Codex/OpenAI-compatible gateways. Values in agent `config` or `providerConfig`
may override the endpoint/model or name a different key environment variable;
the key itself must remain in the process environment and is passed to Codex
only as `OPENAI_API_KEY`, never as a command-line argument.

| Adapter | Environment | Default model |
| --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY`, optional `OPENROUTER_BASE_URL` | `deepseek/deepseek-r1:free` |
| `omniroute` | optional `OMNIROUTE_API_KEY`, optional `OMNIROUTE_URL` | `auto` |

OmniRoute defaults to `http://127.0.0.1:20128/v1`. A missing OmniRoute key
becomes an explicit empty Codex API key so an unrelated `OPENAI_API_KEY` is
not accidentally sent to the local gateway.

The existing agent-team boss fallback can be configured separately from the
primary provider. For example, a team operator may choose a gateway fallback
and provide its `fallbackConfig`; the primary Claude Code or Copilot command
and its own settings remain untouched. Keep all actual credentials in
environment variables and choose a free OpenRouter model explicitly when
using that fallback.

## Verification

Run the gateway adapter and web routing regression tests with:

```sh
node --test scripts/agents/lib/providers.test.mjs
cd web-ui && node --test lib/models/gateway-policy.test.mjs
```
