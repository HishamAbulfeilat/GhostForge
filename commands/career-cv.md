# /career-cv

> Version-control your CV locally with git, compare versions, and export snapshots.

## Usage
```bash
ghostforge career-cv <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `init <path>` | Create `~/.career/cv/`, copy in a CV file, initialise git, and make the first commit |
| `save [message]` | Save current CV changes with an auto timestamp or custom commit message |
| `diff [v1] [v2]` | Compare CV versions; defaults to the last 2 commits |
| `versions` | Show CV version history |
| `log` | Alias for `versions` |
| `export [format]` | Export the current CV to `~/Desktop/CV-YYYY-MM-DD.<ext>` |
| `status` | Show current CV path, last saved version, and uncommitted changes |
| `version` | Print the script version |

## Examples
```bash
ghostforge career-cv init ~/Documents/CV.docx
ghostforge career-cv save "Updated summary for GhostForge role"
ghostforge career-cv diff HEAD~1 HEAD
ghostforge career-cv versions
ghostforge career-cv export pdf
ghostforge career-cv status
```
