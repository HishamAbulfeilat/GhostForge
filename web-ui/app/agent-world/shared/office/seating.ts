// Who sits where in Agent Office: desk numbers kept per agent between
// snapshots, re-seating on the scene's wider desk spacing, and short name tags.
import type { AgentFields, LayoutItem } from '../../../../vendor/agent-office/src/snapshot-room'

export type OfficeAgent = AgentFields & { isBoss?: boolean; role?: string; status?: string }
export type OfficeModel = { agents: OfficeAgent[]; layout: LayoutItem[] }
export type Cell = { x: number; y: number }

// The upstream floor is 40x40 cells of 16px. Coffee & Pantry = px 350-526,
// i.e. cells 22-32.
export const inPantry = (s: Cell) => s.x >= 21 && s.x <= 33 && s.y >= 21 && s.y <= 33

/** "gf-integration #3" -> "gf-integra…#3": fits a 128px desk spacing. */
export function shortName(name: string, max = 13) {
  const [base, n] = name.split(' #')
  const suffix = n ? `#${n}` : ''
  const room = max - suffix.length
  return (base.length > room ? base.slice(0, room - 1) + '…' : base) + suffix
}

/**
 * Desk number per agent id: an agent keeps its desk while it stays, a new one
 * takes the lowest free desk, and one that left frees its desk. `memory` is
 * kept by the caller between snapshots and updated here.
 */
export function assignDesks(ids: string[], memory: Map<string, number> = new Map()): number[] {
  const present = new Set(ids)
  for (const id of [...memory.keys()]) if (!present.has(id)) memory.delete(id)
  const taken = new Set(memory.values())
  let next = 0
  return ids.map(id => {
    const kept = memory.get(id)
    if (kept !== undefined) return kept
    while (taken.has(next)) next++
    memory.set(id, next)
    taken.add(next)
    return next
  })
}

/**
 * The adapter's desks are 4 cells (64px) apart, narrower than the scene's
 * name tags. Re-seat everyone on every other desk (128px apart, none against
 * the west wall), skip desks
 * inside the pantry, apply desks the user dragged in layout-edit mode, and
 * drop desk labels (each agent already has a name tag). With the same
 * `memory` on every call, agents keep their desk until they leave.
 */
export function seatAgents(model: OfficeModel, deskSlots: Cell[], moved: Record<string, Cell>, memory?: Map<string, number>) {
  // x = 8, 16, 24, 32: 128px apart and clear of the west wall, so bubbles are not clipped.
  const desks = deskSlots.filter(s => s.x % 8 === 0 && !inPantry(s))
  const agents: OfficeAgent[] = []
  const layout: LayoutItem[] = []
  const seats = new Map<string, Cell>()
  const ids = model.agents.filter(a => !a.isBoss).map(a => a.id)
  const numbers = assignDesks(ids, memory)
  const deskOf = new Map(ids.map((id, i) => [id, numbers[i]]))
  let hidden = 0
  for (const a of model.agents) {
    if (a.isBoss) { agents.push(a); seats.set(a.id, { x: a.x, y: a.y }); continue }
    const slot = desks[deskOf.get(a.id) ?? -1]
    if (!slot) { hidden++; continue }
    const id = `desk-${a.id}`
    const desk = moved[id] ?? slot
    layout.push({ id, type: 'desk', x: desk.x, y: desk.y })
    const seat = { x: desk.x, y: desk.y + 2 }
    seats.set(a.id, seat)
    agents.push({ ...a, name: shortName(a.name), ...seat })
  }
  return { agents, layout, seats, hidden, capacity: desks.length }
}

