const $ = id => document.getElementById(id)
const ns = 'http://www.w3.org/2000/svg'

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function showEmpty(container, text) {
  container.replaceChildren(node('p', 'muted', text))
}

function renderAgents(items) {
  const container = $('agents')
  if (!items.length) return showEmpty(container, 'No agent records are available yet.')
  container.replaceChildren(...items.map(agent => {
    const card = node('article', 'card')
    const top = node('div', 'card-top')
    top.append(node('h3', '', agent.name), node('span', `pill ${agent.state}`, agent.state))
    const meta = node('div', 'meta')
    if (agent.provider) meta.append(node('span', '', agent.provider))
    if (agent.task) meta.append(node('span', '', `Task: ${agent.task}`))
    if (agent.progress) meta.append(node('span', '', `Progress: ${agent.progress}`))
    if (agent.branch) meta.append(node('span', '', `Branch: ${agent.branch}`))
    if (agent.cwd) meta.append(node('span', '', `CWD: ${agent.cwd}`))
    if (agent.lastActivity) meta.append(node('span', '', `Activity: ${agent.lastActivity}`))
    card.append(top, meta)
    return card
  }))
}

function renderSessions(items) {
  const container = $('sessions')
  if (!items.length) return showEmpty(container, 'No project sessions found in the local Copilot or Claude state stores.')
  container.replaceChildren(...items.map(session => {
    const card = node('article', 'card')
    const top = node('div', 'card-top')
    top.append(node('h3', '', session.name), node('span', 'pill', session.provider))
    const meta = node('div', 'meta')
    meta.append(node('span', '', `CWD: ${session.cwd}`))
    meta.append(node('span', '', `Branch: ${session.branch || 'unknown'}`))
    meta.append(node('span', '', `Last activity: ${session.lastActivity || 'unknown'}`))
    meta.append(node('span', '', `Last message: ${session.lastMessageSummary}`))
    card.append(top, meta)
    return card
  }))
}

function renderTasks(items) {
  const container = $('tasks')
  if (!items.length) return showEmpty(container, 'The agent board has no tasks in its current snapshot.')
  const sorted = [...items].sort((a, b) => {
    const order = { 'in-progress': 0, todo: 1, blocked: 2, review: 3, done: 4 }
    return (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.id.localeCompare(b.id)
  })
  container.replaceChildren(...sorted.map(task => {
    const card = node('article', 'task')
    const top = node('div', 'task-top')
    top.append(node('h3', '', `${task.id} · ${task.title}`), node('span', `pill ${task.status}`, task.status))
    const meta = node('div', 'meta')
    if (task.owner) meta.append(node('span', '', `Owner: ${task.owner}`))
    if (task.assignee) meta.append(node('span', '', `Assignee: ${task.assignee}`))
    if (task.kind) meta.append(node('span', '', `Kind: ${task.kind}`))
    if (task.dependencies.length) meta.append(node('span', '', `Depends on: ${task.dependencies.join(', ')}`))
    card.append(top, meta)
    if (task.summary) card.append(node('p', 'meta', task.summary))
    return card
  }))
}

function renderMessages(items) {
  const container = $('messages')
  if (!items.length) {
    const item = node('li', 'muted', 'No messages recorded yet.')
    container.replaceChildren(item)
    return
  }
  container.replaceChildren(...items.slice().reverse().map(message => {
    const item = node('li', 'message')
    const heading = node('header')
    heading.append(node('strong', '', `${message.from} → ${message.to}`), node('time', '', message.ts))
    item.append(heading, node('p', '', message.summary || '[empty message]'))
    return item
  }))
}

function renderGraph(tasks) {
  const container = $('graph')
  if (!tasks.length) return showEmpty(container, 'Add tasks to the board to see their dependency graph.')
  const width = Math.max(640, tasks.length * 230)
  const height = 170
  const cardWidth = 190
  const positions = new Map(tasks.map((task, index) => [task.id, { x: index * 230 + 14, y: 48 }]))
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('class', 'workflow-graph')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Task dependency graph')
  const defs = document.createElementNS(ns, 'defs')
  const marker = document.createElementNS(ns, 'marker')
  marker.setAttribute('id', 'arrow')
  marker.setAttribute('markerWidth', '8')
  marker.setAttribute('markerHeight', '8')
  marker.setAttribute('refX', '6')
  marker.setAttribute('refY', '3')
  marker.setAttribute('orient', 'auto')
  const arrow = document.createElementNS(ns, 'path')
  arrow.setAttribute('d', 'M0,0 L0,6 L7,3 z')
  arrow.setAttribute('fill', '#51698d')
  marker.append(arrow)
  defs.append(marker)
  svg.append(defs)

  for (const task of tasks) {
    const target = positions.get(task.id)
    for (const dependency of task.dependencies) {
      const source = positions.get(dependency)
      if (!source) continue
      const edge = document.createElementNS(ns, 'line')
      edge.setAttribute('class', 'graph-edge')
      edge.setAttribute('x1', String(source.x + cardWidth))
      edge.setAttribute('y1', String(source.y + 35))
      edge.setAttribute('x2', String(target.x))
      edge.setAttribute('y2', String(target.y + 35))
      svg.append(edge)
    }
  }
  for (const task of tasks) {
    const point = positions.get(task.id)
    const group = document.createElementNS(ns, 'g')
    group.setAttribute('class', 'graph-node')
    const title = document.createElementNS(ns, 'title')
    title.textContent = `${task.id}: ${task.title} (${task.status})`
    const rect = document.createElementNS(ns, 'rect')
    rect.setAttribute('x', String(point.x))
    rect.setAttribute('y', String(point.y))
    rect.setAttribute('width', String(cardWidth))
    rect.setAttribute('height', '72')
    const label = document.createElementNS(ns, 'text')
    label.setAttribute('x', String(point.x + 10))
    label.setAttribute('y', String(point.y + 25))
    label.textContent = `${task.id} · ${task.title.slice(0, 19)}${task.title.length > 19 ? '…' : ''}`
    const state = document.createElementNS(ns, 'text')
    state.setAttribute('class', 'graph-status')
    state.setAttribute('x', String(point.x + 10))
    state.setAttribute('y', String(point.y + 49))
    state.textContent = task.status
    group.append(title, rect, label, state)
    svg.append(group)
  }
  container.replaceChildren(svg)
}

async function refresh() {
  const connection = $('connection')
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const snapshot = await response.json()
    $('phase').textContent = snapshot.phase || '—'
    $('health').textContent = snapshot.health === null ? '—' : `${snapshot.health}/100`
    $('agent-count').textContent = snapshot.agents.length
    $('task-count').textContent = snapshot.tasks.length
    renderAgents(snapshot.agents)
    renderSessions(snapshot.sessions)
    renderTasks(snapshot.tasks)
    renderMessages(snapshot.messages)
    renderGraph(snapshot.tasks)
    $('updated').textContent = `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}`
    connection.textContent = 'Connected'
    connection.classList.remove('error')
  } catch {
    connection.textContent = 'Connection unavailable'
    connection.classList.add('error')
  }
}

refresh()
window.setInterval(refresh, 5000)
