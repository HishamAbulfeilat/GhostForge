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
- `install-commands.mjs` — shared platform resolver (see below)
- `custom-agents/` — your custom agent definitions
- `custom-models.json` — free and custom model providers

## Cross-platform install commands
`catalog.json` items use `install_command` for macOS/Linux (usually
`brew install X 2>/dev/null || sudo apt-get install -y X`, or a `go
install`/`pipx` fallback) and an optional `install_command_windows` for
Windows. `install-commands.mjs` picks between them, and both the TUI
(`tui/index.js`) and `scripts/marketplace.sh` call it so the two surfaces can
never disagree.

Rules to follow when adding an item:

- **WinGet commands must be exact matches** — `winget install --id Publisher.Id -e`.
  A bare `winget install nmap` can resolve to a different package.
- **Only add a Windows command you have verified.** When upstream has no native
  Windows build (LocalAI, OpenJarvis — which requires WSL2), leave
  `install_command_windows` off; the resolver then shows the item's `url` and a
  manual-install hint instead of running a POSIX one-liner.
- **A Windows command must run under cmd.exe.** No `python3`/`pip3` (use
  `python`/`pip` or `py -3`), no `&&`-chained post-install steps that depend on a
  just-installed binary being on `PATH`, no `$env:` PowerShell syntax.
- **Never end a command in `|| echo …`** — that exits 0 even when the install
  failed, so the TUI marked the item installed without installing it.

`tests/marketplace-install-commands.test.js` enforces all of the above and runs
as part of `npm test`.

## Related commands
- `/marketplace`
- `/generate`
- `/free-models`
