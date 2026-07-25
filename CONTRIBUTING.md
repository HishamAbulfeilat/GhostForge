# Contributing to GhostForge

Thanks for your interest in contributing to GhostForge! This guide covers everything you need to get started.

---

## Architecture Overview

GhostForge is a monorepo with three main components:

| Component | Path | Stack | Purpose |
|-----------|------|-------|---------|
| **Web UI** | `web-ui/` | Next.js 15, React 18, TypeScript, Tailwind CSS | Main application — 33 pages, JARVIS interface, dashboard, terminal |
| **Electron App** | `electron-app/` | Electron, TypeScript | Desktop app — screen capture, voice control, Mac automation |
| **Mark-L Bridge** | `mark-l-bridge/` | Python 3.10+ | LLM orchestration, model routing, Ollama management |

Supporting directories: `commands/` (slash commands), `agents/` (AI agents), `instructions/` (Copilot instructions), `scripts/` (67 utility scripts), `plugins/`, `templates/`, `snippets/`.

---

## Development Setup

### Prerequisites

- **Node.js** 20+ (`node --version`)
- **Python** 3.10+ (`python3 --version`)
- **npm** 9+ (`npm --version`)
- **Git** (`git --version`)
- For Electron: macOS, Windows, or Linux with display server

### 1. Clone and Install

```bash
git clone https://github.com/HishamAbulfeilat/GhostForge.git
cd GhostForge

# Web UI
cd web-ui && npm install && cd ..

# Electron App
cd electron-app && npm install && cd ..

# Mark-L Bridge (Python)
cd mark-l-bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env with your API keys (Gemini, Grok, DeepSeek, etc.)
```

At minimum, set one AI provider key. For fully offline usage, install and start Ollama:

```bash
ollama pull qwen3.5:9b
```

### 3. Run Locally

**Web UI** (port 3001):
```bash
cd web-ui && npm run dev
```

**Electron Desktop**:
```bash
cd electron-app && npm start
```

**Mark-L Python Bridge**:
```bash
cd mark-l-bridge && ./start.sh
```

**All-in-one** (if scripts are set up):
```bash
npm run dev  # from project root
```

---

## Code Style

### TypeScript

- **Strict mode** is enabled — no `any` types unless absolutely necessary
- Use explicit return types on exported functions
- Prefer `interface` over `type` for object shapes
- Use `as const` for literal arrays/objects

### React / Next.js

- **Functional components only** — no class components
- Use hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, custom hooks)
- Extract reusable logic into custom hooks in `hooks/`
- Keep components in their own files — one component per file

### Tailwind CSS

- Use Tailwind utility classes — avoid custom CSS unless necessary
- Use `clsx()` or `cn()` for conditional class merging
- Follow the existing design tokens and color palette

### RTL / Arabic Support

RTL/Arabic support is a **first-class concern**. When building UI:

- Use **logical CSS properties** (`margin-inline-start` not `margin-left`)
- Use Tailwind's `rtl:` variant for directional overrides
- Test layouts with Arabic content — text should flow naturally
- Icons that imply direction (arrows, chevrons) should flip in RTL
- Form inputs, tables, and navigation must work correctly in both LTR and RTL

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

**Types:**
| Type | Use For |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code restructuring, no feature/fix |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling |
| `i18n` | Translations, RTL fixes |

**Scopes:** `web-ui`, `electron`, `mark-l`, `bridge`, `commands`, `agents`, `scripts`, `extension`, `tui`

**Examples:**
```
feat(web-ui): add RTL support for dashboard sidebar
fix(electron): resolve screen capture permission on macOS Sequoia
docs(commands): update /pentest usage examples
chore: bump electron from 28.0.0 to 29.0.0
```

---

## Pull Request Process

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature   # or fix/my-bug, docs/my-update
   ```
3. **Make your changes** following the code style above
4. **Test locally** — run the app and verify your changes work
5. **Commit** with a conventional commit message
6. **Push** and open a Pull Request against `main`

### PR Requirements

- [ ] Code compiles without errors (`tsc --noEmit` for TypeScript)
- [ ] No new console errors or warnings in browser/Electron
- [ ] RTL/Arabic layout tested if UI was changed
- [ ] New features have corresponding documentation updates
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains **what** changed and **why**
- [ ] If adding commands/agents: README.md and help.md updated

### Review Process

- All PRs require at least one review before merge
- CI checks must pass (lint, typecheck, build)
- Address review feedback with additional commits (don't force-push during review)
- Squash merge is preferred for clean history

---

## Testing

```bash
# Web UI — unit tests
cd web-ui && npm test

# Electron — lint
cd electron-app && npm run lint

# Type checking (web-ui)
cd web-ui && npx tsc --noEmit

# Full health check
node scripts/health.sh
```

When fixing a bug, add a regression test if one exists for that area. When adding a feature, include tests for the new logic.

---

## Adding a New Agent

See the existing agents in `agents/` for format reference. Create `agents/your-agent.md`:

```markdown
# Agent Name

**Role**: One-line description

## Capabilities
- What this agent can do

## Tech Stack
- Technologies used

## When to Use This Agent
- Use cases
```

Then update:
- `.github/copilot-instructions.md` — add to the agents table
- `README.md` — add to the agents list
- `commands/help.md` — add the activation command

---

## Adding a New Command

Create `commands/your-command.md` following the format in existing commands. Then:
1. Add to `.github/copilot-instructions.md` commands table
2. Add to `commands/help.md` quick reference
3. Update `README.md` if it's a major feature

---

## Issue Templates

We use structured issue templates:

- **Bug Report** — for reproducible bugs
- **Feature Request** — for new ideas and enhancements

Check existing issues before creating a new one. Use the appropriate template.

---

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). By participating, you agree to uphold our standards of behavior. Report unacceptable behavior to conduct@ghostforge.dev.

---

## Security

To report security vulnerabilities, see [SECURITY.md](SECURITY.md). **Do not** open public issues for security bugs.

---

## Questions?

- Open a [Discussion](https://github.com/HishamAbulfeilat/GhostForge/discussions)
- Check the [README](README.md) for feature documentation
- Run `ghostforge --help` for CLI reference
