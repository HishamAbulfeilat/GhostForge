# /career-prep

> Generate and open structured interview prep briefs for target companies.

## Usage
```bash
ghostforge career-prep <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `<company>` | Create or open a prep brief for the company |
| `prep <company>` | Explicitly create or open a prep brief |
| `list` | List all saved prep briefs |
| `open <company>` | Open the most recent prep brief for a company |
| `delete <company>` | Delete all prep briefs for a company |
| `version` | Print the script version |

## Examples
```bash
ghostforge career-prep GhostForge
ghostforge career-prep prep "Microsoft"
ghostforge career-prep list
ghostforge career-prep open "Microsoft"
ghostforge career-prep delete "Old Company"
```
