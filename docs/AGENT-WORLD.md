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

The Agent Town selector also exposes a separately managed a16z AI Town world.
Its Start/Stop controls manage the local Convex and frontend runtime, and Open
embeds the frontend in an iframe. This external world is independent of the
agent/session snapshot. See [AI Town setup and smoke test](AI-TOWN.md).

Likewise the Office view has Start/Stop/Open controls for the upstream
harishkotra/agent-office app (Colyseus server + client on 127.0.0.1). See
[Agent Office setup and smoke test](AGENT-OFFICE.md).

## CLI sessions (Claude Code and Copilot)

Agent World also shows this machine's **Claude Code** and **GitHub Copilot CLI**
sessions. They come from `GET /api/agents/cli-sessions`, which requires
`admin_tools` like `/api/agents` and can be switched off with
`GF_CLI_SESSIONS=0`.

- The **CLI Sessions** tab lists them with usage, cost, tool counts, subagents,
  errors and health; selecting one opens its detail.
- CLI sessions also appear as **characters** in Forge World, Agent Town and
  Agent Office next to the runtime agents, each tagged with its source. Use the
  Live / Today toggle next to the world switcher to include sessions that
  finished recently.
- The collector (`web-ui/lib/cli-sessions.mjs`) reads `~/.claude/projects`
  transcripts and `~/.copilot/session-store.db` (read-only) on the server's
  machine. Transcripts are parsed incrementally from their last byte offset.

Privacy: metadata only. Cost and token totals come from Claude Code's own
`cost-state` records and Copilot's aggregate columns; prompts, messages, tool
arguments, tool output, checkpoint notes and Copilot's prompt-text `summary`
column are never returned. Subagents are reported by type only. A standalone
copy of this collector runs outside the repo as the external Agent World app —
keep the two in step when changing what is read.

### Same Agent World as the external app

`web-ui/app/agent-world/shared/` is byte-identical to the external Agent World
app's `src/agent-world/shared/` (repo `agent-world-external`), and
`web-ui/vendor/` matches its `vendor/` apart from the NOTICE copy notes. The
only differences are the wiring: GhostForge serves the data from
`/api/agents/cli-sessions` (admin_tools) and its worlds also show the
GhostForge runtime agents and boss next to the CLI sessions. Check with
`diff -r agent-world-external/src/agent-world/shared GhostForge/web-ui/app/agent-world/shared`.

Features (both apps):

- **Status columns** in every world — *Needs you* (waiting on you, or stalled /
  rate limited / erroring) · *Working* · *Done* · *Ended*; a card opens the
  session drawer.
- **Needs-you badge** next to Refresh, with a list, and one browser
  notification when a session *newly* needs you (permission asked once).
- **Chat box** (bottom corner): message a Claude Code session.
  `POST /api/agents/cli-sessions/chat` `{ sessionId, message }` (admin_tools,
  JSON, same-origin) runs `claude -p --resume <id> --output-format json` in the
  session's folder with the message on stdin — no shell — and returns the
  reply. Only sessions in the current snapshot can be messaged; Copilot sessions
  cannot yet. Off with `GF_CLI_CHAT=0` (or `GF_CLI_SESSIONS=0`). `CLAUDE_BIN`
  overrides the binary. The page still reads metadata only; the chat box shows
  just what you typed and Claude's reply.
- **Agent Town** (a16z AI Town) and **Agent Office** (harishkotra/agent-office)
  — short rotating bubbles (≤ 6 words: current tool or state, never message
  text) through the upstream bubbles; Office cinematic camera follow on
  `highlight-event` when a session needs you, `chat` messages for chat-box
  traffic, `layout-sync` plus drag-to-move layout edit, and an activity log.
- **Context trash can**: each session's context-window fill; a page drops into
  the can when Claude Code compacts.
- **Minimap** on both scenes (positions read from the Pixi viewport / Phaser
  camera); click or drag to pan.
- **Ambience**: day/night tint from local time; sessions idle 3+ minutes walk
  to a break area. `prefers-reduced-motion` turns walking and animations off.
- **Raw JSON** in the session drawer: the detail response as returned.

`GET /api/agents/cli-sessions?format=connector` returns the snapshot in the
connector format below, trimmed to stay under the 65,536-byte connector limit
(the external app serves the same at `http://127.0.0.1:3461/api/connector`, so
it can be registered as a `device` connector).

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
