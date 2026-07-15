# GhostForge Project Config

## Purpose
`.ghostforge-config.json` lets every project define the default GhostForge behavior for agents, tests, deployment, issue tracking, and package management.

## File Location
Create the file in the **project root**:

```json
.ghostforge-config.json
```

## Supported Options
| Key | Type | Description |
|---|---|---|
| `defaultAgent` | string | Preferred AI role such as `frontend`, `mobile`, `backend`, or `fullstack` |
| `testRunner` | string | Default test runner: `jest`, `vitest`, `playwright`, or `detox` |
| `deployTarget` | string | Preferred deploy target: `azure`, `vercel`, `gh-pages`, or `custom` |
| `issueTracker.provider` | string | `github`, `azure`, or `jira` |
| `issueTracker.projectKey` | string | Board key, repo key, or team-specific project key |
| `packageManager` | string | `npm`, `yarn`, `pnpm`, or `bun` |

## Example
```json
{
  "defaultAgent": "frontend",
  "testRunner": "vitest",
  "deployTarget": "vercel",
  "issueTracker": {
    "provider": "github",
    "projectKey": "ghostforge-web"
  },
  "packageManager": "pnpm"
}
```

## How commands read it
1. `/test` prefers the configured runner when multiple tools are present.
2. `/deploy` defaults to the configured deployment target.
3. `/tickets` and `/fix-tickets` use the configured issue tracker and key.
4. Agent activation can default to the configured role.
5. Future automation scripts can respect the configured package manager instead of assuming npm.
