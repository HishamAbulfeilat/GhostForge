# /tickets Command

## Description
Fetches and displays all bug tickets assigned to you from GitHub Issues, Azure DevOps Boards, or Jira — grouped by severity (Critical → High → Medium → Low).

## Usage
```
/tickets
/tickets bugs
/tickets critical
/tickets all
/tickets #142
```

## Examples
```
/tickets                    → Show all my assigned bugs by priority
/tickets critical           → Show only critical bugs
/tickets #142               → Show details + suggested fix for ticket #142
/tickets azure              → Force Azure DevOps source
/tickets github             → Force GitHub Issues source
```

## Behavior

1. **Auto-detect** the ticket source from environment variables (GitHub token, Azure PAT, Jira token)
2. **Fetch** all open bugs assigned to the current user
3. **Sort** and **group** by priority: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low
4. **Display** in a clean, readable table with ticket number, title, age, and link
5. **Optionally** dive into a specific ticket for AI-powered bug analysis and fix suggestion

## Priority Legend

| Icon | Level | Action |
|------|-------|--------|
| 🔴 | Critical | Fix before anything else — production blocker |
| 🟠 | High | Fix this sprint — significant user impact |
| 🟡 | Medium | Fix soon — minor to moderate impact |
| 🟢 | Low | Fix when time allows — cosmetic or edge case |

## See Also
- `agents/ticket-checker.md` — Full agent documentation and API details
- `instructions/azure.md` — Azure DevOps setup
