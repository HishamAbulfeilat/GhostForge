# /git-autopilot

Git Autopilot suggests commits, branch names, and PR copy.

## Usage
```bash
ghostforge git-autopilot suggest-commit
ghostforge git-autopilot suggest-branch "add arabic dashboard"
ghostforge git-autopilot suggest-pr
```

## Commands
- `suggest-commit` — analyze staged diff, suggest a conventional commit, optionally run `git commit`
- `suggest-branch` — generate 3 kebab-case branch names
- `suggest-pr` — generate PR title + markdown description from `main..HEAD`
- `status` — show branch and git status
