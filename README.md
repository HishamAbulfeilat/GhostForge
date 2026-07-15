# 🚀 GhostForge AI Developer Toolkit — v2.0.0

The official AI toolkit for **GhostForge** developers. Supercharges GitHub Copilot with deep knowledge of your entire tech stack — frontend web, mobile, backend, CMS, DevOps, QA, security, SQL/ETL, AI integration, and more.

**100+ files · 14 agents · 33 commands · 20 instruction files · Terminal UI (`ghostforge-ai`)**

---

## 📋 Table of Contents

1. [Quick Start](#-quick-start)
2. [@ghostforge GitHub Copilot Extension](#-ghostforge-github-copilot-extension)
3. [Terminal UI — `ghostforge-ai`](#-terminal-ui----ghostforge-ai)
4. [How Copilot Reads Files Automatically](#-how-copilot-reads-files-automatically)
5. [Setup a New Project](#-setup-a-new-project)
6. [AI Conversation Mode](#-ai-conversation-mode)
7. [Commands Reference](#-commands-reference)
8. [Operating Modes](#-operating-modes)
9. [Agents & Role Switching](#-agents--role-switching)
10. [GitHub & Azure Integration](#-github--azure-integration)
11. [Folder Structure](#-folder-structure)
12. [SDLC & Security Standards](#-sdlc--security-standards)
13. [Team Setup & Updates](#-team-setup--updates)
14. [Contributing](#-contributing)

---

## ⚡ Quick Start

```bash
# 1. Clone the toolkit
git clone https://github.com/ghostforge/ghostforge-agents.git ~/ghostforge-agents

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
| **Shell Scripts** | `bash scripts/create-project.sh` | Automated project scaffolding |

## 🤖 @ghostforge GitHub Copilot Extension

`@ghostforge` is a hosted GitHub Copilot Extension server in `extension/` that brings the GhostForge toolkit into Copilot Chat on **VS Code**, **GitHub.com**, and **GitHub Mobile**. It deploys cleanly to **Vercel**, can stay **private for GhostForge only** or be prepared for a **public Marketplace rollout**, and does **not** replace the existing local toolkit.

- **Setup guide:** [`EXTENSION_SETUP.md`](./EXTENSION_SETUP.md)
- **Hosted usage:** `@ghostforge /help`, `@ghostforge /health`, `@ghostforge /tickets`, `@ghostforge /security`, `@ghostforge /review`, `@ghostforge /deploy`, `@ghostforge /optimize`
- **Full command catalog:** `/setup`, `/create`, `/open`, `/scaffold`, `/add-feature`, `/health`, `/help`, `/docs`, `/snippet`, `/onboard`, `/optimize`, `/perf`, `/lint`, `/explain-error`, `/diagram`, `/security`, `/test`, `/qa`, `/review`, `/tickets`, `/fix-tickets`, `/deploy`, `/release`, `/sql`, `/mock`, `/i18n`, `/storybook`, `/commit`, `/pr-description`, `/upgrade`, `/env`, `/autopilot`, `/safe`
- **Local toolkit stays independent:** `ghostforge-ai`, `scripts/`, copied `.github/` instructions, and existing project flows continue to work exactly as before

---

## 🖥 Terminal UI — `ghostforge-ai`

A clean, interactive terminal dashboard for the entire toolkit. Browse commands, switch agents, run tests, deploy, manage tickets — all from a beautiful menu without memorizing anything.

### Launch

```bash
# Recommended: run from anywhere
~/ghostforge-agents/ghostforge-ai

# From inside the toolkit folder
cd ~/ghostforge-agents && ./ghostforge-ai

# Directly with Node
cd ~/ghostforge-agents && node tui/index.js
```

### Add a Shell Alias (Recommended)

Add to `~/.zshrc` or `~/.bashrc` so you can type `ghostforge-ai` from any directory:

```bash
alias ghostforge-ai='node ~/ghostforge-agents/tui/index.js'
```

Reload shell: `source ~/.zshrc`

### First Run
On the first launch, the TUI auto-installs its Node.js dependencies (one time, ~5 seconds). Requires **Node.js 18+**.

### TUI Screens

| Screen | What it does |
|--------|-------------|
| 🚀 **New Project Setup** | AI mode (describe your app) or 14-step wizard |
| 🗂 **Manage Projects** | Track registered projects, open them, and sync toolkit updates |
| 💊 **Project Health Check** | Score the current project across security, deps, coverage, bundle, tickets, lint |
| ⚡ **Run a Command** | Browse all 33 slash commands by category, read full docs |
| 🤖 **Switch Agent / Role** | View all 14 agents, copy their activation prompt |
| 📚 **Browse Instructions** | Read any of the 20 knowledge-base files inline |
| 🎫 **Tickets & Issues** | Live fetch from GitHub Issues / Azure DevOps / Jira by priority |
| 🔒 **Security Audit** | Run `npm audit`, scan secrets, get OWASP checklist |
| 🧪 **Run Tests** | Auto-detect Jest / Vitest / Playwright / Detox and execute |
| 🚀 **Deploy** | Guided deploy to Azure / Vercel / GitHub Pages |
| 🌅 **Daily Digest** | Morning summary for tickets, security, dependency drift, git, and health |
| 📄 **README / Docs** | Read full documentation without leaving the terminal |
| ❓ **Help** | Quick reference for all commands and agents |

### Requirements
- Node.js 18+ (`node --version`)
- macOS / Linux / WSL

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
| `.github/copilot-instructions.md` | 🧠 Main AI brain — roles, stack, rules, all commands |
| `.github/copilot-setup-steps.yml` | ☁️ Copilot cloud coding agent environment |
| `.vscode/settings.json` | 10 additional instruction files wired via `codeGeneration.instructions` |

### Step 3 — Verify
Open Copilot Chat (`Cmd+Shift+I`) and type:
```
What tech stack do you know for this project?
```
Copilot responds with full GhostForge-specific knowledge.

### What VS Code auto-loads
The `.vscode/settings.json` wires 10 instruction files for:
- **Code generation** — all stack instructions
- **Test generation** — testing standards
- **PR review** — review checklist
- **Commit messages** — Conventional Commits format

---

## 🏗️ Setup a New Project

```bash
bash ~/ghostforge-agents/scripts/create-project.sh
# OR launch from the TUI → "New Project Setup"
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
- ✅ CI/CD pipeline file
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

You can also use it anytime in Copilot Chat:
```
/setup I need a Next.js dashboard for KPI tracking with charts,
user roles, and Azure AD login
```

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
| `/onboard` | Generate developer onboarding guide for existing project |

### 🔍 Code Quality
| Command | Description |
|---------|-------------|
| `/optimize` | Performance, bundle size, and code quality |
| `/explain-error [error]` | Paste any error — get root cause + fix instantly |
| `/lint` | Run ESLint + Prettier + TypeScript check |
| `/lint --fix` | Auto-fix all fixable lint issues |
| `/diagram architecture` | Mermaid architecture diagram |
| `/diagram erd` | ERD from schema |
| `/diagram flow [feature]` | User / data flow diagram |

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
| `/test performance` | Lighthouse (web) / RN Profiler (mobile) |

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

### 🧰 Utilities
| Command | Description |
|---------|-------------|
| `/mock api [endpoint]` | Generate MSW handler |
| `/mock factory [type]` | Generate Faker factory from TypeScript type |
| `/upgrade` | Check + upgrade outdated packages |
| `/upgrade --safe` | Patch/minor upgrades only |
| `/upgrade --security` | Security patches only |
| `/env validate` | Check `.env.local` completeness |
| `/env sync` | Sync env vars from code to `.env.example` |
| `/i18n setup` | Set up i18n from scratch |
| `/i18n extract` | Extract hardcoded strings |
| `/i18n rtl` | Add Arabic RTL support |
| `/storybook setup` | Install and configure Storybook |
| `/storybook generate` | Generate stories for components |
| `/qa` | Full QA analysis and report |

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

### All Agents
| Agent | File |
|-------|------|
| 🧑‍💻 Full Stack | `agents/fullstack.md` |
| 🌐 Frontend Web | `agents/frontend-web.md` |
| 📱 Mobile | `agents/mobile.md` |
| 🖥️ Backend | `agents/backend.md` |
| 🏛️ Backend CMS | `agents/backend-cms.md` |
| 🗄️ SQL / ETL | `agents/sql-etl.md` |
| 🔒 Security | `agents/security.md` |
| 🧪 QA | `agents/qa.md` |
| ⚙️ DevOps | `agents/devops.md` |
| 🎨 UI/UX | `agents/ui-ux.md` |
| 🎫 Ticket Checker | `agents/ticket-checker.md` |
| 🤖 AI Integration | `agents/ai-integration.md` |
| 📊 Data Viz | `agents/data-viz.md` |
| 🏛️ Architect | `agents/architect.md` |

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
```

---

## 📁 Folder Structure

```
ghostforge-agents/                              ← v2.0.0 — 87 files
│
├── README.md                              ← You are here
├── CONTRIBUTING.md                        ← How to add agents/commands
├── VERSION                                ← 2.0.0
├── .editorconfig                          ← Consistent editor settings
├── ghostforge-ai                               ← 🖥️  Terminal UI launcher (run this!)
│
├── tui/                                   ← Terminal UI source
│   ├── index.js                           ← Main TUI (Node.js, 600+ lines)
│   └── package.json                       ← TUI deps: chalk, inquirer, figlet…
│
├── .github/                               ← 5 files
│   ├── copilot-instructions.md            ← 🧠 Main AI brain (auto-read by Copilot)
│   ├── copilot-setup-steps.yml            ← ☁️  Copilot cloud agent setup
│   └── workflows/
│       ├── pr-review.yml                  ← Auto PR review
│       ├── deploy-azure.yml               ← Azure deployment
│       └── qa-pipeline.yml                ← QA + Lighthouse + A11y
│
├── agents/                                ← 14 specialized AI agents
│   ├── fullstack.md
│   ├── frontend-web.md
│   ├── mobile.md
│   ├── backend.md
│   ├── backend-cms.md                     ← Sitecore, Sitefinity
│   ├── sql-etl.md
│   ├── security.md
│   ├── qa.md
│   ├── devops.md
│   ├── ui-ux.md
│   ├── ticket-checker.md
│   ├── ai-integration.md
│   ├── data-viz.md
│   └── architect.md
│
├── commands/                              ← 27 slash commands
│   ├── help.md           ← /help
│   ├── setup.md          ← /setup
│   ├── create.md         ← /create
│   ├── scaffold.md       ← /scaffold
│   ├── add-feature.md    ← /add-feature
│   ├── optimize.md       ← /optimize
│   ├── lint.md           ← /lint
│   ├── security.md       ← /security
│   ├── test.md           ← /test
│   ├── tickets.md        ← /tickets
│   ├── fix-tickets.md    ← /fix-tickets
│   ├── sql.md            ← /sql
│   ├── mock.md           ← /mock
│   ├── commit.md         ← /commit
│   ├── pr-description.md ← /pr-description
│   ├── release.md        ← /release
│   ├── upgrade.md        ← /upgrade
│   ├── deploy.md         ← /deploy
│   ├── qa.md             ← /qa
│   ├── diagram.md        ← /diagram
│   ├── i18n.md           ← /i18n
│   ├── env.md            ← /env
│   ├── storybook.md      ← /storybook
│   ├── onboard.md        ← /onboard
│   ├── explain-error.md  ← /explain-error
│   ├── autopilot.md      ← /autopilot
│   └── safe.md           ← /safe
│
├── instructions/                          ← 19 deep-knowledge files
│   ├── react-native.md
│   ├── react-web.md
│   ├── nextjs.md
│   ├── tailwind.md
│   ├── typescript.md
│   ├── azure.md
│   ├── sitecore.md
│   ├── sitefinity.md
│   ├── sql-reporting.md
│   ├── api-design.md
│   ├── docker.md
│   ├── error-handling.md
│   ├── figma.md
│   ├── react-patterns.md
│   ├── monorepo.md
│   ├── state-management.md
│   ├── testing-strategy.md
│   ├── git-workflow.md
│   └── general-knowledge.md
│
├── prompts/                               ← 7 reusable prompt templates
│   ├── create-project.md
│   ├── add-feature.md
│   ├── security-review.md
│   ├── optimize.md
│   ├── deploy.md
│   ├── qa-test.md
│   └── sql-report.md
│
├── scripts/                               ← 5 automation scripts
│   ├── create-project.sh                  ← 🚀 Interactive project wizard
│   ├── copy-to-project.sh                 ← Copy toolkit to existing project
│   ├── deploy-azure.sh                    ← Azure deployment helper
│   ├── setup-env.sh                       ← Install VS Code extensions
│   └── update.sh                          ← Pull latest toolkit updates
│
└── .vscode/                               ← 2 files
    ├── settings.json                      ← Copilot auto-read (10 files wired)
    └── extensions.json                    ← Recommended extensions
```

---

## 🛡️ SDLC & Security Standards

Every project created follows the full software development lifecycle:

### Development Phases
| Phase | AI Helps With |
|-------|--------------|
| **Plan** | Break requirements into tasks, estimate effort (`/scaffold`) |
| **Design** | Architecture diagrams, ADRs, DB schema (`/diagram`, `architect` agent) |
| **Setup** | Full project scaffold with all tooling (`/setup`, `ghostforge-ai`) |
| **Develop** | Code suggestions following GhostForge conventions |
| **Review** | Auto PR review — quality, security, performance |
| **Test** | Full automated test suite (`/test`) |
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
cd ~/ghostforge-agents
git init && git add . && git commit -m "chore: initial ghostforge-agents v2.0.0"
gh repo create ghostforge/ghostforge-agents --private --source=. --push
```

### Team members get it with
```bash
git clone https://github.com/ghostforge/ghostforge-agents.git ~/ghostforge-agents
bash ~/ghostforge-agents/scripts/setup-env.sh
# Then launch the TUI:
~/ghostforge-agents/ghostforge-ai
```

### Get latest updates
```bash
bash ~/ghostforge-agents/scripts/update.sh
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add new agents, commands, or instruction files.

---

*Built for GhostForge · Frontend & Full Stack Developer Toolkit*
*Powered by GitHub Copilot Business · v2.0.0*
