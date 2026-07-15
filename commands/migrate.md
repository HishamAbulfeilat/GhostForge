# /migrate Command

## Purpose
Plan and execute framework or architecture migrations in controlled, verifiable steps.

## Usage
| Command | Description |
|---|---|
| `/migrate cra-to-vite` | Migrate Create React App to Vite |
| `/migrate class-to-hooks` | Convert React class components to functional components with hooks |
| `/migrate js-to-ts` | Add TypeScript to a JavaScript project |
| `/migrate rn-upgrade [from] [to]` | Upgrade a React Native app between versions |
| `/migrate redux-to-zustand` | Replace Redux state with Zustand |
| `/migrate pages-to-app` | Migrate Next.js Pages Router to App Router |
| `/migrate css-to-tailwind` | Convert CSS/SCSS styling to Tailwind utilities/components |
| `/migrate node-to-nestjs` | Migrate an Express app to NestJS |

## Examples
```bash
/migrate cra-to-vite
/migrate class-to-hooks
/migrate js-to-ts
/migrate rn-upgrade 0.72 0.74
/migrate redux-to-zustand
/migrate pages-to-app
/migrate css-to-tailwind
/migrate node-to-nestjs
```

## What AI does
1. Analyzes the current codebase, build config, dependencies, and folder structure.
2. Creates a migration plan with phases, prerequisites, rollback notes, and blockers.
3. Estimates effort, affected files, risky areas, and breaking changes.
4. Recommends `/safe on` before applying changes.
5. Executes the migration step by step instead of doing a risky big-bang rewrite.
6. Runs targeted tests after each step and fixes regressions before continuing.
7. Summarizes what changed, what still needs manual verification, and any follow-up cleanup.
