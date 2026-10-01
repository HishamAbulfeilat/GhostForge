# Agent World

GhostForge provides two views over the same real agent-team state:

- `/agent-world` is the authenticated, operator-safe view for end users and project operators.
- `/maintainer-world` is the private monitor for maintainers with `admin_tools`.
- `/agents` remains the administrative command dashboard for starting, stopping, messaging, and assigning the team.

## Data flow

`.agent-sync/team.json`, the current `.agent-sync/state` snapshot, and the bounded connector federation configured through `GF_AGENT_SESSION_CONNECTORS` are read by `web-ui/lib/agent-team-api.ts`. The API exposes two contracts:

- `GET /api/agents?view=public` returns a server-sanitized local and federated snapshot to any authenticated user.
- `GET /api/agents` returns the complete bounded connector/session records, configured roles and strengths, models, messages, leadership, dependencies, and live progress only to `admin_tools` users.
- `POST /api/agents` remains `admin_tools`-only.

`web-ui/app/agent-world/agent-world-model.ts` retains the integration contract and combines local runtime records with connector sources, federated sessions, agents, tasks, and events. `web-ui/lib/agent-world.ts` projects those records into spatial nodes and real relationships:

- source → reported record
- agent/session → owned task
- dependency task → dependent task
- agent → spawned session
- sender → recipient for real session messages

Unknown, offline, and stale records remain explicit. The UI does not create placeholder workers, fake occupancy, or arbitrary links.

## Privacy boundary

The public response removes messages, events, bounded session records, models, device details, provider connector details, strengths, cooldowns, acceptance criteria, and maintainer-only errors. Credential-like values and absolute local paths are redacted on the server before the payload reaches the browser. The UI sanitizes displayed text again as defense in depth.

Middleware requires authentication for both routes. The access profile additionally gates `/maintainer-world` and `/agents` behind `admin_tools`.

## Themes

Both routes provide three original spatial presentations over the same real node set:

- **GhostForge Forge** places the boss/co-lead at a control hearth, workers and spawned sessions at forge stations, and tasks on workflow rails.
- **Agent Office** places sources at reception, leaders in the boss room, workers at deterministic desks, sessions on the team floor, and tasks in a review pod.
- **AI Town** maps connector sources to a source district, deterministically places agent/session figures from their real IDs, and routes tasks through the delivery commons.

TaskVille remains a visual reference for the original GhostForge Forge scene. Agent Office uses a pixel-office vocabulary (tiled floor, desks, rooms, status emotes, and focusable figures), while AI Town uses a pixel-town vocabulary (buildings, districts, paths, and figures). The implementation uses original CSS, HTML, and SVG geometry and copies no third-party source code, images, sprites, fonts, runtime systems, or data. Theme selection is stored separately for the public and maintainer routes. The temporary `taskville` stored value from the intermediate implementation migrates to `forge`.

Visual references were reviewed under their upstream MIT licenses:

- **AI Town** — `a16z-infra/ai-town`, MIT License, Copyright (c) 2023 Andreessen Horowitz. <https://github.com/a16z-infra/ai-town/blob/main/LICENSE>
- **Agent Office** — `harishkotra/agent-office`, MIT License, Copyright (c) 2026 Harish Kotra. <https://github.com/harishkotra/agent-office/blob/main/LICENSE>
- **Pixel Agents** — `pablodelucca/pixel-agents`, MIT License, Copyright (c) 2026 Pablo De Lucca. <https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE>

The complete notices are preserved in `THIRD_PARTY_NOTICES.md`. No upstream implementation or asset is redistributed, so no third-party runtime or asset license is added to the product bundle.

## Accessibility and RTL

Every agent and session figure is a keyboard-focusable button with role, source, status, current task, and maintainer details on focus or hover. SVG topology paths include relationship titles, while expandable text relationships and a data table provide non-visual fallbacks. Theme selection uses `aria-pressed`, status progress uses progressbar semantics, and errors and refresh state are announced. Motion is limited to `motion-safe` transitions. Logical Tailwind classes preserve RTL behavior; smaller viewports receive a bounded horizontal spatial canvas plus the full table/relationship fallbacks.

## Known integration follow-up

Agent World faithfully renders the workflow leader reported by the integration snapshot. The separate team-command contract still defaults an omitted `add`/`dispatch` leader to `null` and relies on the underlying team CLI/configuration to select leadership. Changing that dispatch default is outside this visualization change and should be handled in the agent-team command layer with JS/TS parity tests.
