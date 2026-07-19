# /career-track

> Track job applications locally with SQLite when available, or JSON as a fallback.

## Usage
```bash
ghostforge career-track <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `add <company> <role> [url]` | Add a new application with status `applied` |
| `update <id> <status>` | Update status to `applied`, `screening`, `interview`, `offer`, `rejected`, or `withdrawn` |
| `list [--status <status>]` | List all applications or filter by status |
| `note <id> <text>` | Append a note to an application |
| `stats` | Show totals, status breakdown, response rate, and average days |
| `export` | Export tracked applications to `~/.career/applications.csv` |
| `ado-sync` | Print Azure DevOps sync guidance |
| `version` | Print the script version |

## Examples
```bash
ghostforge career-track add "GhostForge" "Frontend Developer" https://example.com/job/123
ghostforge career-track update 3 interview
ghostforge career-track list --status applied
ghostforge career-track note 3 "Recruiter scheduled technical interview"
ghostforge career-track stats
ghostforge career-track export
```
