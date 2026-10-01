# Agent World

GhostForge provides two views over the same real agent-team state:

- `/agent-world` is the authenticated, operator-safe view for end users and project operators.
- `/maintainer-world` is the private monitor for maintainers with `admin_tools`.
- `/agents` remains the administrative command dashboard for starting, stopping, messaging, and assigning the team.

## Data flow

`.agent-sync/team.json` and the current `.agent-sync/state` snapshot are read by `web-ui/lib/agent-team-api.ts`. The API exposes two contracts:

- `GET /api/agents?view=public` returns a server-sanitized snapshot to any authenticated user.
- `GET /api/agents` returns configured session roles, strengths, models, branches, messages, and current work only to `admin_tools` users.
- `POST /api/agents` remains `admin_tools`-only.

`web-ui/lib/agent-world.ts` turns either response into nodes, status-derived progress, and workflow relationships. Ownership edges come from real task owners. Private coordination edges come from real session messages. The UI does not create placeholder workers, connector nodes, or arbitrary links.

## Privacy boundary

The public response removes messages, models, branches, strengths, cooldowns, disabled sessions, and unknown task owners. Credential-like values and absolute local paths are redacted on the server before the payload reaches the browser. The UI sanitizes displayed text again as defense in depth.

Middleware requires authentication for both routes. The access profile additionally gates `/maintainer-world` and `/agents` behind `admin_tools`.

## Themes

Both routes provide three presentations over the same node set:

- **TaskVille** arranges live work into status lanes.
- **AI Town** separates configured agents and delivery work into districts.
- **Agent Office** presents configured sessions as desks beside a workflow review board.

The names describe visual inspiration only; no third-party source code or assets are copied. Theme selection is stored separately for the public and maintainer routes.

## Accessibility and RTL

The controls are keyboard accessible, selection state uses `aria-pressed`, progress uses native progressbar semantics, errors and refresh state are announced, and every visual world includes an expandable data table. Motion is limited to `motion-safe` color transitions. Layout and spacing use direction-neutral or logical Tailwind classes and remain usable at mobile, tablet, and desktop widths.
