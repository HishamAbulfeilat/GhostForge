# /career-linkedin

> Generate LinkedIn content calendars or single-post prompts from a topic or coach output.

## Usage
```bash
ghostforge career-linkedin <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `calendar <topic|file> [--days 30]` | Generate and save a numbered content calendar to `~/.career/linkedin-calendar-<date>.md` |
| `post <topic>` | Print a structured prompt for generating one LinkedIn post |
| `list` | List saved LinkedIn calendars |
| `open [date]` | Open the latest calendar or a specific `YYYY-MM-DD` calendar |
| `version` | Print the script version |

## Examples
```bash
ghostforge career-linkedin calendar "React career growth" --days 14
ghostforge career-linkedin calendar ./linkedin-coach-output.md
ghostforge career-linkedin post "Next.js performance wins"
ghostforge career-linkedin list
ghostforge career-linkedin open 2026-07-19
```
