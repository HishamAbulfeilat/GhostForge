# Changelog

## v2.7.0 — 2026-07-16

f182873 feat: add ghostforge-ai VS Code extension (v2.6.0)

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
fb85adc ci: add mirror workflow to HishamAbulfeilat/GhostForge
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

- Initial GhostForge AI Developer Toolkit release
- Terminal UI launcher with setup, project open, commands, agents, instructions, tickets, security, test, deploy, readme, version, and help screens
- 14 specialized AI agents for frontend, mobile, backend, DevOps, QA, security, data, CMS, and architecture workflows
- 27 slash command documents covering setup, scaffolding, testing, security, tickets, deployment, SQL, Storybook, i18n, and release workflows
- Project onboarding scripts for new and existing repositories, toolkit syncing, environment setup, version bumping, and Azure deployment
- Copilot instruction packs for React, React Native, Next.js, TypeScript, Tailwind, Azure, Docker, SQL reporting, testing strategy, and team workflow standards
- GitHub Copilot workspace integration via .github and .vscode settings plus cloud-agent setup steps

---
