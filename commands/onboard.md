# /onboard Command

## Description
Scans an existing project and generates a comprehensive onboarding guide for new developers — codebase overview, architecture, setup steps, and key patterns.

## Usage
```
/onboard                    → Generate full onboarding guide for current project
/onboard --output README    → Add onboarding section to README.md
/onboard --output ONBOARDING.md → Create separate ONBOARDING.md file
```

## Output Structure

```markdown
# Project Onboarding Guide

## Tech Stack
- Next.js 14 (App Router)
- TypeScript 5 (strict mode)
- Tailwind CSS + shadcn/ui
- Zustand + React Query v5
- NestJS backend (API)
- PostgreSQL + Prisma ORM
- Azure AD authentication
- Deployed to Azure Static Web Apps

## Setup (5 minutes)
1. Clone repo: `git clone ...`
2. Install: `npm install`
3. Copy env: `cp .env.example .env.local`
4. Fill in env vars (ask team lead for values)
5. Run: `npm run dev`

## Folder Structure
[auto-generated from actual project structure]

## Key Patterns
- Components: [shows the actual component pattern used]
- API calls: [shows how services are structured]
- State: [shows how Zustand stores are organized]
- Auth: [shows how protected routes work]

## Common Tasks
- Add a new page: [step-by-step for this specific project]
- Add an API call: [step-by-step]
- Add a new component: [step-by-step]
- Run tests: `npm test`
- Deploy to staging: `git push origin develop`

## Team Contacts
[prompt to fill in]
```
