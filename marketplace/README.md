# Marketplace

Use `/marketplace` in Copilot Chat or the GhostForge TUI to browse trusted extensions.

## What you can do
- Browse curated agents, skills, templates, and model-backed items
- Install catalog items with built-in install commands
- Discover community sources like aitmpl.com and GitHub topic collections
- Track installed items in `marketplace/registry.json`
- Add your own custom agents and models

## Files
- `sources.json` — trusted source registry
- `catalog.json` — local catalog cache
- `registry.json` — installed/custom item tracker
- `custom-agents/` — your custom agent definitions
- `custom-models.json` — free and custom model providers

## Cross-platform install commands
`catalog.json` items use `install_command` for macOS/Linux (usually
`brew install X 2>/dev/null || sudo apt-get install -y X`, or a `go
install`/`curl | sh` fallback). Add an optional `install_command_windows`
(a `winget install --id ...` command) for items that have a verified WinGet
package; the TUI (`tui/index.js`) picks it automatically on `win32`. Items
without a Windows command still show the macOS/Linux one with a manual-install
hint.

## Related commands
- `/marketplace`
- `/generate`
- `/free-models`
