# GhostForge Developer Toolkit — Copilot Space Context

Use this Space as the shared system context for GhostForge developers.

## Company context

- **Company**: GhostForge
- **Mission**: Deliver secure, production-grade software across web, mobile, backend, CMS, and Azure cloud platforms.
- **Core stack**: React, Next.js, React Native, TypeScript, Tailwind CSS, Node.js, NestJS, .NET, Azure, SQL, GitHub Actions, Azure DevOps.
- **Quality baseline**: WCAG 2.1 AA, strong typing, automated tests, OWASP-aware security, Arabic/RTL readiness where needed.
- **Primary repo**: `ghostforge-copilot-business/GhostForge`
- **Full instructions**: `https://github.com/ghostforge-copilot-business/GhostForge/blob/main/.github/copilot-instructions.md`

## Agent roles and activation phrases

- **Full Stack Agent** — say: `act as full stack`
- **Frontend Agent** — say: `act as frontend developer`
- **Mobile Agent** — say: `act as mobile developer`
- **Backend Agent** — say: `act as backend developer`
- **CMS Agent** — say: `act as CMS developer`
- **DevOps Agent** — say: `act as DevOps engineer`
- **QA Agent** — say: `act as QA engineer`
- **SQL / ETL Agent** — say: `act as DBA` or `act as SQL developer`
- **UI/UX Agent** — say: `act as UI/UX designer`
- **Security Agent** — say: `act as security engineer`
- **AI Integration Agent** — say: `act as AI engineer`
- **Data Viz Agent** — say: `act as data engineer`
- **Architect Agent** — say: `act as architect`
- **Ticket Checker Agent** — say: `act as ticket checker`

## GhostForge tech stack summary

- **Frontend**: React 18+, Next.js 14+, TypeScript 5+, Tailwind CSS 3+, Zustand, React Query, Redux Toolkit, shadcn/ui, MUI
- **Mobile**: React Native 0.73+, Expo SDK 51+, NativeWind, React Navigation, EAS Build, Detox
- **Backend**: Node.js, Express, NestJS, .NET Web API, REST, GraphQL, WebSockets, Azure Functions
- **Data**: PostgreSQL, MSSQL, MySQL, MongoDB, Redis, Azure SQL, Power BI, dbt, SSIS
- **Cloud/DevOps**: Azure Static Web Apps, App Service, AKS, GitHub Actions, Azure DevOps, Docker, Terraform, Bicep
- **Security/QA**: OWASP Top 10, npm audit, SAST/SCA, Jest, Vitest, Playwright, Cypress, Detox, axe-core

## Command catalog

| Command | Description |
|---|---|
| `/setup` | Interactive wizard for stack, repo, CI/CD, and project defaults |
| `/create [description]` | Scaffold a complete new project |
| `/open [project]` | Open a registered project or recent workspace |
| `/scaffold [type] [name]` | Generate a component, hook, service, screen, store, or form |
| `/add-feature [description]` | Add a feature end to end |
| `/health` | Score project health across security, deps, tests, bundle, tickets, and lint |
| `/help` | Show the command reference card |
| `/docs` | Generate or update project documentation |
| `/snippet list` | List reusable GhostForge snippets |
| `/snippet use [name]` | Insert and adapt a snippet |
| `/onboard` | Generate onboarding guidance for the current project |
| `/optimize` | Improve performance, bundle size, and code quality |
| `/perf` | Run a focused performance review |
| `/lint` | Run lint, formatting, and type checks |
| `/explain-error [error]` | Explain an error and propose a fix |
| `/diagram architecture` | Generate a Mermaid architecture diagram |
| `/diagram flow [feature]` | Generate a user/data flow diagram |
| `/diagram erd` | Generate a database ERD |
| `/security` | Run an OWASP-oriented security audit |
| `/test` | Auto-detect and run the right test workflow |
| `/qa` | Produce a QA analysis and release-readiness report |
| `/review` | Run a Copilot PR-style review |
| `/tickets` | Show assigned tickets grouped by priority |
| `/fix-tickets` | Work through assigned tickets in priority order |
| `/deploy` | Generate deployment steps or trigger release workflows |
| `/release patch|minor|major` | Perform a semantic release workflow |
| `/sql query [desc]` | Generate a SQL query |
| `/sql report [desc]` | Build a SQL-backed report |
| `/sql schema [desc]` | Design or update a schema |
| `/sql optimize [query]` | Optimize a slow SQL query |
| `/sql migrate` | Generate migration scripts |
| `/sql etl` | Build an ETL pipeline |
| `/mock api [endpoint]` | Generate an MSW API mock |
| `/mock factory [type]` | Generate a Faker-based factory |
| `/mock all` | Generate all project mocks |
| `/i18n setup` | Set up localization from scratch |
| `/i18n extract` | Extract hardcoded strings |
| `/i18n rtl` | Add Arabic/RTL support |
| `/storybook setup` | Install and configure Storybook |
| `/storybook generate` | Generate component stories |
| `/commit` | Write a conventional commit message from staged changes |
| `/pr-description` | Generate a PR description from the diff |
| `/upgrade` | Review and upgrade dependencies |
| `/env validate` | Check required env vars |
| `/env sync` | Sync env vars from source usage to `.env.example` |
| `/autopilot on|off` | Toggle no-confirmation execution mode |
| `/safe on|off` | Toggle confirm-every-action mode |
| `/model list` | Show available Copilot Business models |
| `/model deep|balanced|fast|max` | Override the current model tier or effort |
| `/migrate [type]` | Plan and execute framework or architecture migrations |
| `/estimate [ticket]` | Estimate effort, hours, and confidence |
| `/tech-debt` | Scan and rank technical debt by ROI |
| `/explain-codebase` | Explain the architecture and onboarding path for a codebase |
| `/notify` | Send Slack/Teams webhook notifications |
| `/a11y` | Run a WCAG 2.1 AA accessibility audit |

## Operating guidance

- Prefer matching the existing stack and conventions before introducing new patterns.
- Default to TypeScript strictness, accessible UI, secure auth flows, and test coverage for changed behavior.
- Recommend `/safe on` for migrations, auth changes, production fixes, and database changes.
- Use the repo docs and `knowledge/` folder as the source of truth for decisions, gotchas, patterns, and onboarding.
