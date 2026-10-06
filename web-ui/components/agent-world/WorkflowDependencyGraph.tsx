import type { AgentWorldRecord } from '../../app/agent-world/agent-world-model'

type WorkflowDependencyGraphProps = {
  tasks: AgentWorldRecord[]
}

type GraphNode = {
  index: number
  id: string | null
  title: string | null
  status: string | null
  x: number
  y: number
  dependencies: string[] | null
  resolvedDependencies: { id: string; title: string | null }[]
  unknownDependencies: UnknownDependency[]
  hasInvalidDependencyReferences: boolean
}

type DependencyEdge = {
  fromIndex: number
  toIndex: number
}

type UnknownDependency = {
  id: string
  reason: 'unresolved' | 'ambiguous'
}

type WorkflowGraph = {
  nodes: GraphNode[]
  edges: DependencyEdge[]
  columns: number
  duplicateTaskIdCount: number
  unresolvedCount: number
  ambiguousCount: number
  unreportedCount: number
  invalidCount: number
  incompleteMessages: string[]
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 76
const COLUMN_GAP = 64
const ROW_GAP = 48
const GRAPH_COLUMNS = 3
const GRAPH_PADDING = 32

function reportedText(task: AgentWorldRecord, field: string): string | null {
  const value = task[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function taskId(task: AgentWorldRecord): string | null {
  return reportedText(task, 'id')
}

function displayText(value: string, maxLength = 28): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function edgePath(from: GraphNode, to: GraphNode): string {
  const fromX = from.x + NODE_WIDTH / 2
  const fromY = from.y + NODE_HEIGHT / 2

  if (from.index === to.index) {
    return `M ${from.x + NODE_WIDTH} ${fromY - 10} C ${from.x + NODE_WIDTH + 48} ${fromY - 42}, ${from.x + NODE_WIDTH + 48} ${fromY + 42}, ${from.x + NODE_WIDTH} ${fromY + 10}`
  }

  const toX = to.x + NODE_WIDTH / 2
  const toY = to.y + NODE_HEIGHT / 2
  const dx = toX - fromX
  const dy = toY - fromY
  const scale = Math.min(
    Math.abs(dx) ? (NODE_WIDTH / 2 - 4) / Math.abs(dx) : Infinity,
    Math.abs(dy) ? (NODE_HEIGHT / 2 - 4) / Math.abs(dy) : Infinity,
  )
  const startX = fromX + dx * scale
  const startY = fromY + dy * scale
  const endX = toX - dx * scale
  const endY = toY - dy * scale
  const controlX = (startX + endX) / 2

  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`
}

function buildWorkflowGraph(tasks: AgentWorldRecord[]): WorkflowGraph {
  const columns = Math.max(1, Math.min(GRAPH_COLUMNS, tasks.length))
  const nodes: GraphNode[] = tasks.map((task, index) => ({
    index,
    id: taskId(task),
    title: reportedText(task, 'title'),
    status: reportedText(task, 'status'),
    x: GRAPH_PADDING + (index % columns) * (NODE_WIDTH + COLUMN_GAP),
    y: GRAPH_PADDING + Math.floor(index / columns) * (NODE_HEIGHT + ROW_GAP),
    dependencies: Array.isArray(task.dependencies)
      ? [...new Set(task.dependencies.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim()))]
      : null,
    resolvedDependencies: [],
    unknownDependencies: [],
    hasInvalidDependencyReferences: Array.isArray(task.dependencies)
      && task.dependencies.some(dependency => typeof dependency !== 'string' || !dependency.trim()),
  }))
  const nodeIndexesById = new Map<string, number[]>()

  nodes.forEach(node => {
    if (!node.id) return
    const indexes = nodeIndexesById.get(node.id) ?? []
    indexes.push(node.index)
    nodeIndexesById.set(node.id, indexes)
  })

  const duplicateTaskIdCount = [...nodeIndexesById.values()].filter(indexes => indexes.length > 1).length
  const edges: DependencyEdge[] = []
  let unresolvedCount = 0
  let ambiguousCount = 0

  nodes.forEach(node => {
    node.dependencies?.forEach(id => {
      const matches = nodeIndexesById.get(id)
      if (!matches?.length) {
        node.unknownDependencies.push({ id, reason: 'unresolved' })
        unresolvedCount++
      } else if (matches.length > 1) {
        node.unknownDependencies.push({ id, reason: 'ambiguous' })
        ambiguousCount++
      } else {
        const target = nodes[matches[0]]
        edges.push({ fromIndex: node.index, toIndex: target.index })
        node.resolvedDependencies.push({ id, title: target.title })
      }
    })
  })

  const incompleteMessages: string[] = []
  nodes.forEach(node => {
    const taskName = `${node.title ?? (node.id ? `Task ${node.id}` : 'Task identity not reported')}${node.title && node.id ? ` (ID: ${node.id})` : ''}`
    if (node.dependencies === null) incompleteMessages.push(`Dependency information was not reported for ${taskName}.`)
    if (node.hasInvalidDependencyReferences) incompleteMessages.push(`Invalid dependency references from ${taskName} were omitted.`)
    node.unknownDependencies.forEach(dependency => {
      const reason = dependency.reason === 'ambiguous' ? 'ambiguous' : 'unresolved'
      incompleteMessages.push(`Dependency ID "${dependency.id}" from ${taskName} is ${reason}, so no edge is drawn.`)
    })
  })

  return {
    nodes,
    edges,
    columns,
    duplicateTaskIdCount,
    unresolvedCount,
    ambiguousCount,
    unreportedCount: nodes.filter(node => node.dependencies === null).length,
    invalidCount: nodes.filter(node => node.hasInvalidDependencyReferences).length,
    incompleteMessages,
  }
}

function WorkflowGraphSvg({ nodes, edges, width, height }: {
  nodes: GraphNode[]
  edges: DependencyEdge[]
  width: number
  height: number
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-gf-line/80" tabIndex={0} role="region" aria-label="Scrollable workflow dependency graph">
      <svg
        aria-hidden="true"
        className="block h-auto w-full text-gf-ink"
        style={{ minWidth: width }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
      >
        <defs>
          <marker id="agent-world-workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-gf-accent" />
          </marker>
        </defs>
        {edges.map(edge => (
          <path
            key={`${edge.fromIndex}-${edge.toIndex}`}
            data-edge-from={edge.fromIndex}
            data-edge-to={edge.toIndex}
            d={edgePath(nodes[edge.fromIndex], nodes[edge.toIndex])}
            fill="none"
            className="stroke-gf-accent"
            strokeWidth="2"
            markerEnd="url(#agent-world-workflow-arrow)"
          />
        ))}
        {nodes.map(node => {
          const label = node.title ?? node.id ?? 'Task identity not reported'
          const details = [
            node.id ? `ID: ${node.id}` : 'ID not reported',
            node.status ? `Status: ${node.status}` : null,
          ].filter(Boolean).join(' · ')

          return (
            <g key={node.index} data-node-index={node.index}>
              <title>{`${label}${node.status ? ` — ${node.status}` : ''}`}</title>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx="12"
                className="fill-gf-bar stroke-gf-line"
                strokeWidth="1"
              />
              <text x={node.x + 12} y={node.y + 30} className="fill-gf-ink text-sm font-semibold">
                {displayText(label)}
              </text>
              <text x={node.x + 12} y={node.y + 53} className="fill-gf-muted text-xs">
                {displayText(details, 31)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function WorkflowGraphNotes({ graph }: { graph: WorkflowGraph }) {
  return (
    <>
      {graph.duplicateTaskIdCount > 0 && (
        <p className="mt-3 text-sm text-gf-muted">
          {graph.duplicateTaskIdCount} task ID{graph.duplicateTaskIdCount === 1 ? ' appears' : 's appear'} more than once; references to those IDs are ambiguous.
        </p>
      )}
      {(graph.unresolvedCount > 0 || graph.ambiguousCount > 0 || graph.unreportedCount > 0 || graph.invalidCount > 0) && (
        <div className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-100">
          <p>
            Some dependency data is incomplete: {graph.unresolvedCount} target ID{graph.unresolvedCount === 1 ? ' was' : 's were'} not reported, {graph.ambiguousCount} reference{graph.ambiguousCount === 1 ? ' matches' : 's match'} duplicate task IDs, {graph.unreportedCount} task{graph.unreportedCount === 1 ? ' did' : 's did'} not report dependencies, and {graph.invalidCount} task{graph.invalidCount === 1 ? ' included' : 's included'} invalid dependency references. These are not drawn as edges.
          </p>
          <ul className="mt-2 list-disc ps-5">
            {graph.incompleteMessages.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
          </ul>
        </div>
      )}
    </>
  )
}

function WorkflowAccessibleSummary({ nodes }: { nodes: GraphNode[] }) {
  return (
    <ul className="sr-only">
      {nodes.map(node => (
        <li key={node.index}>
          <span>
            Task: {node.title ?? 'Title not reported'}{node.id ? ` (ID: ${node.id})` : ' (ID not reported)'}{node.status ? `; status: ${node.status}` : '; status not reported'}.
          </span>
          {node.dependencies === null ? (
            <span> Dependencies were not reported.</span>
          ) : node.dependencies.length === 0 ? (
            <>
              <span>{node.hasInvalidDependencyReferences ? ' No valid dependency IDs were reported.' : ' No dependency IDs were reported.'}</span>
              {node.hasInvalidDependencyReferences && <span> Invalid dependency references were omitted.</span>}
            </>
          ) : (
            <>
              {node.resolvedDependencies.map(dependency => (
                <span key={`resolved-${dependency.id}`}>
                  {' '}Depends on {dependency.title ?? 'title not reported'} (ID: {dependency.id}).
                </span>
              ))}
              {node.unknownDependencies.map((dependency, index) => (
                <span key={`${dependency.reason}-${dependency.id}-${index}`}>
                  {' '}{dependency.reason === 'ambiguous' ? 'Ambiguous dependency ID' : 'Unresolved dependency ID'}: {dependency.id}.
                </span>
              ))}
              {node.hasInvalidDependencyReferences && <span> Invalid dependency references were omitted.</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

function WorkflowGraphSnapshot({ tasks }: { tasks: AgentWorldRecord[] }) {
  const graph = buildWorkflowGraph(tasks)
  const { nodes, edges } = graph
  const rowCount = Math.ceil(tasks.length / graph.columns)
  const height = GRAPH_PADDING * 2 + rowCount * NODE_HEIGHT + Math.max(0, rowCount - 1) * ROW_GAP
  const width = GRAPH_PADDING * 2 + graph.columns * NODE_WIDTH + (graph.columns - 1) * COLUMN_GAP
    + (edges.some(edge => edge.fromIndex === edge.toIndex) ? 48 : 0)

  return (
    <>
      <p className="mt-2 text-sm text-gf-muted">
        {nodes.length} reported task nodes · {edges.length} uniquely resolved dependency edge{edges.length === 1 ? '' : 's'}. Arrows point from a task to its prerequisite.
      </p>
      <WorkflowGraphSvg nodes={nodes} edges={edges} width={width} height={height} />
      <WorkflowGraphNotes graph={graph} />
      <WorkflowAccessibleSummary nodes={nodes} />
    </>
  )
}

export default function WorkflowDependencyGraph({ tasks }: WorkflowDependencyGraphProps) {
  return (
    <section aria-labelledby="agent-world-workflow-graph-heading" className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <h2 id="agent-world-workflow-graph-heading" className="font-display text-lg font-semibold">
        Workflow dependency graph
      </h2>
      {tasks.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">
          No workflow tasks were reported by the available snapshots, so no graph can be shown.
        </p>
      ) : (
        <WorkflowGraphSnapshot tasks={tasks} />
      )}
    </section>
  )
}
