# OmniRoute — Free AI Gateway

## What is OmniRoute?
OmniRoute is a **local AI gateway** that routes your requests across **250+ AI providers** — with **90+ free tiers** and automatic fallback. Never hit a quota limit again.

- 🌐 Website: https://omniroute.online
- 📦 GitHub: https://github.com/diegosouzapw/OmniRoute
- 🆓 ~1.6B free tokens/month (up to ~2.1B with signup credits)
- 🔌 OpenAI-compatible endpoint: `http://localhost:20128/v1`
- 💸 $0 to start — no credit card, no API key needed

## Quick Start
```bash
# Install and run (npm)
npx omniroute

# Or via Docker
docker run -p 20128:20128 diegosouzapw/omniroute

# Or install globally
npm install -g omniroute && omniroute
```

## GhostForge Integration
OmniRoute is already wired into GhostForge's AI fallback chain:

```
Gemini 2.5 Pro  →  (quota out?)  →  OpenRouter  →  (quota out?)  →  OmniRoute
```

Set in `.env.local`:
```
OMNIROUTE_URL=http://localhost:20128/v1
OMNIROUTE_MODEL=auto/coding
```

Switch to OmniRoute as primary provider in the Web UI → Settings → Models → OmniRoute.

## Model IDs
| Model ID | Optimises for |
|----------|---------------|
| `auto` | Balanced default (sticks to last-known-good provider) |
| `auto/coding` | Quality-first for code generation 🧑‍💻 |
| `auto/fast` | Lowest latency first ⚡ |
| `auto/cheap` | Cheapest token cost first 💰 |
| `auto/offline` | Most quota / rate-limit headroom first |
| `auto/smart` | Quality-first + 10% exploration |

## Free Providers (sample)
- **Kiro** — free forever
- **Pollinations** — free forever  
- **LongCat** — free forever
- **SiliconFlow** — no token cap
- **Groq** — free tier (Llama 3.1 70B)
- **Google AI** — free tier (Gemini 2.0 Flash)
- **Together AI** — $25 free credit on signup
- **Cerebras** — free tier (Llama 3.3 70B)
- + 80 more providers with free tiers

## Token Compression
OmniRoute automatically compresses prompts:
- **RTK (Repetition Token Killer)** — removes redundant tokens
- **Caveman compression** — strips unnecessary words
- Saves **15–95%** tokens on tool-heavy sessions (~89% avg)

## Routing Strategies
OmniRoute supports 18 routing strategies. The `auto/*` models use smart scoring across:
- Provider health + latency
- Remaining quota
- Cost per token
- Success rate
- Context size fit

## Use in Any Project
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: 'omniroute',  // value ignored — OmniRoute handles auth
  baseURL: 'http://localhost:20128/v1',
})

const res = await client.chat.completions.create({
  model: 'auto/coding',
  messages: [{ role: 'user', content: 'Review this code...' }],
})
```

## GhostForge Commands
```bash
ghostforge omniroute start        # Start OmniRoute via npx
ghostforge omniroute status       # Check if OmniRoute is running
ghostforge omniroute open         # Open OmniRoute dashboard in browser
ghostforge omniroute models       # List available auto/* models
```
