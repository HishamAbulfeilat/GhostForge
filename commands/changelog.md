# /changelog Command

## Purpose
Auto-generate or update `CHANGELOG.md` from git commits using Conventional Commits format.

## Usage
```bash
/changelog
/changelog --since v2.0.0
/changelog --unreleased
/changelog --format keepachangelog
```

## Options
| Option | Description |
|---|---|
| `--since <tag>` | Generate log from a specific tag (default: last tag) |
| `--unreleased` | Show only unreleased commits (HEAD → last tag) |
| `--format keepachangelog` | Use Keep a Changelog format (default) |
| `--format conventional` | Use Conventional Commits format |
| `--dry-run` | Print to stdout, don't write file |

## Commit Types Recognized
| Type | Section |
|---|---|
| `feat:` | ✨ Features |
| `fix:` | 🐛 Bug Fixes |
| `perf:` | ⚡ Performance |
| `refactor:` | ♻️ Refactoring |
| `docs:` | 📚 Documentation |
| `chore:` | 🔧 Maintenance |
| `ci:` | 👷 CI/CD |
| `BREAKING CHANGE:` | 💥 Breaking Changes |

## What AI does step by step
1. Reads git tags to determine the version range.
2. Runs `git log` to collect commits since the last tag.
3. Groups commits by type (feat, fix, perf, etc.).
4. Formats into Keep a Changelog markdown.
5. Prepends new section to existing `CHANGELOG.md` or creates it.
6. Reports total commits processed and sections generated.

## Output Example
```markdown
## [2.8.0] — 2026-07-16

### ✨ Features
- add /api-types command for OpenAPI → TypeScript generation
- add /env-check for environment variable validation
- add /git-hooks installer for husky + lint-staged

### 🐛 Bug Fixes
- fix mirror workflow persist-credentials issue

### 🔧 Maintenance
- bump dependencies to latest
```
