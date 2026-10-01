# GhostForge Dev Monitor

Run `npm run monitor` from the repository root, then open
`http://127.0.0.1:4177`. Set `MONITOR_PORT` to choose another port; the server
always binds to IPv4 loopback. Stop it with Ctrl+C.

The page refreshes a read-only projection of `.agent-sync/state`, enabled team
workers, and matching sessions under `~/.copilot/session-state` and the
current-project directory under `~/.claude/projects`. Session discovery reads
bounded JSON/JSONL metadata and message tails; it does not return transcripts,
credentials, or arbitrary files. The UI and API use only same-origin requests.

Run the focused tests with `npm run test:monitor`.
