# /gemini Command

## Purpose
Set up and test **Google Gemini** as a free AI provider for GhostForge, including the new Vercel web UI.

## Usage
```bash
/gemini
/gemini setup
/gemini test
/gemini models
/gemini ask "Summarize the staged diff"
```

## Local script
```bash
bash ~/ghostforge/scripts/gemini.sh setup
bash ~/ghostforge/scripts/gemini.sh test
bash ~/ghostforge/scripts/gemini.sh models
bash ~/ghostforge/scripts/gemini.sh ask "Hello from GhostForge"
```

## Free models
- `gemini-2.0-flash-exp` — fastest, recommended
- `gemini-1.5-flash` — stable
- `gemini-1.5-pro` — most capable, quota-limited

## Environment variable
```bash
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

## Web UI integration
Add `GOOGLE_GENERATIVE_AI_API_KEY` to Vercel if you want Gemini as the primary or fallback model in `web-ui/`.
