# /clicky Command

## Purpose
Install, configure, and manage **Clicky** — an AI cursor buddy that sees your screen, talks to you, and points at things. Integrates with GhostForge's JARVIS voice + Mac control for a complete local AI assistant experience.

## Usage
```bash
/clicky                          # Show Clicky status + install options
/clicky install                  # Install LocalClicky (recommended — fully local)
/clicky install cloud            # Install original Clicky (requires API keys)
/clicky install local            # Same as /clicky install
/clicky status                   # Check if Clicky + Ollama are running
/clicky models                   # List available Ollama models for Clicky
/clicky setup                    # Walk through initial setup + permissions
/clicky share-ollama             # Share GhostForge's Ollama models with Clicky
```

## Clicky Variants

| Variant | Cloud? | STT | TTS | Vision | Stars | Best For |
|---------|--------|-----|-----|--------|-------|----------|
| **[Clicky](https://github.com/farzaa/clicky)** (original) | Yes (Claude + AssemblyAI + ElevenLabs) | AssemblyAI | ElevenLabs | Claude vision | 7.2k | Best quality (paid APIs) |
| **[LocalClicky](https://github.com/tanavc1/LocalClicky)** | No (100% local) | Apple Speech | Neural Piper | Ollama moondream | 2 | Privacy + no cost |
| **[clicky-local](https://github.com/coldiary/clicky-local)** | No (100% local) | WhisperKit | Kokoro/AVSpeech | Ollama any model | 0 | Most configurable |

## Recommendation

**Use LocalClicky** — it's the most complete local-only version:
- No API keys, no cloud, no telemetry
- One-line install: `curl -fsSL https://raw.githubusercontent.com/tanavc1/LocalClicky/main/scripts/web-install.sh | bash`
- Shares Ollama with GhostForge JARVIS
- Blue cursor pointing + voice responses + screen awareness

## How It Integrates with GhostForge

Clicky and GhostForge share the same local AI stack:

```
GhostForge JARVIS          Clicky (LocalClicky)
├── Ollama LLM             ├── Ollama LLM (same models)
├── Voice (Fish Audio)     ├── Voice (Apple/Piper TTS)
├── Mac Control            ├── Blue cursor pointing
├── Screen Share           ├── Screen capture
└── Web UI                 └── Menu bar overlay
```

**Shared Ollama models:**
- Both use `http://localhost:11434` (Ollama default)
- GhostForge JARVIS + LocalClicky can run simultaneously
- Same models serve both tools (no duplication)

**Combined workflow:**
1. LocalClicky handles push-to-talk, screen pointing, quick answers
2. GhostForge JARVIS handles complex tasks, code generation, Mac automation
3. Both share the same local AI brain (Ollama)

## Quick Start

```bash
# 1. Ensure Ollama is running (GhostForge already sets this up)
ollama serve &

# 2. Install LocalClicky
curl -fsSL https://raw.githubusercontent.com/tanavc1/LocalClicky/main/scripts/web-install.sh | bash

# 3. Grant permissions in System Settings
#    - Microphone (push-to-talk)
#    - Accessibility (global hotkey)
#    - Screen Recording (screenshots)

# 4. Hold Control+Option and talk to Clicky!
```

## Actions (what Clicky can do)

| Say... | What happens |
|--------|-------------|
| "What does this button do?" | Captures screen, asks vision model, points blue cursor |
| "Where do I click to export?" | Points cursor at the export button |
| "Explain this error" | Reads screen, explains error, points at it |
| "Open a new tab and go to gmail" | Opens URL in browser |
| "Launch Spotify" | Opens installed Mac app |
| "Copy your answer" | Copies last response to clipboard |
| "What's 12 times 8?" | Text-only answer (no screenshot needed) |

## Hardware Requirements

| Spec | Minimum | Recommended |
|------|---------|-------------|
| Mac | Apple Silicon (M1+) | M2+ with 16GB+ RAM |
| macOS | 14.2+ | Latest |
| RAM | 8GB (lighter models) | 16GB+ (full models) |
| Storage | 5GB (models) | 10GB+ |

## Model Recommendations (shared with GhostForge)

| RAM | Text Model | Vision Model | Notes |
|-----|-----------|-------------|-------|
| 8GB | llama3.2:3b | moondream | Lightest config |
| 16GB | llama3.2:3b | qwen2.5vl:3b | Default sweet spot |
| 24GB+ | qwen3:14b | qwen3-vl:8b | Best quality |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Clicky can't be opened" | Right-click → Open → Open (first launch only) |
| No voice response | Check Ollama is running: `ollama serve` |
| Blue cursor not appearing | Grant Screen Recording permission |
| Hotkey not working | Grant Accessibility permission |
| Models not loading | Run `ollama pull llama3.2:3b` + `ollama pull moondream` |

## Related Commands

- `/voice` — GhostForge JARVIS voice settings
- `/marketplace` — Browse all marketplace sources
- `/free-models` — Configure Ollama and other free AI providers
