# GhostForge — Claude Configuration

This is the **GhostForge** (`ghostforge-agents`), a GitHub Copilot supercharger for React/Next.js/TypeScript development at GhostForge.

## Project context

- **Stack**: React 18+, Next.js 14+, TypeScript, Tailwind CSS, Azure DevOps
- **Team**: GhostForge frontend developers
- **RTL**: Arabic/RTL support is a first-class concern — always use logical CSS properties and test with Arabic content
- **Design language**: Distinctive, intentional UI. Avoid generic AI tells (Inter-for-everything, purple gradients, cards-in-cards)

## Always-on skills

The following skills are **active by default** for every session in this project:

@.claude/skills/frontend-design/SKILL.md

@.claude/skills/find-skills/SKILL.md

## Default behaviours

- When asked to build any UI or frontend component, apply the **frontend-design** skill automatically — make opinionated aesthetic choices, avoid templated defaults
- When a user asks "how do I do X", "find a skill for X", or wants to extend capabilities — apply the **find-skills** skill and suggest `npx skills find <query>`
- When building for Arabic/RTL, follow the RTL section of the frontend-design skill
- Always prefer TypeScript over JavaScript
- Use Tailwind CSS utility classes unless a different CSS approach is specified
- Follow Conventional Commits for any git operations

## Available commands

Run `ghostforge --help` or launch `node tui/index.js` for the full interactive TUI.

Key slash commands: `/component`, `/page`, `/fix`, `/review`, `/commit`, `/pr-description`, `/pentest`, `/career-cv`, `/career-prep`, `/marketplace`, `/voice`

## Marketplace

29+ curated sources available via `ghostforge marketplace`. Highlights:
- **Impeccable** — 23 design commands, 46 detector rules (`npx impeccable install`)
- **Frontend Design Plugin** — official Anthropic plugin (`claude plugin add frontend-design`)
- **Career Helper** — 14 career skills (`claude plugin marketplace add Zal4DW/career-helper`)
- **HackingTool** — 185+ pentesting tools (`ghostforge pentest scan`)
