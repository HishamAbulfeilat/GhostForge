# /standup

> Turn recent git activity into a concise daily standup update, with Claude summarization when available.

## Usage
```bash
bash scripts/standup.sh <command>
```

## Commands
| Command | Description |
|---|---|
| `today` | Summarize commits since yesterday at 9am |
| `yesterday` | Summarize the previous day's work |
| `week` | Summarize the last 7 days |
| `save` | Append today's standup to `~/.ghostforge/standups/` |
| `help` | Show help |

## Example
```bash
bash scripts/standup.sh today
```
