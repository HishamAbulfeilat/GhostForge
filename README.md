<div align="center">

# GhostForge JARVIS

**The AI-powered GitHub Copilot supercharger with a voice assistant that never sleeps.**

[![Release](https://img.shields.io/github/v/release/HishamAbulfeilat/GhostForge?style=flat-square)](https://github.com/HishamAbulfeilat/GhostForge/releases)
[![License](https://img.shields.io/github/license/HishamAbulfeilat/GhostForge?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/HishamAbulfeilat/GhostForge?style=flat-square)](https://github.com/HishamAbulfeilat/GhostForge/stargazers)

[Download](#download) · [Features](#features) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Docs](#documentation) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is GhostForge?

GhostForge JARVIS is a desktop + web app that turns GitHub Copilot into a full AI development studio. Talk to JARVIS, let it write code, run tests, manage your workflow, and control your machine — all with voice.

## Download

| Platform | Install |
|----------|---------|
| macOS (Apple Silicon) | [Download DMG](https://github.com/HishamAbulfeilat/GhostForge/releases/latest) |
| Windows | [Download Installer](https://github.com/HishamAbulfeilat/GhostForge/releases/latest) |
| Linux | [Download AppImage](https://github.com/HishamAbulfeilat/GhostForge/releases/latest) |
| Source | [tar.gz](https://github.com/HishamAbulfeilat/GhostForge/releases/latest) · [zip](https://github.com/HishamAbulfeilat/GhostForge/releases/latest) |

## Features

### Voice & AI
- **JARVIS Voice Assistant** — "Hey JARVIS" always-listening wake word and natural voice control
- **7 TTS Engines** — Voicebox: Kokoro, Chatterbox, LuxTTS, Qwen3-TTS, HumeAI TADA, Piper, Edge TTS
- **Voice Cloning** — Clone a voice from a short reference clip and reuse it as a profile
- **24 Languages** — English, Arabic, Japanese, Russian, Hindi, and more
- **Gemini Live** — Real-time streaming voice via Mark-LV in the bridge

### Development
- **525 first-party source files** — Full-featured dev environment (web, desktop, TUI, bridge, MCP)
- **15 AI Agents** — Specialized agents for every task (`agents/`), plus 23 installable ones in the Marketplace
- **97 Commands** — `/review`, `/test`, `/pentest`, `/autopilot`, `/clicky`, and more (`commands/`)
- **Autopilot Mode** — `/autopilot` runs commands end to end without pausing to ask
- **Clicky Vision** — AI sees your screen and points at what it means (`/clicky`)
- **Autonomous Agent Team** — A supervisor boss assigns board tasks, reviews commits, and merges approved work ([guide](docs/AGENT-TEAMS.md))

### Integrations
- **n8n Workflows** — Visual workflow automation, with shipped agent, deploy, and PR workflows
- **HuggingFace** — Browse and install 2M+ models (`ghostforge models`)
- **Email & Calendar** — JARVIS reads and writes mail and events through the GhostForge API service
- **Google AI Studio** — List, update, test, and compare AI Studio apps
- **AI Bridge (Mark-LV + OpenJarvis)** — One FastAPI service (`mark-l-bridge/`, `:8765`) unifying real-time Gemini Live voice, screen/webcam vision, and computer control (Mark-LV) with a local-first, Ollama-backed agent runtime (OpenJarvis, opt-in) — see `mark-l-bridge/README.md`
- **Marketplace** — Browse, install, and track agents, skills, tools, and templates via `/marketplace`; see `marketplace/README.md`
- **Job Hunter** — Find CV-matched jobs, tailor a CV and cover letter, and apply with one approval (`/job-hunter`, web `/jobs`, CLI `ghostforge jobs`)

### Platform
- **Persistent Daemon** — JARVIS stays running when the window closes
- **Self-Update** — JARVIS updates his own codebase
- **Cross-Platform** — macOS, Windows, Linux, Android
- **MCP Server** — `node mcp/index.js` exposes GhostForge tools to any MCP client

## Quick Start

```bash
# Clone
git clone https://github.com/HishamAbulfeilat/GhostForge.git
cd GhostForge

# Install
npm install

# Run (web UI)
cd web-ui && npm install && npm run dev

# Run (desktop)
cd electron-app && npm install && npm start

# Run (TUI)
node tui/index.js
```

### AI bridge

JARVIS voice, vision and computer control run on a separate Python bridge. The
other surfaces work without it; start it when you want the JARVIS tools.

```bash
cd mark-l-bridge && ./start.sh   # serves on 127.0.0.1:8765
```

Mark-LV is vendored under `vendor/mark-liv` (CC BY-NC 4.0). OpenJarvis is opt-in
and installed on demand (Apache-2.0) — the bridge answers `/api/openjarvis/*`
with a "not installed" stub until its `jarvis` CLI is on `PATH`. See
`mark-l-bridge/README.md`.

> Not to be confused with `ghostforge bridge`, the Node command server on
> `:4747` that lets the web UI run commands on your machine.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+K` | Command palette |
| `Ctrl+Alt+V` | Push-to-talk (JARVIS voice) |
| `Ctrl/Cmd+S` | Save file (Files editor) |

## Architecture

```
GhostForge/
├── web-ui/          # Next.js 15 + Tailwind CSS
├── electron-app/    # Electron desktop app (+ Capacitor for Android/iOS)
├── mark-l-bridge/   # Python AI bridge (FastAPI) — Mark-LV + OpenJarvis
├── tui/             # Terminal UI
├── cli/             # `ghostforge <command>` CLI
├── mcp/             # GhostForge's own MCP server
├── marketplace/     # Agent/skill/tool catalog + install registry
├── agents/          # 15 AI agent definitions
├── commands/        # 97 slash-command definitions
├── voice-pipeline/  # Wake word, STT and local TTS
├── vendor/mark-liv/ # Vendored Mark-LV (CC BY-NC 4.0)
└── .github/         # CI/CD workflows
```

Two things called "bridge" exist: `mark-l-bridge/` is the Python AI service on
`:8765`; `ghostforge bridge` is the Node command server on `:4747`.

## Documentation

- [Agent teams](docs/AGENT-TEAMS.md) — setup, lifecycle controls, templates,
  provider/model routing, permissions, and local-runtime limitations
- [Multi-agent workflow](docs/MULTI-AGENT-WORKFLOW.md) — how the boss, workers
  and worktrees fit together
- [Feature matrix](docs/FEATURE-MATRIX.md) — every surface and what it does
- [Bridge reference](mark-l-bridge/README.md) — every endpoint the bridge exposes
- [Marketplace](marketplace/README.md) — catalog and install registry

## Tech Stack

**Frontend:** React 18, Next.js 15, TypeScript, Tailwind CSS  
**Desktop:** Electron 44, Capacitor 8 (Android/iOS)  
**AI:** Mark-LV (Gemini Live voice + vision), OpenJarvis (local agent runtime), Ollama, Voicebox, mem0, crewAI  
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
