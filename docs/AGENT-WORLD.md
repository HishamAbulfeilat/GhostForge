# Agent World

Agent World (`/agent-world`) is a read-only, snapshot-driven view of GhostForge
runtime activity and explicitly enabled external agent/session sources. Its
visual direction takes inspiration from [TaskVille](https://taskville.co/),
[a16z AI Town](https://github.com/a16z-infra/ai-town), and
[Agent Office](https://github.com/harishkotra/agent-office). GhostForge's
presentation is its own; these references are credits for inspiration, not
claims about asset licenses. Do not copy artwork or assume third-party asset
licenses.

## Access and snapshot surface

The page loads `GET /api/agents`, which requires a signed-in account with the
`admin_tools` permission. The page redirects unauthenticated users to sign in
and shows an access-denied state to accounts without that permission. The API
returns the local team snapshot together with a versioned `connectorSnapshot`:

- `snapshot` contains runtime health and process state, agents, board tasks,
  team messages, phase, and workflow metadata.
- `connectorSnapshot` contains a `version`, a federation `mode` (`local-only`
  or `allowlisted`), and a list of connector records.
- Each connector reports its identity and scope (`id`, `source`, `project`,
  `device`, and `provider`), `status`, `heartbeat`, `staleAfterMs`, boolean
  `stale` and `online` flags, an optional `error`, and `agents`, `tasks`,
  `sessions`, and `events` arrays.

The UI combines the local runtime snapshot with connector records. It does not
start agents or sessions; refresh requests a new snapshot. A failed or denied
request is shown as an error, access-denied state, or sign-in redirect rather
than being presented as an empty successful snapshot.

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
configured with `headers`; inject any sensitive values through the server's
runtime configuration and never commit them. Redirects are rejected.

Each active remote endpoint must return JSON with a parseable `heartbeat` and
optional array fields `agents`, `tasks`, `sessions`, and `events`. It may wrap
these fields in a `snapshot` object. A record can include `status` (`online`,
`stale`, or `offline`) or an `online` boolean. Connector IDs must be unique;
`ghostforge-local` is reserved. The connector configuration is limited to 20
entries and 64 KiB; remote responses are limited to 64 KiB and requests time
out after 5 seconds by default. `timeoutMs` is bounded to 250 ms–60 s, while
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
metadata—not untrusted record fields—sets the connector ID, source, project,
device, and provider.

An incoming session's identity is its `id` (or `sessionId` when `id` is
missing) within its connector scope. The projection assigns source, project,
device, and provider from that connector's configuration and does not trust
same-named fields supplied by the session. Treat the full scope
(`connector id`, source, project, device, provider, and session ID) as its
identity; session IDs alone are not guaranteed to be globally unique.

Connector records are bounded projections, not raw endpoint payloads: at most
100 records are retained per collection, selected fields and string lengths
are capped, and unrecognized session fields are omitted. Sessions without an
ID are omitted. The local connector does not currently synthesize session
records, so its `sessions` array is empty; local team messages are projected
as events.

## Online, stale, offline, and unknown

- **Online** means a usable heartbeat is within the connector's stale window.
  Remote connectors may also explicitly report offline; that overrides a
  recent heartbeat. The local connector additionally requires the runtime PID
  in `status.json` to be running.
- **Stale** means a heartbeat is older than `staleAfterMs`; the record is
  marked stale and not online. A remote connector can also explicitly report
  `status: "stale"`. Stale records may still contain the last projected agents,
  tasks, sessions, and events; stale is not an empty-data guarantee.
- **Offline** means the source is unavailable or not considered active. A
  missing or invalid remote heartbeat, a failed request, an invalid payload,
  or an explicitly offline remote connector is offline. An implausibly
  future-dated heartbeat (more than 60 seconds ahead) is also offline.
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
