# GhostForge AI Developer Toolkit for VS Code

GhostForge AI brings the GhostForge Developer Toolkit into VS Code with command-palette actions, context-aware editor shortcuts, a snippet sidebar, a commands sidebar, and an integrated terminal runner for the toolkit scripts.

## Features

- **Command Palette** access for GhostForge slash-command helpers
- **Editor context menu** actions for `.ts`, `.tsx`, and `.jsx` files
- **Snippet sidebar** that loads the shared `snippets/` library and inserts content at the cursor
- **Commands sidebar** that copies slash commands for Copilot Chat
- **Status bar launcher** with `⚡ GhostForge`
- **Integrated terminal runner** that executes GhostForge scripts in a reusable `GhostForge AI` terminal

## Installation

### Install from VSIX
1. Build the extension.
2. In VS Code, open **Extensions**.
3. Choose **Install from VSIX...**.
4. Select the generated `.vsix` file.

### Install from Marketplace
Once published, search for **GhostForge AI Developer Toolkit** in the VS Code Marketplace.

## Commands

| Command | Description |
|---|---|
| `GhostForge: Open Command Picker` | Opens the GhostForge quick picker. |
| `GhostForge: /context — Read current file as context` | Copies the active file and first 200 lines to the clipboard for Copilot Chat context. |
| `GhostForge: /rtl — RTL Audit (dry run)` | Runs the RTL audit script in the integrated terminal. |
| `GhostForge: /rtl --fix — RTL Auto-fix` | Runs the RTL fixer in the integrated terminal. |
| `GhostForge: /bundle — Bundle Analyzer` | Runs the bundle analyzer script. |
| `GhostForge: /health — Project Health Check` | Runs the project health script. |
| `GhostForge: /storybook — Generate Stories for this file` | Generates stories for the active file. |
| `GhostForge: /ticket — Scaffold from Ticket ID` | Prompts for a ticket ID and runs the scaffold script. |
| `GhostForge: /snippet — Insert Snippet at Cursor` | Opens the snippet picker and inserts the selected snippet. |
| `GhostForge: /commit — Generate Commit Message` | Opens Copilot Chat with `/commit`, or prints the prompt in the terminal. |
| `GhostForge: /review — Code Review` | Opens Copilot Chat with `/review`, or prints the prompt in the terminal. |
| `GhostForge: /test — Run Tests` | Opens Copilot Chat with `/test`, or prints the prompt in the terminal. |
| `GhostForge: /security — Security Audit` | Opens Copilot Chat with `/security`, or prints the prompt in the terminal. |
| `GhostForge: /optimize — Optimize Code` | Opens Copilot Chat with `/optimize`, or prints the prompt in the terminal. |
| `GhostForge: /docs — Generate Docs` | Opens Copilot Chat with `/docs`, or prints the prompt in the terminal. |
| `GhostForge: /i18n — i18n Translation Check` | Opens Copilot Chat with `/i18n`, or prints the prompt in the terminal. |
| `GhostForge: Refresh Snippets` | Reloads the snippet tree from disk. |

## Keyboard Shortcut

- `Cmd+Shift+E` on macOS / `Ctrl+Shift+E` on Windows/Linux → **GhostForge: Open Command Picker**

## Using the Snippet Sidebar

1. Open the **GhostForge AI** activity bar icon.
2. Expand **Snippets**.
3. Browse TypeScript and Markdown groups.
4. Click a snippet to insert it at the active cursor position.
5. Run **GhostForge: Refresh Snippets** after adding or updating snippet files.

## Using the Commands Sidebar

1. Open the **GhostForge AI** activity bar icon.
2. Expand **Commands**.
3. Click a command to copy the slash command name.
4. Paste it into Copilot Chat.

## Build from Source

```bash
cd extension
npm install
node esbuild.js
```

Optional checks:

```bash
npx tsc --noEmit
node esbuild.js --minify
```
