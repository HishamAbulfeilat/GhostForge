import type { AgentWorldRecord } from '../../app/agent-world/agent-world-model'

type WorkflowDependencyGraphProps = {
  tasks: AgentWorldRecord[]
}

function taskId(task: AgentWorldRecord): string | null {
  return typeof task.id === 'string' && task.id.trim() ? task.id.trim() : null
}

function reportedText(task: AgentWorldRecord, field: string): string | null {
  const value = task[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export default function WorkflowDependencyGraph({ tasks }: WorkflowDependencyGraphProps) {
  const taskIndexesById = new Map<string, number[]>()
  tasks.forEach((task, index) => {
    const id = taskId(task)
    if (!id) return
    const indexes = taskIndexesById.get(id) ?? []
    indexes.push(index)
    taskIndexesById.set(id, indexes)
  })

  return (
    <section aria-labelledby="agent-world-workflow-graph-heading" className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <h2 id="agent-world-workflow-graph-heading" className="font-display text-lg font-semibold">
        Workflow dependency graph
      </h2>
      {tasks.length ? (
        <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((task, index) => {
            const dependencies = Array.isArray(task.dependencies)
              ? [...new Set(task.dependencies.filter((dependency): dependency is string => typeof dependency === 'string')
                .map(dependency => dependency.trim()).filter(Boolean))]
              : []
            const dependencyTargets = dependencies.flatMap(dependencyId => {
              const matches = taskIndexesById.get(dependencyId)
              return matches?.length === 1
                ? [{ id: dependencyId, index: matches[0], task: tasks[matches[0]] }]
                : []
            })
            const id = taskId(task)
            const title = reportedText(task, 'title')

            return (
              <li key={index} id={`agent-world-workflow-task-${index}`} className="min-w-0 rounded-xl border border-gf-line/80 bg-gf-bar/60 p-3">
                <h3 className="break-words text-sm font-semibold">{title ?? id ?? 'Task identity not reported'}</h3>
                <p className="mt-1 break-words text-xs text-gf-muted">
                  {[
                    id && `ID: ${id}`,
                    reportedText(task, 'status') && `Status: ${reportedText(task, 'status')}`,
                    reportedText(task, 'kind') && `Kind: ${reportedText(task, 'kind')}`,
                    reportedText(task, 'source') && `Source: ${reportedText(task, 'source')}`,
                  ].filter(Boolean).join(' · ') || 'No task details were reported.'}
                </p>
                <div className="mt-3">
                  <h4 className="text-xs font-semibold text-gf-muted">Reported dependencies</h4>
                  {dependencyTargets.length ? (
                    <ul className="mt-1 flex flex-col gap-1 ps-4 text-sm">
                      {dependencyTargets.map(dependency => (
                        <li key={dependency.index} className="break-words">
                          <a
                            className="text-gf-accent underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent"
                            href={`#agent-world-workflow-task-${dependency.index}`}
                          >
                            <span aria-hidden="true">→ </span>
                            {dependency.id}{reportedText(dependency.task, 'title') ? `: ${reportedText(dependency.task, 'title')}` : ''}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-gf-muted">No dependency edges can be shown from the reported task IDs.</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">
          No workflow tasks were reported by the available snapshots.
        </p>
      )}
    </section>
  )
}
