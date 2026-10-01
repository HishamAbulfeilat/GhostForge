# Agent World

GhostForge provides two views over the same real agent-team state:

- `/agent-world` is the authenticated, operator-safe view for end users and project operators.
- `/maintainer-world` is the private monitor for maintainers with `admin_tools`.
- `/agents` remains the administrative command dashboard for starting, stopping, messaging, and assigning the team.

Both Agent World routes provide three original spatial presentations over the same snapshot: GhostForge Forge, Agent Office, and AI Town. Theme selection is stored separately for the public and maintainer routes. The intermediate `taskville` stored value migrates to `forge`.

## Data flow and access

The page loads `GET /api/agents`, which requires a signed-in account with the
`admin_tools` permission. The public route instead requests
`GET /api/agents?view=public`, which returns a server-sanitized snapshot to
authenticated users. The maintainer route requests the full bounded snapshot
and is restricted to `admin_tools`; `POST /api/agents` remains
`admin_tools`-only. Unauthenticated users are sent to sign in, and unauthorized
accounts receive an access-denied state rather than an empty successful view.

`.agent-sync/team.json`, the current `.agent-sync/state` snapshot, and the
bounded connector federation configured through `GF_AGENT_SESSION_CONNECTORS`
are read by `web-ui/lib/agent-team-api.ts`. The API returns a `snapshot` with
runtime health and process state, agents, board tasks, team messages, phase,
and workflow metadata, along with a versioned `connectorSnapshot`. The latter
contains the federation `mode` (`local-only` or `allowlisted`) and connector
records with identity/scope (`id`, `source`, `project`, `device`, and
`provider`), status, heartbeat, stale threshold, boolean `stale`/`online`
flags, optional errors, and bounded `agents`, `tasks`, `sessions`, and
`events` arrays.

The UI combines local runtime data with connector records. It does not start
agents or sessions; refresh requests a new snapshot. Failed and denied requests
are shown as errors or access states. The spatial projection draws only
reported records and relationships:

- source → reported record
- agent/session → owned task
- dependency task → dependent task
- agent → spawned session
- sender → recipient for real session messages

Unknown, offline, and stale records remain explicit. The UI does not create
placeholder workers, fake occupancy, or arbitrary links. The Agent Office
session map and workflow dependency graph are also snapshot-driven; dependency
edges are drawn only when their target resolves uniquely.

## Privacy boundary

The public response removes messages, events, bounded session records, models,
device details, provider connector details, strengths, cooldowns, acceptance
criteria, and maintainer-only errors. Credential-like values and absolute
local paths are redacted on the server before the payload reaches the browser.
The UI sanitizes displayed text again as defense in depth.

Middleware requires authentication for both routes. The access profile
additionally gates `/maintainer-world` and `/agents` behind `admin_tools`.

## Local-only default and connector configuration

With `GF_AGENT_SESSION_CONNECTORS` unset or empty, the API makes no external
connector requests. It returns the `ghostforge-local` connector and reports
`mode: "local-only"`. External data is opt-in: set
`GF_AGENT_SESSION_CONNECTORS` in the web/API server environment to a JSON object
or array of connector objects. For example:

```json
[
  {
    "id": "build-host",
    "source": "device",
    "project": "services/api",
    "device": "build-host-01",
    "provider": "copilot",
    "allow": true,
    "url": "https://agents.example.com/api/snapshot",
    "timeoutMs": 5000,
    "staleAfterMs": 30000
  }
]
```

Use `source: "cloud"` or `"device"` for remote connectors. `allow: true` is
required for a connector to be queried; unapproved entries are not included in
the returned connector list. The URL is fetched server-side with `GET` and an
`Accept: application/json` header. Optional custom request headers can be
configured with `headers`; inject sensitive values through runtime
configuration and never commit them. Redirects are rejected.

Each active remote endpoint must return JSON with a parseable `heartbeat` and
optional array fields `agents`, `tasks`, `sessions`, and `events`. It may wrap
these fields in a `snapshot` object. A record can include `status` (`online`,
`stale`, or `offline`) or an `online` boolean. Connector IDs must be unique;
`ghostforge-local` is reserved. The configuration is limited to 20 entries and
64 KiB; remote responses are limited to 64 KiB and requests time out after
5 seconds by default. `timeoutMs` is bounded to 250 ms–60 s, while
`staleAfterMs` is bounded to 1 second–24 hours (30 seconds by default).

`project` is a workspace-relative scope, defaults to `.`, and cannot escape
the repository workspace. Absolute project paths and parent-directory
traversal are rejected. Invalid remote endpoint responses and request failures
produce an offline connector record rather than failing the entire snapshot;
invalid top-level connector configuration (for example, duplicate or reserved
IDs) is an API error.

## Identity and projected data

Connector IDs identify sources in the federation. The built-in local
connector's ID is `ghostforge-local`; its source is `local`, project is `.`,
and provider is `ghostforge`. For remote records, configured connector
metadata—not untrusted record fields—sets connector ID, source, project,
device, and provider.

An incoming session's identity is its `id` (or `sessionId` when `id` is
missing) within its connector scope. The projection assigns source, project,
device, and provider from that connector's configuration and does not trust
same-named fields supplied by the session. Treat the full scope (connector id,
source, project, device, provider, and session ID) as its identity; session IDs
alone are not guaranteed to be globally unique.

Connector records are bounded projections, not raw endpoint payloads: at most
100 records are retained per collection, selected fields and string lengths
are capped, and unrecognized session fields are omitted. Sessions without an
ID are omitted. The local connector does not synthesize session records, so
its `sessions` array is empty; local team messages are projected as events.

## Online, stale, offline, and unknown

- **Online** means a usable heartbeat is within the connector's stale window.
  Remote connectors may also explicitly report offline; that overrides a
  recent heartbeat. The local connector additionally requires the runtime PID
  in `status.json` to be running.
- **Stale** means a heartbeat is older than `staleAfterMs`; the record is
  marked stale and not online. A remote connector can also explicitly report
  `status: "stale"`. Stale records may still contain projected agents, tasks,
  sessions, and events; stale is not an empty-data guarantee.
- **Offline** means the source is unavailable or not considered active. A
  missing or invalid remote heartbeat, a failed request, an invalid payload,
  or an explicitly offline remote connector is offline. A heartbeat more than
  60 seconds in the future is also offline.
- **Unknown** is not another connector health status. Missing agent state is
  normalized to `"unknown"` rather than guessed, and the UI displays
  `"unknown"` if a connector record has no status. Missing snapshot data is
  represented as absent/empty data or nullable values, not as proof that no
  activity exists.

For an unavailable **remote** connector, the fallback record has empty
`agents`, `tasks`, and `sessions` arrays, but `events` contains a
`connector.error` entry with the error and timestamp. This is intentional:
the events list explains why the source is offline. In contrast, an offline
**local** connector is built from local runtime files and may still contain
projected agents, tasks, or events; do not assume that every offline connector
has empty data arrays.

## Runtime state and `GF_AGENT_STATE`

The local connector reads `status.json`, `board.json`, and `messages.jsonl`
from the agent-team state directory. By default this is
`.agent-sync/state/`. `GF_AGENT_STATE` overrides that directory for the local
connector; the web/API process must receive the same setting as the boss and
other controls to observe the same runtime.

The local connector's `heartbeat` is the modification time of the selected
state directory's `status.json`, not a timestamp copied from its JSON content.
It uses a 30-second stale window and reports offline if there is no readable
status-file heartbeat or the PID recorded in that file is not running. The
snapshot reader and heartbeat lookup use the same resolved `GF_AGENT_STATE`
directory, so setting the variable changes both which runtime data is read and
which `status.json` modification time is used.

For the web/API process, keep the resolved override inside the repository
workspace; an invalid or escaping override falls back to the default state
directory. Set the value consistently in the environment of the boss, web
server, and any other process that needs to share runtime state.

## Original visual design and accessibility

GhostForge Forge places the boss/co-lead at a control hearth, workers and
spawned sessions at forge stations, and tasks on workflow rails. Agent Office
places sources at reception, leaders in the boss room, workers at deterministic
desks, sessions on the team floor, and tasks in a review pod. AI Town maps
connector sources to a source district, deterministically places agent/session
figures from their real IDs, and routes tasks through the delivery commons.
The implementation uses original CSS, HTML, and SVG geometry and copies no
third-party source code, images, sprites, fonts, runtime systems, or data.

Visual references were reviewed under their upstream MIT licenses:

- **AI Town** — `a16z-infra/ai-town`, MIT License, Copyright (c) 2023 Andreessen Horowitz. <https://github.com/a16z-infra/ai-town/blob/main/LICENSE>
- **Agent Office** — `harishkotra/agent-office`, MIT License, Copyright (c) 2026 Harish Kotra. <https://github.com/harishkotra/agent-office/blob/main/LICENSE>
- **Pixel Agents** — `pablodelucca/pixel-agents`, MIT License, Copyright (c) 2026 Pablo De Lucca. <https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE>

The complete notices are preserved in `THIRD_PARTY_NOTICES.md`. No upstream
implementation or asset is redistributed, so no third-party runtime or asset
license is added to the product bundle. No third-party art assets are used.

Every agent and session figure is a keyboard-focusable button with role,
source, status, current task, and maintainer details on focus or hover. SVG
topology paths include relationship titles, while expandable text relationships
and a data table provide non-visual fallbacks. Theme selection uses
`aria-pressed`, status progress uses progressbar semantics, and errors and
refresh state are announced. Motion is limited to `motion-safe` transitions.
Logical Tailwind classes preserve RTL behavior; smaller viewports receive a
bounded horizontal spatial canvas plus full table/relationship fallbacks.
