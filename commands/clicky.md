# /clicky Command

## Purpose

Install, configure, and manage **Clicky** — a unified AI cursor buddy that sees your screen, talks to you, and points at things. Combines the best of three open-source variants into one tool. Integrates with GhostForge's JARVIS voice + Mac control for a complete local AI assistant experience.

## Usage
```bash
/clicky                          # Show Clicky status + install options
/clicky install                  # Install Clicky (local mode — fully offline)
/clicky install cloud            # Install Clicky (cloud mode — requires API keys)
/clicky status                   # Check if Clicky + Ollama are running
/clicky models                   # List available Ollama models for Clicky
/clicky setup                    # Walk through initial setup + permissions
/clicky share-ollama             # Share GhostForge's Ollama models with Clicky
```

## What Clicky Is

Clicky is a menu-bar AI assistant for macOS that:
- **Sees your screen** — captures screenshots and understands them via vision AI
- **Points at things** — a blue cursor overlay flies to the exact UI element you asked about
- **Talks to you** — voice responses via TTS (Apple Speech, Piper, Kokoro, or ElevenLabs)
- **Listens to you** — push-to-talk (Control+Option) with STT (Apple Speech, WhisperKit, or AssemblyAI)
- **Takes action** — opens apps, URLs, copies text, and more

## Modes

| Mode | Cloud? | Vision | STT | TTS | Best For |
|------|--------|--------|-----|-----|----------|
| **Local** (default) | No — 100% offline | Ollama (moondream) | Apple Speech / WhisperKit | Neural Piper / Kokoro / AVSpeech | Privacy, no cost |
| **Cloud** | Yes — requires API keys | Claude | AssemblyAI | ElevenLabs | Highest quality |

## Install

```bash
# Local mode (recommended — no API keys needed)
curl -fsSL https://raw.githubusercontent.com/tanavc1/LocalClicky/main/scripts/web-install.sh | bash

# Or via GhostForge
/clicky install
```

## How It Integrates with GhostForge

Clicky and GhostForge share the same local AI stack:

```
GhostForge JARVIS              Clicky
├── Ollama LLM                 ├── Ollama LLM (same models)
├── Voice (Fish Audio)         ├── Voice (Apple/Piper/Kokoro)
├── Mac Control                ├── Blue cursor pointing
├── Screen Capture             ├── Screen capture
└── Web UI                     └── Menu bar overlay
```

**Shared Ollama models** — both use `http://localhost:11434` (Ollama default). Same models serve both tools, no duplication.

**Combined workflow:**
1. Clicky handles push-to-talk, screen pointing, quick visual answers
2. GhostForge JARVIS handles complex tasks, code generation, Mac automation
3. Both share the same local AI brain (Ollama)

## Quick Start

```bash
# 1. Ensure Ollama is running (GhostForge already sets this up)
ollama serve &

# 2. Install Clicky (local mode)
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

## Credits & Attribution

Clicky is built on three open-source projects. This unified integration combines their best features:

| Project | Author | What It Contributed |
|---------|--------|-------------------|
| **[Clicky](https://github.com/farzaa/clicky)** (7.2k+ stars) | [Farza](https://github.com/farzaa) | Original concept, UI, blue cursor overlay, push-to-talk architecture |
| **[LocalClicky](https://github.com/tanavc1/LocalClicky)** | [tanavc1](https://github.com/tanavc1) | Fully local rebuild — Ollama vision, Apple Speech, Neural Piper TTS, one-line install |
| **[clicky-local](https://github.com/coldiary/clicky-local)** | [coldiary](https://github.com/coldiary) | WhisperKit on-device STT, Kokoro-FastAPI TTS, configurable backends |

## Related Commands

- `/voice` — GhostForge JARVIS voice settings
- `/marketplace` — Browse all marketplace sources
- `/free-models` — Configure Ollama and other free AI providers
