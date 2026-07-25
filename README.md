<div align="center">

# GhostForge JARVIS

**The AI-powered GitHub Copilot supercharger with a voice assistant that never sleeps.**

[![Release](https://img.shields.io/github/v/release/HishamAbulfeilat/GhostForge?style=flat-square)](https://github.com/HishamAbulfeilat/GhostForge/releases)
[![License](https://img.shields.io/github/license/HishamAbulfeilat/GhostForge?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/HishamAbulfeilat/GhostForge?style=flat-square)](https://github.com/HishamAbulfeilat/GhostForge/stargazers)

[Download](#download) · [Features](#features) · [Quick Start](#quick-start) · [Docs](#documentation) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is GhostForge?

GhostForge JARVIS is a desktop + web app that turns GitHub Copilot into a full AI development studio. Talk to JARVIS, let it write code, run tests, manage your workflow, and control your machine — all with voice.

## Download

| Platform | Install |
|----------|---------|
| macOS (Apple Silicon) | [Download DMG](https://github.com/HishamAbulfeilat/GhostForge/releases/latest/download/GhostForge%20JARVIS-5.3.0-arm64.dmg) |
| Windows | [Download Installer](https://github.com/HishamAbulfeilat/GhostForge/releases/latest/download/GhostForge%20JARVIS%20Setup%205.3.0.exe) |
| Linux | [Download AppImage](https://github.com/HishamAbulfeilat/GhostForge/releases/latest/download/GhostForge%20JARVIS-5.3.0-arm64.AppImage) |
| Source | [tar.gz](https://github.com/HishamAbulfeilat/GhostForge/releases/latest/download/GhostForge-5.3.0-source.tar.gz) · [zip](https://github.com/HishamAbulfeilat/GhostForge/releases/latest/download/GhostForge-5.3.0-source.zip) |

## Features

### Voice & AI
- **JARVIS Voice Assistant** — Say "Hey JARVIS" and talk naturally
- **7 TTS Engines** — Voicebox: Kokoro, Chatterbox, Qwen3-TTS, and more
- **Voice Cloning** — Clone any voice from seconds of audio
- **23 Languages** — English, Arabic, Japanese, and more
- **Gemini Live** — Real-time streaming voice with Google AI

### Development
- **250+ Files** — Full-featured dev environment
- **14 AI Agents** — Specialized agents for every task
- **70+ Commands** — /review, /fix, /test, /pentest, and more
- **Autonomous Agent** — Monitor issues, code, test, PR — 24/7
- **Clicky Vision** — AI sees your screen and guides your cursor

### Integrations
- **n8n Workflows** — Visual workflow automation
- **HuggingFace** — Browse and install 2M+ models
- **Email** — Gmail, Outlook, IMAP
- **Calendar** — Google Calendar, Outlook
- **AI Studio** — Manage your Google AI Studio apps

### Platform
- **Persistent Daemon** — JARVIS stays running when window closes
- **Self-Update** — JARVIS updates his own codebase
- **Cross-Platform** — macOS, Windows, Linux, Android

## Quick Start

```bash
# Clone
git clone https://github.com/HishamAbulfeilat/GhostForge.git
cd GhostForge

# Install
npm install

# Run (web UI)
cd web-ui && npm run dev

# Run (desktop)
cd electron-app && npm install && npm start

# Run (TUI)
node tui/index.js
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+M` | Memory panel |
| `Ctrl+A` | Agent panel |
| `Ctrl+/` | Model selector |
| `Ctrl+Shift+V` | Voice input |

## Architecture

```
GhostForge/
├── web-ui/          # Next.js 15 + Tailwind CSS
├── electron-app/    # Electron desktop app
├── mark-l-bridge/   # Python AI bridge (FastAPI)
├── tui/             # Terminal UI
└── .github/         # CI/CD workflows
```

## Tech Stack

**Frontend:** React 18, Next.js 15, TypeScript, Tailwind CSS  
**Desktop:** Electron 28, Capacitor (Android)  
**AI:** Ollama, Gemini, Voicebox, mem0, crewAI  
**Backend:** FastAPI, n8n, HuggingFace Hub

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

**Built with by GhostForge**

[Report Bug](https://github.com/HishamAbulfeilat/GhostForge/issues) · [Request Feature](https://github.com/HishamAbulfeilat/GhostForge/issues)

</div>
