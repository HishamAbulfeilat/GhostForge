# 🚀 GhostForge AI Developer Toolkit — v3.0.0

The official AI toolkit for **GhostForge** developers. Supercharges GitHub Copilot with deep knowledge of your entire tech stack — frontend web, mobile, backend, CMS, DevOps, QA, security, SQL/ETL, AI integration, and more.

**230+ files · 14 agents · 60 commands · 35 scripts · 24 instruction files · MCP server · React Doctor · Marketplace · Agent Skills · Developer Dashboard (7 panels) · Snippet Library · VS Code Extension + `@ghostforge` Chat · Terminal UI (`ghostforge-ai`) · Voice Features · PR Auto-Check**

---

## 📋 Table of Contents

1. [Quick Start](#-quick-start)
2. [@ghostforge GitHub Copilot Extension](#-ghostforge-github-copilot-extension)
3. [MCP Server](#-mcp-server)
4. [React Doctor — React Health Scanner](#-react-doctor--react-health-scanner)
5. [Terminal UI — `ghostforge-ai`](#-terminal-ui----ghostforge-ai)
6. [Marketplace, Generators & Free Models](#-marketplace-generators--free-models)
7. [VS Code Extension](#-vs-code-extension)
8. [Snippet Library](#-snippet-library)
9. [Project Templates](#️-project-templates)
10. [How Copilot Reads Files Automatically](#-how-copilot-reads-files-automatically)
11. [Setup a New Project](#️-setup-a-new-project)
12. [AI Conversation Mode](#-ai-conversation-mode)
13. [Commands Reference](#-commands-reference)
14. [Operating Modes](#️-operating-modes)
15. [Agents & Role Switching](#-agents--role-switching)
16. [GitHub & Azure Integration](#-github--azure-integration)
17. [Team Knowledge Base](#-team-knowledge-base)
18. [Copilot Spaces](#-copilot-spaces)
19. [Model Auto-Selection](#-model-auto-selection)
20. [Folder Structure](#-folder-structure)
21. [SDLC & Security Standards](#️-sdlc--security-standards)
22. [Team Setup & Updates](#-team-setup--updates)
23. [Contributing](#-contributing)

---

## ⚡ Quick Start

```bash
# 1. Clone the toolkit
git clone https://github.com/HishamAbulfeilat/GhostForge.git ~/ghostforge-agents

# 2. Install VS Code extensions
bash ~/ghostforge-agents/scripts/setup-env.sh

# 3a. Launch the Terminal UI  ← recommended!
~/ghostforge-agents/ghostforge-ai

# 3b. OR start a new project directly
bash ~/ghostforge-agents/scripts/create-project.sh

# 3c. OR add toolkit to an existing project
bash ~/ghostforge-agents/scripts/copy-to-project.sh /path/to/your/project

# 4. Open in VS Code — Copilot is instantly powered up
code /your/project
```

### 3 Ways to Use the Toolkit

| Method | How | Best For |
|--------|-----|----------|
| **Terminal UI** | `~/ghostforge-agents/ghostforge-ai` | Visual, menu-driven — all features at a glance |
| **Copilot Chat** | Type `/command` in VS Code (`Cmd+Shift+I`) | AI code generation & assistance |
| **VS Code Extension** | `Cmd+Shift+E` or click "⚡ GhostForge" in status bar | Right-click menus, snippet insert, command picker |
| **Shell Scripts** | `bash scripts/create-project.sh` | Automated project scaffolding |

---

## 🤖 @ghostforge GitHub Copilot Extension

`@ghostforge` is a hosted GitHub Copilot Extension server in `extension/` that brings the GhostForge toolkit into Copilot Chat on **VS Code**, **GitHub.com**, and **GitHub Mobile**. It deploys cleanly to **Vercel**, can stay **private for GhostForge only** or be prepared for a **public Marketplace rollout**, and does **not** replace the existing local toolkit.

- **Setup guide:** [`EXTENSION_SETUP.md`](./EXTENSION_SETUP.md)
- **Hosted usage:** `@ghostforge /help`, `@ghostforge /health`, `@ghostforge /tickets`, `@ghostforge /security`, `@ghostforge /review`, `@ghostforge /deploy`, `@ghostforge /optimize`
- **Full command catalog:** `/setup`, `/create`, `/open`, `/scaffold`, `/add-feature`, `/migrate`, `/estimate`, `/tech-debt`, `/explain-codebase`, `/health`, `/doctor`, `/marketplace`, `/generate`, `/free-models`, `/help`, `/docs`, `/snippet`, `/onboard`, `/optimize`, `/perf`, `/lint`, `/explain-error`, `/diagram`, `/security`, `/test`, `/a11y`, `/qa`, `/review`, `/tickets`, `/fix-tickets`, `/deploy`, `/release`, `/sql`, `/mock`, `/i18n`, `/storybook`, `/notify`, `/commit`, `/pr-description`, `/upgrade`, `/env`, `/model`, `/autopilot`, `/safe`, `/dashboard`, `/api-types`, `/changelog`, `/env-check`, `/unused`, `/git-hooks`, `/skills`, `/rtl`, `/bundle`, `/context`, `/ticket`
- **Local toolkit stays independent:** `ghostforge-ai`, `scripts/`, copied `.github/` instructions, and existing project flows continue to work exactly as before

---

## 🔌 MCP Server

The toolkit includes a first-party MCP server in [`mcp/`](./mcp) so GitHub Copilot can call GhostForge tools directly over the Model Context Protocol.

### Available MCP tools
- `health_check(projectPath)`
- `get_tickets(provider, repo, owner)`
- `fix_ticket(provider, repo, owner, issueNumber)`
- `list_models(tier?)`
- `get_best_model(taskType)`
- `security_scan(projectPath)`
- `list_snippets()`
- `get_snippet(name)`

### Quick setup
```bash
cd ~/ghostforge-agents/mcp
npm install
```

VS Code MCP config is included in `.vscode/mcp.json`, and the full setup guide lives in [`mcp/README.md`](./mcp/README.md).

---

## ⚕️ React Doctor — React Health Scanner

**React Doctor** (`npx react-doctor@latest`) is the official React health tool integrated into GhostForge's toolkit. It scores React codebases from **0-100** across security, performance, correctness, accessibility, bundle size, and architecture — and teaches GitHub Copilot to self-correct React issues mid-session.

### What it checks
| Category | Examples |
|---|---|
| 🔒 Security | `dangerouslySetInnerHTML`, eval, unescaped user input |
| ⚡ Performance | Missing memo/useCallback, large imports, render bottlenecks |
| ✅ Correctness | Stale closures, bad effect deps, missing keys |
| ♿ Accessibility | Missing ARIA, tab order, alt text, color contrast |
| 📦 Bundle Size | Heavy dependencies, unoptimised images, dead code |
| 🏛️ Architecture | Component coupling, prop drilling, circular imports |

### Using React Doctor

```bash
# Before committing — check only introduced issues
npx react-doctor@latest --verbose --scope changed

# Full codebase scan
npx react-doctor@latest --verbose

# Single category deep-dive
npx react-doctor@latest --verbose --category Performance

# In Copilot Chat — full AI-guided triage loop
/doctor
```

### GhostForge Score Targets
| Phase | Minimum Score |
|---|---|
| Development | 60 |
| PR merge | 75 |
| Production release | 85 |

### CI / GitHub Actions
React Doctor is pre-configured at `.github/workflows/react-doctor.yml` — it runs on every PR, posts a sticky summary comment with the health score, adds inline review comments, and creates a commit status badge. To block PRs that introduce errors, uncomment `blocking: error` in the workflow file.

### Install in a project
```bash
# Install CI workflow + coding agent skill for all detected agents
npx react-doctor@latest ci install
npx react-doctor@latest install --yes
```

The skill is already installed for **GitHub Copilot**, **Claude Code**, **Continue**, **Cline**, and **Pi** in this toolkit at `.copilot/skills/react-doctor/`, `.claude/skills/react-doctor/`, and `.continue/skills/react-doctor/`.

> **Docs:** https://www.react.doctor

---

## 🖥 Terminal UI — `ghostforge-ai`

A clean, interactive terminal dashboard for the entire toolkit. Browse commands, switch agents, run tests, deploy, manage tickets — all from a beautiful menu without memorizing anything.

### Launch

```bash
# Recommended: run from anywhere
~/ghostforge-agents/ghostforge-ai

# CLI flags
~/ghostforge-agents/ghostforge-ai --version
~/ghostforge-agents/ghostforge-ai --command health
~/ghostforge-agents/ghostforge-ai --open /path/to/project
~/ghostforge-agents/ghostforge-ai --digest
```

### Add a Shell Alias (Recommended)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
alias ghostforge-ai='node ~/ghostforge-agents/tui/index.js'
```

### TUI Screens

| Screen | What it does |
|--------|-------------|
| 📊 **Developer Dashboard** | Real-time: tickets assigned to you, CI/CD pipeline, health charts, releases, activity feed |
| 🚀 **New Project Setup** | AI mode (describe your app) or 14-step wizard |
| 🗂 **Manage Projects** | Track registered projects, open them, and sync toolkit updates |
| 💊 **Project Health Check** | Score across security, deps, coverage, bundle, tickets, lint + health badge |
| ⚡ **Run a Command** | Browse all 55 slash commands by category, read full docs |
| 🤖 **Switch Agent / Role** | View all 14 agents, copy their activation prompt |
| 📚 **Browse Instructions** | Read the instruction packs, knowledge base, and team docs inline |
| 📋 **Snippet Library** | Browse 11 ready-made code snippets — click to copy or insert at cursor |
| 🔍 **Bundle Analyzer** | Detect heavy deps, lazy-loading opportunities, bundle size |
| 🌐 **RTL Audit** | Find non-logical Tailwind classes, auto-fix `ml-`/`mr-` → `ms-`/`me-` |
| 🔑 **/api-types** | Fetch OpenAPI/Swagger spec → generate TypeScript types + service file |
| 📝 **/changelog** | Auto-generate CHANGELOG.md from Conventional Commits |
| 🔒 **/env-check** | Compare `.env` vs `.env.example` — flag missing/exposed secrets |
| 🧹 **/unused** | Find dead code with knip (unused files, exports, dependencies) |
| 🪝 **/git-hooks** | Install Husky + lint-staged + commitlint in one command |
| 🎫 **Tickets & Issues** | Live fetch from GitHub Issues / Azure DevOps / Jira by priority |
| 🔒 **Security Audit** | Run `npm audit`, scan secrets, get OWASP checklist |
| 🧪 **Run Tests** | Auto-detect Jest / Vitest / Playwright / Detox and execute |
| 🚀 **Deploy** | Guided deploy to Azure / Vercel / GitHub Pages |
| 🌅 **Daily Digest** | Morning summary for tickets, security, dependency drift, git, and health |
| 📄 **README / Docs** | Read full documentation without leaving the terminal |
| 🏪 **Marketplace** | Browse/install catalog items, agents, and Claude Agent Skills |
| 🎓 **Agent Skills** | Anthropic official, SkillsMP 2M+, Claude-Flow, Awesome Claude Skills |
| ⚡ **Generate New** | Create a new agent, command, skill, instruction, or plugin |
| 🆓 **Free Models** | Configure NVIDIA, Groq, Ollama, HuggingFace, and more |
| 🧩 **Install VS Code Extension** | One-click install + auto-rebuild of `ghostforge-ai.vsix` into VS Code |
| ❓ **Help** | Quick reference for all commands and agents |

### Requirements
- Node.js 18+ (`node --version`)
- macOS / Linux / WSL

---

## 🏪 Marketplace, Generators & Free Models

The toolkit now includes a lightweight marketplace layer for discoverability and extension management.

### Marketplace
- Browse trusted sources from `marketplace/sources.json`
- Review the local catalog in `marketplace/catalog.json`
- Track custom and installed items in `marketplace/registry.json`
- Open **aitmpl.com** directly from the TUI or `scripts/marketplace.sh`

### 🎓 Claude Agent Skills

Browse and install AI agent skills from 6 trusted sources:

| Source | Skills | Install |
|---|---|---|
| **Anthropic Official** | docx, pdf, pptx, xlsx, web-test, MCP gen | `/plugin marketplace add anthropics/skills` in Claude Code |
| **SkillsMP** | 2M+ community skills, free REST API | `bash scripts/skills.sh search <query>` |
| **Claude-Flow** | Hive-mind swarm, 87 MCP tools, 84.8% SWE-Bench | `npx claude-flow@alpha init --force` |
| **Awesome Claude Skills** | Curated free directory | https://awesomeclaude.ai/awesome-claude-skills |
| **Agent Skills Standard** | Spec: SKILL.md format | https://agentskills.io/home |
| **Skills Collection 2026** | Community + official index | https://github.com/obviousworks/Claude-AI-skills-collection-2026 |

```bash
bash ~/ghostforge-agents/scripts/skills.sh              # overview + sources
bash ~/ghostforge-agents/scripts/skills.sh list         # installed skills
bash ~/ghostforge-agents/scripts/skills.sh search react # search SkillsMP
bash ~/ghostforge-agents/scripts/skills.sh claude-flow  # install Claude-Flow
```

### Generate New
Create your own toolkit assets with:
```bash
/generate
bash ~/ghostforge-agents/scripts/generate.sh
```

Supported outputs:
- `marketplace/custom-agents/*.md`
- `marketplace/custom-commands/*.md`
- `.copilot/skills/*/SKILL.md`
- `instructions/custom-*.md`
- `plugins/*`

### Free Models
Use `/free-models` or `bash scripts/free-models.sh` to configure:
- NVIDIA NIM
- Groq
- Ollama
- HuggingFace
- Together AI
- Cerebras
- OpenRouter

Credentials are stored in `.env.local`, and custom providers live in `marketplace/custom-models.json`.

---

## 📊 Developer Dashboard

A real-time, full-screen terminal dashboard with 6 live panels:

```
┌────────────────────────────────────────────────────────────┐
│  ⚡ GHOSTFORGE DEVELOPER DASHBOARD  │ user │ 18:26 │ [R] [Q]   │
├──────────────────┬─────────────────┬──────────────────────  ┤
│ 📋 MY TICKETS   │ 🏗 PIPELINE      │ 📊 HEALTH BAR         │
│ GitHub Issues   │ Actions runs     │ per-project scores    │
│ assigned to @me │ last 12 workflows│ 0–100 bar chart       │
├──────────────────┼─────────────────┼──────────────────────  ┤
│ 🚀 RELEASES     │ 📈 HEALTH TREND  │ 🔥 ACTIVITY FEED      │
│ git tags + dates│ line chart over  │ git log --oneline     │
│ + release msg   │ version history  │ last 20 commits       │
└──────────────────┴─────────────────┴──────────────────────  ┘
```

```bash
ghostforge-ai                          # → 📊 Developer Dashboard (first item)
bash ~/ghostforge-agents/scripts/dashboard.sh
node ~/ghostforge-agents/tui/dashboard.js
```

**Keyboard:** `R` refresh · `Q` quit · `Tab` switch panel · `↑↓` scroll
**Auto-refresh** every 60 seconds. Requires `gh auth login` for live GitHub data.

---

A local VS Code extension (`ghostforge-ai`) that brings the toolkit into your editor without the terminal.

### Install
```bash
# Option 1: From TUI (recommended)
~/ghostforge-agents/ghostforge-ai  # → "🧩 Install VS Code Extension"

# Option 2: Direct
code --install-extension ~/ghostforge-agents/extension/ghostforge-ai-2.6.0.vsix
```

After installing, reload VS Code (`Cmd+Shift+P` → "Reload Window").

### Features

| Feature | How |
|---------|-----|
| **Command Picker** | `Cmd+Shift+E` — all 17 GhostForge actions in one place |
| **Command Palette** | `Cmd+Shift+P` → type "GhostForge" |
| **Snippet Sidebar** | Activity bar → ⚡ icon → click any snippet → inserts at cursor |
| **Commands Sidebar** | Browse all commands by category, click to copy to Copilot Chat |
| **Status Bar** | "⚡ GhostForge" bottom-right — click to open picker |
| **Right-click file** | `/context` (read file as Copilot context), `/storybook` (generate stories) |
| **Right-click folder** | `/rtl`, `/bundle`, `/health` — run in integrated terminal |
| **Ticket scaffold** | `Cmd+Shift+P` → "GhostForge: /ticket" → enter `PROJ-123` |

### Build from Source
```bash
cd ~/ghostforge-agents/extension
npm install
node esbuild.js
npx @vscode/vsce package --no-dependencies
```

---

## 📋 Snippet Library

Ready-made code patterns in `snippets/` — copy and adapt for any project.

| Snippet | What it covers |
|---------|---------------|
| `tanstack-table.tsx` | TanStack Table v8 — sorting, filtering, pagination, TypeScript |
| `msal-auth.tsx` | Azure AD MSAL — PublicClientApp, `acquireTokenSilent`, auth guard hook |
| `next-intl-page.tsx` | Next.js App Router page with `next-intl`, RTL `dir` detection |
| `apexcharts.tsx` | ApexCharts — line, bar, area charts with RTL + responsive config |
| `rhf-zod-form.tsx` | React Hook Form + Zod — schema, resolver, fields, submit handler |
| `zustand-store.ts` | Zustand store with actions, persist middleware, devtools, selectors |
| `tanstack-query.tsx` | TanStack Query v5 — `useQuery`, `useMutation`, `useInfiniteQuery` |
| `dnd-kit.tsx` | @dnd-kit sortable list with keyboard accessibility |
| `tiptap-editor.tsx` | TipTap rich text editor with full toolbar |
| `file-upload.tsx` | react-dropzone — multi-file, preview, size validation |
| `export-utils.ts` | Export to PDF (jsPDF), Excel (xlsx), CSV |

Use via TUI (📋 Snippet Library screen), VS Code sidebar, or `/snippet` command.

---

## 🏗️ Project Templates

Starter templates in `templates/projects/` — pre-configured with the full stack.

| Template | Stack |
|----------|-------|
| `react-vite` | React 18 + Vite + TypeScript + Tailwind + TanStack Query + Zustand + React Router + path aliases |
| `nextjs-i18n` | Next.js 15 + next-intl + Arabic default locale + App Router + Tailwind + MSAL-ready |

Copy a template to bootstrap a new project:
```bash
cp -r ~/ghostforge-agents/templates/projects/nextjs-i18n ./my-new-app
cd my-new-app && npm install
```

---

## 🧠 How Copilot Reads Files Automatically

GitHub Copilot in VS Code **automatically reads** `.github/copilot-instructions.md` in your workspace root. This is the main AI brain — no extra configuration needed.

### Step 1 — Copy to your project
```bash
cp -r ~/ghostforge-agents/.github /your-project/
cp -r ~/ghostforge-agents/.vscode /your-project/
```

### Step 2 — Open in VS Code
```bash
code /your-project
```

Copilot now reads from:

| File | Purpose |
|------|---------|
| `.github/copilot-instructions.md` | 🧠 Main AI brain — roles, stack, rules, all commands, React Doctor |
| `.github/copilot-setup-steps.yml` | ☁️ Copilot cloud coding agent environment |
| `.vscode/settings.json` | 14 additional instruction files wired via `codeGeneration.instructions` |
| `.copilot/skills/react-doctor/SKILL.md` | ⚕️ React Doctor skill for Copilot coding agent |

### Step 3 — Verify
Open Copilot Chat (`Cmd+Shift+I`) and type:
```
What tech stack do you know for this project?
```

---

## 🏗️ Setup a New Project

```bash
bash ~/ghostforge-agents/scripts/create-project.sh
# OR launch from the TUI:
ghostforge-ai
```

### What it asks (step by step):

| Step | Question |
|------|----------|
| 1 | 🤖 **AI Mode** (describe app) or 🔧 **Manual Mode** (step-by-step)? |
| 2 | Project name |
| 3 | **Frontend or Backend?** |
| 4 | **React JS (web) or React Native (mobile)?** |
| 5 | **Tailwind CSS / NativeWind support?** |
| 6 | TypeScript or JavaScript |
| 7 | UI library (shadcn/ui, MUI, React Native Paper, etc.) |
| 8 | State management (Zustand + React Query, Redux, Context) |
| 9 | Authentication (Azure AD, JWT, Google, None) |
| 10 | Backend / API (existing URL, scaffold Node.js, None) |
| 11 | Testing (Full, Unit only, Skip) |
| 12 | **Init GitHub / Azure DevOps / Local / Skip** |
| 13 | CI/CD pipeline (GitHub Actions, Azure Pipelines, Skip) |
| 14 | Deployment target |
| 15 | Confirm → Generate everything |

### What gets generated:
- ✅ Complete project scaffold (all folders, configs, base components)
- ✅ TypeScript strict config + ESLint + Prettier + Husky pre-commit
- ✅ Tailwind / NativeWind config
- ✅ Auth scaffold (login / register / protected routes)
- ✅ API service layer (Axios + interceptors + token refresh)
- ✅ State management setup
- ✅ Testing setup (Jest + RTL + optional E2E)
- ✅ `.env.example` with all required variables
- ✅ `.gitignore` + `.editorconfig`
- ✅ `README.md` with setup instructions
- ✅ GitHub / Azure DevOps repo initialized and pushed
- ✅ CI/CD pipeline file + **React Doctor workflow**
- ✅ **All ghostforge-agents files copied** → Copilot instantly active

---

## 💬 AI Conversation Mode

During setup, describe your app in plain English instead of answering questions:

```
💬 Describe your app:
> "A mobile app for GhostForge HR team — employees submit leave requests,
   view payslips, check attendance. Arabic + English. Azure AD login."
```

The AI parses your description, shows a structured plan, and scaffolds everything automatically.

---

## 💬 Commands Reference

Type these in **GitHub Copilot Chat** (`Cmd+Shift+I` / `Ctrl+Shift+I`).
> Type `/help` anytime for the quick reference card. Browse all commands in `ghostforge-ai` → ⚡ Run a Command.

### 🏗️ Project & Features
| Command | Description |
|---------|-------------|
| `/setup` | Interactive wizard — platform, framework, tools, repo, CI/CD |
| `/create [desc]` | Scaffold a complete new project |
| `/scaffold [type] [name]` | Generate component, hook, screen, service, store, form |
| `/add-feature [desc]` | Add a feature with full implementation |
| `/migrate [type]` | Plan and execute framework or architecture migrations |
| `/explain-codebase` | Explain a project for new developers and reviewers |
| `/onboard` | Generate developer onboarding guide for existing project |
| `/open [path]` | Open an existing project and sync toolkit files |

### 🔍 Code Quality
| Command | Description |
|---------|-------------|
| `/optimize` | Performance, bundle size, and code quality |
| `/tech-debt` | Scan and rank technical debt by ROI |
| `/estimate [ticket]` | Estimate story points, hours, and risk |
| `/explain-error [error]` | Paste any error — get root cause + fix instantly |
| `/lint` | Run ESLint + Prettier + TypeScript check |
| `/lint --fix` | Auto-fix all fixable lint issues |
| `/perf` | Performance profiling and optimization report |
| `/diagram architecture` | Mermaid architecture diagram |
| `/diagram erd` | ERD from schema |
| `/diagram flow [feature]` | User / data flow diagram |

### ⚕️ React Health
| Command | Description |
|---------|-------------|
| `/doctor` | React Doctor — full triage (scan → fix → validate loop) |
| `/doctor --scope changed` | Only issues introduced on this branch |
| `/health` | Project health score (100-pt scale + React Doctor score for React projects) |
| `/health --fix` | Health check + auto-apply safe fixes |

### 🔒 Security
| Command | Description |
|---------|-------------|
| `/security` | Full OWASP audit (Web + Mobile + API + dependencies) |
| `/security --fix` | Audit + auto-apply safe fixes |

### 🧪 Testing
| Command | Description |
|---------|-------------|
| `/test` | Auto-detect setup → verify → run full suite |
| `/test generate` | Generate missing tests for all uncovered files |
| `/test unit` | Unit tests only |
| `/test e2e` | E2E (Playwright / Detox / Maestro) |
| `/test a11y` | Accessibility audit (WCAG 2.1 AA) |
| `/a11y` | Full WCAG 2.1 AA accessibility audit and report |
| `/qa` | Full QA analysis and report |

### 🎫 Tickets & Bugs
| Command | Description |
|---------|-------------|
| `/tickets` | View assigned bugs grouped by 🔴→🟢 priority |
| `/fix-tickets` | Auto-fix all bugs in priority order |
| `/fix-tickets dry-run` | Preview fixes without applying |

### 🚀 Deployment & Release
| Command | Description |
|---------|-------------|
| `/deploy` | Generate deployment scripts or pipelines |
| `/deploy staging` | Deploy to staging |
| `/deploy production` | Deploy to production |
| `/release patch` | Bug fix release (1.0.0 → 1.0.1) |
| `/release minor` | Feature release (1.0.0 → 1.1.0) |
| `/release major` | Breaking change release (1.0.0 → 2.0.0) |

### 🗄️ Database & Data
| Command | Description |
|---------|-------------|
| `/sql query [desc]` | Write a SQL query |
| `/sql report [desc]` | Generate a report (SQL + PDF/Excel) |
| `/sql schema [desc]` | Design or update a schema |
| `/sql optimize [query]` | Optimize a slow query |
| `/sql migrate` | Generate migration scripts |
| `/sql etl` | Build an ETL pipeline |

### 📝 Git & Collaboration
| Command | Description |
|---------|-------------|
| `/commit` | Analyze staged changes → generate commit message |
| `/commit --push` | Commit and push |
| `/commit --pr` | Commit, push, and open PR |
| `/pr-description` | Auto-write PR description from diff |
| `/pr-description --create` | Generate and create the PR |
| `/review` | Copilot PR review with 10-point checklist |
| `/docs` | Generate or update project documentation |

### 🧰 Utilities
| Command | Description |
|---------|-------------|
| `/mock api [endpoint]` | Generate MSW handler |
| `/mock factory [type]` | Generate Faker factory from TypeScript type |
| `/upgrade` | Check + upgrade outdated packages |
| `/upgrade --safe` | Patch/minor upgrades only |
| `/upgrade --security` | Security patches only |
| `/snippet list` | Browse pre-built code snippets library |
| `/snippet add [name]` | Add a new snippet to the library |
| `/env validate` | Check `.env.local` completeness |
| `/env sync` | Sync env vars from code to `.env.example` |
| `/notify slack\|teams [message]` | Send webhook notifications to Slack or Teams |
| `/model` | Show current AI model selection + sync live models |
| `/marketplace` | Browse trusted marketplace sources and installable items |
| `/generate` | Create a custom agent, command, skill, instruction, or plugin |
| `/free-models` | Configure free hosted/local model providers |
| `/i18n setup` | Set up i18n from scratch |
| `/i18n extract` | Extract hardcoded strings |
| `/i18n rtl` | Add Arabic RTL support |
| `/storybook setup` | Install and configure Storybook |
| `/storybook generate` | Generate stories for components |

### ⚙️ Modes
| Command | Description |
|---------|-------------|
| `/autopilot on` | No confirmations — AI works fully autonomously |
| `/autopilot off` | Return to normal mode |
| `/safe on` | Confirm every single action before it runs |
| `/safe off` | Return to normal mode |
| `/help` | Quick reference for all commands |

---

## ⚙️ Operating Modes

### Normal (default)
AI asks for confirmation on significant changes.

### ⚡ Autopilot
```
/autopilot on
```
- No prompts — auto-installs, auto-fixes, auto-commits, auto-pushes
- All actions prefixed `⚡ [AUTOPILOT]`
- Session summary shown at end
- Best for: `/fix-tickets`, bulk refactoring, trusted tasks

### 🔒 Safe Mode
```
/safe on
```
- `[Y] Yes  [N] No  [S] Skip  [E] Edit` before every action
- Shows diff before applying file changes
- Best for: production deploys, auth changes, DB migrations

---

## 🎭 Agents & Role Switching

Just tell Copilot which role to use — or select it from `ghostforge-ai` → 🤖 Switch Agent:

| Say | Agent activated |
|-----|----------------|
| `"act as frontend developer"` | 🌐 React / Next.js / Tailwind |
| `"act as mobile developer"` | 📱 React Native / Expo |
| `"act as backend developer"` | 🖥️ Node.js / NestJS / APIs |
| `"act as CMS developer"` | 🏛️ Sitecore / Sitefinity |
| `"act as DBA"` | 🗄️ SQL / ETL / Reports |
| `"act as DevOps engineer"` | ⚙️ Azure / Docker / CI-CD |
| `"act as QA engineer"` | 🧪 Testing / Playwright / Detox |
| `"act as security engineer"` | 🔒 OWASP security |
| `"act as UI/UX designer"` | 🎨 Design systems / A11y |
| `"act as AI engineer"` | 🤖 OpenAI / Azure OpenAI / RAG |
| `"act as data engineer"` | 📊 Charts / dashboards / Power BI |
| `"act as architect"` | 🏛️ System design / ADRs |
| `"act as full stack"` | 🧑‍💻 Everything (default) |

---

## 🔗 GitHub & Azure Integration

### GitHub Copilot PR Review
Auto-runs on every PR via `.github/workflows/pr-review.yml`:
- ✅ Lint + tests + security audit
- ✅ Posts formatted comments (🔴 Critical / 🟡 Warning / 🟢 Suggestion)

### CI/CD Pipelines
| Workflow | Trigger | Does |
|----------|---------|------|
| `pr-review.yml` | PR opened/updated | Lint, test, security, comment |
| `deploy-azure.yml` | Push to main/develop | Build → staging → production |
| `qa-pipeline.yml` | Push/PR | Tests + E2E + Lighthouse + A11y |
| `react-doctor.yml` | PR / push to main | React health score, inline PR comments |
| `sync-models.yml` | Weekly / manual | Sync live Copilot Business models |

### Required GitHub Secrets
```
AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING
AZURE_STATIC_WEB_APPS_API_TOKEN_PROD
AZURE_DEVOPS_PAT          (for /tickets command)
CODECOV_TOKEN             (optional, coverage reporting)
```

### Required `.env.local`
```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/ghostforge
AZURE_DEVOPS_PROJECT=your-project
AZURE_DEVOPS_PAT=xxxxxxxxxxxx
JIRA_BASE_URL=https://ghostforge.atlassian.net    # optional
JIRA_EMAIL=your@ghostforge.com                    # optional
JIRA_API_TOKEN=xxxxxxxxxxxx                  # optional
SLACK_WEBHOOK=https://hooks.slack.com/...    # optional
TEAMS_WEBHOOK=https://...webhook.office.com  # optional
```

---

## 📚 Team Knowledge Base

The `knowledge/` folder is a shared team brain — wired into Copilot via `settings.json` so all context is always available.

| File | Contents |
|------|---------|
| `knowledge/gotchas.md` | Known pitfalls, quirks, and tricky behaviors |
| `knowledge/decisions.md` | Architecture Decision Records (ADRs) |
| `knowledge/patterns.md` | Approved design patterns and code conventions |
| `knowledge/environments.md` | Dev, staging, and production environment configs |
| `knowledge/onboarding.md` | Step-by-step new developer onboarding guide |

---

## 🌐 Copilot Spaces

A Copilot Space config is pre-built at `.copilot/space-config.md` for the `HishamAbulfeilat` org. Full setup guide at [`SPACES_SETUP.md`](./SPACES_SETUP.md).

---

## 🤖 Model Auto-Selection

The toolkit automatically selects the best Copilot model for each task type:

| Task | Model tier |
|------|-----------|
| Architecture design, security audits | Deep (claude-opus-4.x with adaptive thinking) |
| Code generation, features, reviews | Balanced (claude-sonnet, gpt-5.x) |
| Quick help, completions | Fast (claude-haiku, gpt-5-mini) |

Models sync live from the Copilot Business API weekly via `.github/workflows/sync-models.yml`:
```bash
node ~/ghostforge-agents/scripts/sync-models.js
```

---

## 📁 Folder Structure

```
ghostforge-agents/                              ← v2.3.0 — 180+ files
│
├── README.md                              ← You are here
├── CONTRIBUTING.md                        ← How to add agents/commands
├── CHANGELOG.md                           ← Version history
├── EXTENSION_SETUP.md                     ← @ghostforge Copilot Extension guide
├── SPACES_SETUP.md                        ← Copilot Spaces guide
├── VERSION                                ← 2.3.0
├── .editorconfig                          ← Consistent editor settings
├── ghostforge-ai                               ← 🖥️  Terminal UI launcher (run this!)
├── .ghostforge-models.json                     ← Live synced model list
├── ghostforge-config.schema.json               ← .ghostforge-config.json schema
│
├── tui/                                   ← Terminal UI source
│   ├── index.js                           ← Main TUI (Node.js, 910+ lines)
│   └── package.json                       ← TUI deps: chalk, inquirer, figlet…
│
├── .github/                               ← 8 files
│   ├── copilot-instructions.md            ← 🧠 Main AI brain (auto-read by Copilot)
│   ├── copilot-setup-steps.yml            ← ☁️  Copilot cloud agent setup
│   └── workflows/
│       ├── pr-review.yml                  ← Auto PR review
│       ├── deploy-azure.yml               ← Azure deployment
│       ├── qa-pipeline.yml                ← QA + Lighthouse + A11y
│       ├── react-doctor.yml               ← React health scan on every PR ← NEW
│       ├── sync-models.yml                ← Weekly live model sync
│       └── deploy-extension.yml           ← @ghostforge extension deploy to Vercel
│
├── .copilot/                              ← Copilot Spaces + skill files
│   ├── space-config.md                    ← Copilot Spaces config
│   └── skills/react-doctor/              ← React Doctor skill for Copilot ← NEW
│       ├── SKILL.md
│       └── references/explain.md
│
├── .claude/                               ← Claude Code skill files ← NEW
│   └── skills/react-doctor/
├── .continue/                             ← Continue skill files ← NEW
│   └── skills/react-doctor/
├── .agents/                               ← Generic agent skill files ← NEW
│   └── skills/react-doctor/
│
├── agents/                                ← 14 specialized AI agents
│   └── [fullstack, frontend-web, mobile, backend, backend-cms, sql-etl,
│        security, qa, devops, ui-ux, ticket-checker, ai-integration,
│        data-viz, architect].md
│
├── commands/                              ← 44 slash commands
│   └── [help, setup, create, scaffold, add-feature, optimize, lint,
│        security, test, tickets, fix-tickets, sql, mock, commit,
│        pr-description, release, upgrade, deploy, qa, diagram, i18n,
│        env, storybook, onboard, explain-error, autopilot, safe, open,
│        health, review, docs, perf, snippet, model, migrate, estimate,
│        tech-debt, explain-codebase, notify, a11y, react-doctor,
│        marketplace, generate, free-models].md
│
├── instructions/                          ← 23 deep-knowledge files
│   └── [react-native, react-web, nextjs, tailwind, typescript, azure,
│        sitecore, sitefinity, sql-reporting, api-design, docker,
│        error-handling, figma, react-patterns, monorepo, state-management,
│        testing-strategy, git-workflow, general-knowledge, model-selection,
│        ghostforge-config, react-doctor, free-models].md
│
├── marketplace/                           ← Marketplace catalog + registry + custom items
│   ├── README.md
│   ├── sources.json
│   ├── catalog.json
│   ├── registry.json
│   ├── custom-models.json
│   ├── custom-agents/
│   └── custom-commands/
│
├── knowledge/                             ← 6 team knowledge files
│   ├── README.md
│   ├── gotchas.md
│   ├── decisions.md
│   ├── patterns.md
│   ├── environments.md
│   └── onboarding.md
│
├── mcp/                                   ← MCP server
│   ├── index.js
│   ├── package.json
│   ├── README.md
│   └── tools/ [health, tickets, models, security, snippets].js
│
├── extension/                             ← @ghostforge Copilot Extension
│   ├── index.js                           ← Express + SSE server
│   ├── package.json
│   ├── vercel.json
│   ├── utils/sse.js
│   └── handlers/ [router, health, tickets, security, review,
│                  deploy, optimize, help, fallback].js
│
├── prompts/                               ← 7 reusable prompt templates
│   └── [create-project, add-feature, security-review, optimize,
│        deploy, qa-test, sql-report].md
│
├── scripts/                               ← 16 automation scripts
│   ├── create-project.sh                  ← 🚀 Interactive project wizard
│   ├── copy-to-project.sh                 ← Copy toolkit to existing project
│   ├── deploy-azure.sh                    ← Azure deployment helper
│   ├── setup-env.sh                       ← Install VS Code extensions
│   ├── update.sh                          ← Version bump + git tagging
│   ├── open-project.sh                    ← Open existing project
│   ├── health-check.sh                    ← Health score (incl. React Doctor)
│   ├── daily-digest.sh                    ← Morning project digest
│   ├── install-digest-cron.sh             ← Schedule daily digest
│   ├── snippet-manager.sh                 ← Manage snippet library
│   ├── init-config.sh                     ← Init .ghostforge-config.json
│   ├── generate.sh                        ← Custom generator wizard
│   ├── marketplace.sh                     ← Marketplace browser helper
│   ├── free-models.sh                     ← Free model provider setup
│   ├── notify.sh                          ← Slack / Teams webhooks
│   └── sync-models.js                     ← Live Copilot model sync
│
├── snippets/                              ← 10 pre-built code snippets
│
└── .vscode/                               ← VS Code config
    ├── settings.json                      ← Copilot auto-reads 14 instruction files
    ├── extensions.json                    ← Recommended extensions
    └── mcp.json                           ← MCP server config
```

---

## 🛡️ SDLC & Security Standards

### Development Phases
| Phase | AI Helps With |
|-------|--------------|
| **Plan** | Break requirements into tasks, estimate effort (`/estimate`) |
| **Design** | Architecture diagrams, ADRs, DB schema (`/diagram`, `architect` agent) |
| **Setup** | Full project scaffold with all tooling (`/setup`, `ghostforge-ai`) |
| **Develop** | Code suggestions following GhostForge conventions + React Doctor health |
| **Review** | Auto PR review — quality, security, performance, React Doctor score |
| **Test** | Full automated test suite (`/test`, `/a11y`, `/doctor`) |
| **Security** | OWASP audit before every release (`/security`) |
| **Deploy** | Staging → approval gate → production (`/deploy`) |
| **Monitor** | Azure Application Insights + Sentry |
| **Maintain** | Bug triage by priority (`/tickets`, `/fix-tickets`) |

### Security Non-Negotiables
- ❌ No secrets in source code — `.env` + Azure Key Vault
- ✅ All inputs validated (client + server)
- ✅ Tokens: SecureStore (mobile) / httpOnly cookies (web)
- ✅ HTTPS only — no HTTP API calls
- ✅ `npm audit` passes before every release
- ✅ React Doctor score ≥ 75 before PR merge
- ✅ CSP headers configured
- ✅ Rate limiting on auth endpoints

### Coding Standards
- TypeScript strict mode — no `any`
- ESLint + Prettier via Husky pre-commit hooks
- Conventional Commits (`feat:`, `fix:`, `chore:`)
- Files: `PascalCase` components, `camelCase` hooks/utils
- Tests alongside code: `Component.test.tsx`

---

## 👥 Team Setup & Updates

### Share with the GhostForge team
```bash
# The repo is already live at:
git clone https://github.com/HishamAbulfeilat/GhostForge.git ~/ghostforge-agents
bash ~/ghostforge-agents/scripts/setup-env.sh
~/ghostforge-agents/ghostforge-ai
```

### Get latest updates
```bash
bash ~/ghostforge-agents/scripts/update.sh
```

### Release a new version
```bash
bash ~/ghostforge-agents/scripts/update.sh
# Choose: patch / minor / major / custom
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add new agents, commands, or instruction files.

---

## 📅 What's New

### v3.0.2 — Skills + Shared Memory
- **🧠 claude-mem** — persistent shared memory for Claude Code. Context survives across sessions. `npx claude-mem install` or TUI → Marketplace → Shared Memory. `scripts/setup-memory.sh` for setup.
- **🔍 find-skills (Vercel Labs)** — skill that discovers & installs other skills from skills.sh ecosystem. Installed at `.claude/skills/find-skills/SKILL.md`.
- **🎨 frontend-design (Anthropic Official)** — distinctive visual design guidance: opinionated palette, typography, anti-template approach, RTL/Arabic section. Installed at `.claude/skills/frontend-design/SKILL.md`.
- **20 marketplace sources** total

### v3.0.1 — Marketplace Expansion (17 sources)
- **🎨 UI/UX Pro Max Skill** — 161 reasoning rules + 84 UI styles for world-class UI/UX. `npx ui-ux-pro-max-cli`
- **⚡ PocketBase** — open source backend in 1 file: SQLite + realtime + auth + files + Admin UI
- **🗂️ Claude Marketplaces** — curated directory of Claude skills, MCP servers, plugin marketplaces (claudemarketplaces.com)
- **🌍 scroll-world skill** — fly-through scroll-scrubbed landing page skill (Claude Code, Codex, 20+ agents). `/plugin marketplace add oso95/scroll-world`
- **🧠 Hermes Agent (Nous Research)** — self-improving AI agent with learning loop, persistent memory, cron scheduler, Telegram/Discord/Slack/WhatsApp/Signal gateway, agentskills.io compatible
- **🔊 edge-tts neural AI voice** — Microsoft Edge neural voices (400+), zero cost, no API key. `bash scripts/voice.sh install-voice-model`
- **🔍 opensourceprojects.dev** — curated open-source discovery (hidden gems, trending repos, RSS feed)

### v3.0.0 — Major Feature Release
- **🔊 Voice features (free)** — TTS via macOS `say`/`espeak-ng`; STT via Groq Whisper API (7200s/day free) or local `whisper.cpp` (offline, forever free)
- **💬 `@ghostforge` Copilot Chat Participant** — VS Code chat with `/health`, `/review`, `/test`, `/rtl`, `/bundle`, `/commit`, `/security`, `/optimize`, `/estimate` slash commands
- **🔀 Dashboard Open PRs panel** — 7th panel added: Open Pull Requests with author, review status (✅/⚠/⏳)
- **⚡ PR Auto-Check GitHub Actions** — `.github/workflows/pr-check.yml` posts quality report on every PR (ESLint, env-check, unused, RTL, React Doctor, npm audit)
- **🌐 `/health-all`** — scan all registered projects, combined health report
- **⚡ `/perf`** — Lighthouse performance audit (mobile/desktop)
- **⬆️ `/upgrade`** — interactive npm package upgrade wizard (npm-check-updates)
- **🔌 `/mock-api`** — generate MSW handlers from OpenAPI spec
- **🎓 `/onboard-dev`** — automated new developer setup wizard
- **📋 `/ado`** — Azure DevOps work items, pipelines, releases
- **🎯 `/estimate`** — AI story point estimator with codebase analysis
- **📜 Interactive CHANGELOG viewer** — browse CHANGELOG.md by release in TUI

### v2.9.0 — Developer Dashboard
- **📊 Real-time terminal dashboard** — 6 panels: My Tickets (GitHub Issues), Pipeline Status (Actions), Health Bar Chart, Releases & Tags, Health Trend Line, Activity Feed
- Powered by `blessed-contrib` — full-screen terminal with live charts
- Auto-refresh every 60 seconds · keyboard: R=refresh, Q=quit, Tab=focus

### v2.8.1 — Agent Skills Marketplace
- **6 Claude Agent Skills sources** added to marketplace: Anthropic Official, SkillsMP (2M+), Claude-Flow, Awesome Claude Skills, Agent Skills Standard (agentskills.io), Skills Collection 2026
- New `/skills` command + `scripts/skills.sh` — list, search, install, browse
- TUI Marketplace → 🎓 Agent Skills sub-menu with SkillsMP search

### v2.8.0 — Developer Productivity Commands
- **`/api-types`** — OpenAPI/Swagger URL → TypeScript types + service file
- **`/changelog`** — auto-generate CHANGELOG.md from Conventional Commits
- **`/env-check`** — compare `.env` vs `.env.example`, flag secrets/missing keys
- **`/unused`** — find dead code with knip (files, exports, dependencies)
- **`/git-hooks`** — one command: Husky + lint-staged + commitlint
- **Health badge** — shields.io badge output after every `/health` run
- **VS Code auto-update** — `update.sh` rebuilds + reinstalls extension on version bump

### v2.7.1 — VS Code Extension + Snippet Library
- VS Code extension with sidebar, command picker, snippet insert (`Cmd+Shift+E`)
- 11 code snippets: TanStack Table, MSAL Auth, next-intl, ApexCharts, RHF+Zod, Zustand, TanStack Query, dnd-kit, TipTap, file-upload, export utils
- Project templates: `react-vite`, `nextjs-i18n`

---

*Built for GhostForge · Frontend & Full Stack Developer Toolkit*
*Powered by GitHub Copilot Business · v3.0.0*
