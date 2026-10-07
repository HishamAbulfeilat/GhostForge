# Changelog

## v5.3.2 — Cross-device studio and Job Hunter reliability

- Added a bundled, responsive Studio connection screen with direct access to
  Job Hunter, dashboard, agents, marketplace and settings. Desktop restores
  the saved server address; Android opens the full studio in the browser.
- Fixed Windows-incompatible development commands and macOS Bash 3/path
  compatibility; synchronized desktop and Android release versions.
- Job Hunter now refreshes status/progress, rejects overlapping operations
  per application, and keeps partially answered questions in Needs you.
- AI outages still produce clearly labelled original-CV drafts requiring
  manual approval; tailored CVs are uploaded as DOCX. Ollama now receives
  prompt-based CV/job requests rather than just the system instruction.
- Release builds now gate publication on web tests, production build/audit,
  desktop runtime tests and successful Windows/macOS/Linux/Android packaging.
- Updated vulnerable production dependencies without forced major upgrades.

Clients require a running authenticated studio server for full features.
Android automation executes on the server; native desktop hardware features
are not Android features. Unsigned desktop installers can trigger OS warnings,
and Android needs a stable signing keystore for reliable upgrade installs.
Moderate CV-parser dependency advisories remain; no real job applications
were submitted during verification.

## v5.3.0 — 2026-07-25

### 🧠 Full Mark-L Integration (29/29 Features)
- Cloned [FatihMakes/Mark-L](https://github.com/FatihMakes/Mark-L) and integrated all Python action modules
- Created FastAPI Python bridge server (`mark-l-bridge/`) exposing 93 Mark-L endpoints
- **New: YouTube Control** — search, play, transcript extraction, video info, trending, summarize
- **New: Game Updater** — scan Steam/Epic libraries, check updates, trigger game updates
- **New: Clipboard Intelligence** — clipboard watcher, AI analysis (translate/summarize/fix/explain), history
- **New: Auto-Start on Boot** — macOS LaunchAgent, Windows registry, Linux .desktop autostart
- **New: Setup Wizard** — guided first-run config (API key, voice, language, name, auto-start)
- **New: Browser Automation** — Playwright integration with fallback to system browser
- **New: File Processor** — AI-powered summarization, multi-format support (PDF/DOCX/XLSX/CSV/code)
- **New: Hardware Monitor** — cross-platform CPU/RAM/disk/GPU/fan stats with 5s cache
- **Enhanced: System Control** — brightness, WiFi toggle, Bluetooth, sleep/restart/shutdown, battery, screenshot
- **Enhanced: Hardware Monitoring** — GPU stats (macOS system_profiler, Linux nvidia-smi), fan RPM
- All 226 IPC handlers wired into Electron + JARVIS API tools
- Python bridge auto-starts when JARVIS launches, falls back gracefully when unavailable

### Feature Parity Audit: Mark-L vs GhostForge JARVIS
| Status | Count | Features |
|--------|-------|----------|
| ✅ Fully Implemented | 27 | Autonomous Tasks, Visual Awareness, Persistent Memory, Morning Briefing, Proactive 2.0, Session Memory, Background Monitoring, Weather Report, Multi-Mode Web Search, Smart Reminders, Code Helper, Send Message, Desktop Control, Silent Language Memory, Remote Dashboard, YouTube Control, Game Updater, Clipboard Intelligence, Auto-Start, Setup Wizard, Browser Automation, File Processor, Hardware Monitor, System Control, Python Bridge, 29/29 Mark-L Features |
| ✅ Fully Implemented | 2 | Real-time Voice (Gemini Live streaming stub), Flight Finder (URL-only) |

## v5.2.0 — 2026-07-25

### 🖱️ Clicky + JARVIS Integration
- Unified 3 Clicky variants (original, LocalClicky, clicky-local) into one marketplace entry
- Added blue cursor overlay with animated flying cursor and crosshair
- Screen capture system with cross-platform support (macOS/Windows/Linux)
- Vision AI integration: Ollama moondream → Gemini → OpenRouter VL fallback
- Clicky tools: `point_cursor`, `highlight_area`, `understand_screen`, `find_element`, `read_text_on_screen`
- Quick actions: Understand Screen, Find Button, Read Screen

### 🎤 Voice Fixes (8 Bugs Fixed)
- Fixed mode/mic stuck when `requiresConfirmation` in SSE streaming path
- Fixed mode stuck at thinking when `done` event arrives with `currentTool` truthy
- Fixed `startListening()` to kill browser TTS + external HTMLAudioElement
- Fixed wake listener restart race with `wakeJustDetectedRef` flag
- Fixed `resumeMic` to check `modeRef.current !== 'idle'` before restarting
- Fixed `speak()` to use `speakingRef` lock and stop current audio first
- Removed redundant `setMode('idle')` + `resumeMic()` after error handler
- Added `startAudioAnalyser()` / `stopAudioAnalyser()` with 60fps mic visualization

### 🖥️ Desktop App (Electron)
- Created Electron app shell wrapping GhostForge web UI
- Cross-platform screen capture (macOS screencapture, PowerShell, Linux scrot)
- Blue cursor overlay via transparent always-on-top BrowserWindow
- System tray with status display and quick actions
- Global shortcuts: Ctrl+Alt+V (push-to-talk), Ctrl+Alt+C (capture), Ctrl+Alt+J (toggle)
- System control: open apps, lock screen, volume, process management
- macOS entitlements for microphone, screen recording, network

### 🧠 Mark-L Inspired Systems
- Persistent memory system (`JarvisMemory`) — projects, preferences, facts, sessions
- Proactive check-in system (`JarvisProactive`) — time-aware suggestions, topic monitoring
- Morning briefing with weather, news, yesterday recap, today plan
- Session summaries with topic extraction and message history
- OS-native reminders with recurring support
- Gemini Live API integration point for always-on voice

### ⚙️ n8n Workflow Integration
- Docker Compose for n8n + Ollama
- JARVIS → n8n webhook triggers for deploy, notify, PR workflows
- Built-in workflow templates: ghostforge-deploy, ghostforge-notify, ghostforge-pr
- MCP support for AI agent tool integration

### 📱 Cross-Platform Builds
- Capacitor config for Android (.apk) builds
- Build script: `./build.sh [mac|win|linux|android|all]`
- Electron Builder configs for macOS (.dmg/.zip), Windows (.exe), Linux (.AppImage/.deb/.rpm)
- Android via Capacitor with camera, microphone, screen reader permissions

### 📝 Documentation
- Comprehensive open source credits section (50+ projects)
- Updated Clicky section with unified architecture
- Updated README with cross-platform build instructions

---

## v2.7.1 — 2026-07-16

9e35d33 docs: update README for v2.7.0
0d36eb4 feat(tui): add VS Code extension install screen

---



## v2.7.0 — 2026-07-16

f182873 feat: add ghostforge VS Code extension (v2.6.0)

---



## v2.6.0 — 2026-07-16

e8d84fc feat: add context, snippet library, RTL audit, storybook gen, ticket scaffold, bundle analyzer, project templates
54bbc9f fix: add persist-credentials: false to prevent GITHUB_TOKEN overriding MIRROR_TOKEN
d6edacd debug: check token scopes and repo access in CI
2a16330 debug: add token identity check to mirror workflow
2ae4d0a fix: strip whitespace from MIRROR_TOKEN before use in credential store
ade9b01 fix: use x-access-token format with credential store for mirror push
5e8b34c fix: use git credential store for mirror auth instead of URL embedding
0e2913c fix: use username:token format for fine-grained PAT mirror push
a899e81 fix: use git url rewrite for mirror push instead of gh auth (avoids read:org scope requirement)
497bf53 fix: use gh auth setup-git for mirror push (supports fine-grained PATs)
180ebd6 ci: add workflow_dispatch to mirror workflow for manual testing
77b0d60 fix: simplify sync-models.yml to avoid YAML parse error in commit step
f309a54 fix: resolve all failing GitHub Actions workflows

---



## v2.5.0 — 2026-07-16

452d188 feat: optimize toolkit for real GhostForge project stack
fb85adc ci: add mirror workflow to HishamAbulfeilat/GhostForge-Tool
f9b43a2 feat: marketplace, generator, free models (v2.4.0)

---



## v2.4.0 — 2026-07-16

0dc10d2 feat: add react.doctor integration (v2.3.0)

---



## v2.3.0 — 2026-07-15

b65f825 feat: v2.2.0 — MCP server, Spaces, 8 new commands

---



## v2.2.0 — 2026-07-15

- Added a full MCP server with health, tickets, model, security, and snippet tools
- Added Copilot Spaces setup assets plus shared Space context
- Added new slash commands: /migrate, /estimate, /tech-debt, /explain-codebase, /notify, /a11y
- Added a team knowledge base and wired key files into VS Code Copilot instructions
- Added Slack/Teams webhook notifications and branch-aware model selection

---

## v2.1.0 — 2026-07-15

Initial release

---



## v2.0.0 — 2026-07-15

- Initial GhostForge Developer Toolkit release
- Terminal UI launcher with setup, project open, commands, agents, instructions, tickets, security, test, deploy, readme, version, and help screens
- 14 specialized AI agents for frontend, mobile, backend, DevOps, QA, security, data, CMS, and architecture workflows
- 27 slash command documents covering setup, scaffolding, testing, security, tickets, deployment, SQL, Storybook, i18n, and release workflows
- Project onboarding scripts for new and existing repositories, toolkit syncing, environment setup, version bumping, and Azure deployment
- Copilot instruction packs for React, React Native, Next.js, TypeScript, Tailwind, Azure, Docker, SQL reporting, testing strategy, and team workflow standards
- GitHub Copilot workspace integration via .github and .vscode settings plus cloud-agent setup steps

---
