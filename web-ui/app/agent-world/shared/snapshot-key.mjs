// What makes two world snapshots "the same" for the page: every session's
// identity, activity time, status, health, context and tool counters, plus the
// counts and collector errors. Shared by the client (skip re-rendering an
// unchanged poll) and the push hub (only send changed snapshots). Plain JS so
// the Node servers can import it unbuilt. The heartbeat is left out on purpose.

/** @param {any} world */
export function snapshotKey(world) {
  if (!world || typeof world !== 'object') return ''
  const sessions = Array.isArray(world.sessions) ? world.sessions : []
  return JSON.stringify([
    world.counts ?? null,
    sessions.map(s => [
      s?.id, s?.updatedAt, s?.status, s?.health, s?.model,
      s?.context?.used, s?.context?.compactions, s?.lastTool?.name, s?.toolCalls, s?.subagents, s?.errors,
    ]),
    (Array.isArray(world.events) ? world.events : []).map(e => [e?.type, e?.error]),
  ])
}
