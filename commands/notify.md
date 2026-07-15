# /notify Command

## Purpose
Send Slack or Microsoft Teams webhook notifications for toolkit events, project status, or delivery updates.

## Usage
| Command | Description |
|---|---|
| `/notify setup` | Configure Slack/Teams webhook URLs and save them to `.env.local` |
| `/notify slack [message]` | Send a Slack notification |
| `/notify teams [message]` | Send a Teams notification |

## Examples
```bash
/notify setup
/notify slack Build failed on staging
/notify teams Critical ticket assigned to mobile squad
```

## Auto-triggers
- Health score `< 70` → warning
- Critical ticket assigned → critical
- Failed deploy → critical

## What AI does
1. Helps configure webhook URLs and stores them in `.env.local`.
2. Formats notifications with toolkit name, version, timestamp, severity color, and optional action link.
3. Sends notifications through `scripts/notify.sh` for Slack or Teams.
4. Reuses the same workflow for automatic health, ticket, and deploy alerts.
