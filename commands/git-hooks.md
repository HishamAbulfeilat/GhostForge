# /git-hooks Command

## Purpose
Set up git hooks in any project in one command: installs Husky, lint-staged, and commitlint for enforced code quality on every commit.

## Usage
```bash
/git-hooks
/git-hooks /path/to/project
/git-hooks --minimal   # Only husky + lint-staged (no commitlint)
/git-hooks --remove    # Remove all hooks
```

## Options
| Option | Description |
|---|---|
| `[path]` | Target project directory (default: current directory) |
| `--minimal` | Skip commitlint (just lint-staged) |
| `--remove` | Remove Husky and all hooks |
| `--bun` | Use bun instead of npm |
| `--pnpm` | Use pnpm instead of npm |

## What Gets Installed
| Tool | Hook | What it does |
|---|---|---|
| `husky` | pre-commit | Runs lint-staged before every commit |
| `lint-staged` | pre-commit | Runs ESLint + Prettier on staged files only |
| `@commitlint/cli` | commit-msg | Validates Conventional Commits format |
| `@commitlint/config-conventional` | commit-msg | Commit message rules |

## Commit Message Rules (after install)
```
feat: add new feature      ✅
fix: resolve bug           ✅
WIP: some work             ❌ (blocked by commitlint)
fixed stuff                ❌ (blocked by commitlint)
```

## What AI does step by step
1. Detects package manager (npm/pnpm/bun/yarn).
2. Installs `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`.
3. Runs `npx husky init` to create `.husky/` directory.
4. Writes `.husky/pre-commit` with `npx lint-staged`.
5. Writes `.husky/commit-msg` with `npx --no -- commitlint --edit $1`.
6. Adds `lint-staged` config to `package.json` targeting `*.{ts,tsx,js,jsx}`.
7. Creates `commitlint.config.js` with conventional config.
8. Runs a test commit to verify setup.
