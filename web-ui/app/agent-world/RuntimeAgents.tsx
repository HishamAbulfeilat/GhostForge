'use client'

/** GhostForge runtime agents (boss/workers) shown in the town and office worlds. */
export default function RuntimeAgents({
  agents, selectedId, onSelect,
}: {
  agents: { id: string; name: string; role: string; status: string; task: string }[]
  selectedId?: string
  onSelect: (id: string | undefined) => void
}) {
  if (!agents.length) return null
  const selected = agents.find(a => a.id === selectedId)
  return (
    <section aria-label="GhostForge agents" className="min-w-0 rounded-xl border border-gf-line p-3">
      <h3 className="text-sm font-semibold">GhostForge agents <span className="font-normal text-gf-muted">· {agents.length}</span></h3>
      <ul className="mt-2 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {agents.map(agent => (
          <li key={agent.id} className="min-w-0">
            <button
              type="button"
              aria-pressed={agent.id === selectedId}
              onClick={() => onSelect(agent.id === selectedId ? undefined : agent.id)}
              className="min-h-11 w-full rounded-lg border border-gf-line2 p-2 text-start hover:border-gf-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-gf-accent aria-pressed:border-gf-accent"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words text-sm font-semibold">{agent.name}</span>
                <span className="shrink-0 text-xs text-gf-muted">{agent.role}</span>
              </span>
              <span className="mt-1 block text-xs text-gf-muted">{agent.status}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <p aria-live="polite" className="mt-3 break-words border-t border-gf-line pt-3 text-sm">
          <span className="font-semibold">{selected.name}:</span> {selected.task || 'No current task description was reported.'}
        </p>
      )}
    </section>
  )
}
