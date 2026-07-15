# /help Command

## Description
Shows a quick reference of all available commands. Use in GitHub Copilot Chat anytime you forget a command.

## Usage
```text
/help                   → Show all commands grouped by category
/help [command]         → Show details for a specific command
/help setup             → Show /setup command details
```

## Quick Reference Card

### 🏗️ Project & Features
```text
/setup                  Interactive project setup wizard
/create [desc]          Scaffold a complete new project
/scaffold [type] [name] Generate component, hook, screen, service, store, form
/add-feature [desc]     Add a feature to existing project
```

### 🔍 Code Quality
```text
/optimize               Performance + bundle + code quality
/refactor               Refactor selected code
/explain                Explain selected code
/explain-error [error]  Root cause + fix for any error
/fix                    Fix bugs in selected code
/document               Generate JSDoc/TSDoc
/translate              Convert code to another framework
/lint                   Run ESLint + Prettier + TypeScript check
/lint --fix             Auto-fix all fixable lint issues
```

### 🧪 Testing
```text
/test                   Full test suite (auto-detect + verify first)
/test generate          Generate missing tests
/test unit              Unit tests only
/test e2e               E2E tests (Playwright/Detox/Maestro)
/test a11y              Accessibility audit (WCAG 2.1)
/test performance       Lighthouse / React Profiler
```

### 🎫 Tickets & Bugs
```text
/tickets                View assigned bugs by 🔴→🟢 priority
/fix-tickets            Auto-fix all bugs in priority order
/fix-tickets dry-run    Preview fixes without applying
```

### 🔒 Security
```text
/security               Full OWASP security audit
```

### 🚀 Deployment
```text
/deploy                 Generate deployment scripts
/deploy staging         Deploy to staging
/deploy production      Deploy to production
/release patch          Bug fix release (1.0.0 → 1.0.1)
/release minor          Feature release (1.0.0 → 1.1.0)
/release major          Breaking change release (1.0.0 → 2.0.0)
```

### 🗄️ Database
```text
/sql query [desc]       Write a SQL query
/sql report [desc]      Generate report (SQL + PDF/Excel)
/sql schema [desc]      Design or update schema
/sql optimize [query]   Optimize a slow query
/sql migrate            Generate migration scripts
/sql etl                Build an ETL pipeline
```

### 📝 Git & Collaboration
```text
/commit                 Generate commit message from staged changes
/commit --push          Commit and push
/commit --pr            Commit, push, open PR
/pr-description         Auto-write PR description from diff
/pr-description --create Generate and create the PR
```

### 🌐 Internalization
```text
/i18n setup             Set up i18n from scratch
/i18n extract           Extract hardcoded strings
/i18n add-language ar   Add Arabic (RTL) support
/i18n missing           Find untranslated strings
```

### 🧰 Utilities
```text
/mock api [endpoint]    Generate MSW handler
/mock factory [type]    Generate Faker factory from TS type
/mock all               Generate all mocks
/upgrade                Check + upgrade outdated packages
/upgrade --safe         Safe upgrades only (patch/minor)
/env validate           Check .env.local completeness
/env sync               Sync env vars from code to .env.example
/diagram architecture   Generate Mermaid architecture diagram
/diagram erd            Generate ERD from schema
/diagram flow [feature] Generate user flow diagram
/storybook setup        Install and configure Storybook
/storybook generate     Generate stories for components
/onboard                Generate developer onboarding guide
```

### ⚙️ Modes
```text
/autopilot on           No confirmations — AI works autonomously
/autopilot off          Return to normal mode
/safe on                Confirm every single action
/safe off               Return to normal mode
```

### 💬 QA & Review
```text
/qa                     Full QA analysis and report
/review                 PR code review
/help                   Show this reference card
/help [command]         Details for a specific command
```

---

## Agents (role switching)
```text
"act as frontend developer"   → React/Next.js/Tailwind
"act as mobile developer"     → React Native/Expo
"act as backend developer"    → Node.js/NestJS
"act as CMS developer"        → Sitecore/Sitefinity
"act as DBA"                  → SQL/ETL/Reports
"act as DevOps engineer"      → Azure/Docker/CI-CD
"act as QA engineer"          → Testing/Playwright
"act as security engineer"    → OWASP security
"act as UI/UX designer"       → Design systems/A11y
"act as AI engineer"          → OpenAI/Azure OpenAI
"act as data engineer"        → Charts/dashboards/BI
"act as architect"            → System design/ADRs
"act as full stack"           → Everything (default)
```
