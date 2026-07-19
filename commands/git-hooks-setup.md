# /git-hooks-setup

> Install lightweight repository hooks for carbon tracking, linting, type-checking, and conventional commits.

## Usage
```bash
bash scripts/git-hooks-setup.sh <command>
```

## Commands
| Command | Description |
|---|---|
| `install` | Create `.git/hooks/pre-commit` and `commit-msg` hooks |
| `uninstall` | Remove the installed GhostForge hooks |
| `status` | Show which hooks are installed and print their contents |
| `customize [hook]` | Open a hook in `$EDITOR` (default: `pre-commit`) |
| `help` | Show help |

## Example
```bash
bash scripts/git-hooks-setup.sh install
```
