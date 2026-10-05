import { useEffect, useRef, useState } from 'react'
import { mapheight, mapwidth, objmap } from '../../../vendor/ai-town/data/gentle.js'
import type { AgentTownCharacter } from '../../../vendor/ai-town/src/types'

// Upstream AI Town treats any object tile as an obstacle; use the same rule.
const blocked = (x: number, y: number) =>
  x < 1 || y < 1 || x >= mapwidth - 1 || y >= mapheight - 1 ||
  (objmap as number[][][]).some(layer => layer[x]?.[y] !== -1)

const TICK_MS = 100
const STEP = 0.12          // tiles per tick, roughly upstream's walking pace
const WANDER_RADIUS = 4
const DOWN = 90

type Walker = {
  x: number; y: number          // current position (tiles, fractional while moving)
  homeX: number; homeY: number  // snapped, walkable slot from the adapter
  targetX: number; targetY: number
  hopX?: number; hopY?: number  // adjacent tile currently being walked to
  orientation: number
  moving: boolean
  restUntil: number
}

/** Nearest walkable tile to (x, y), searching outward in rings. */
function snap(x: number, y: number): [number, number] {
  const ix = Math.round(x), iy = Math.round(y)
  for (let r = 0; r < 12; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (!blocked(ix + dx, iy + dy)) return [ix + dx, iy + dy]
      }
    }
  }
  return [ix, iy]
}

function pickTarget(w: Walker): [number, number] {
  for (let i = 0; i < 12; i++) {
    const tx = w.homeX + Math.round((Math.random() * 2 - 1) * WANDER_RADIUS)
    const ty = w.homeY + Math.round((Math.random() * 2 - 1) * WANDER_RADIUS)
    if (!blocked(tx, ty)) return [tx, ty]
  }
  return [w.homeX, w.homeY]
}

/**
 * Animates the adapter's static characters: working ones stroll around their
 * slot one tile at a time (never through obstacles); everyone else stands at
 * their slot facing down. Returns the characters with live pose fields.
 */
export function useWalkers(players: AgentTownCharacter[]): AgentTownCharacter[] {
  const walkers = useRef(new Map<string, Walker>())
  const [, setFrame] = useState(0)
  const playersRef = useRef(players)
  playersRef.current = players

  useEffect(() => {
    const map = walkers.current
    const ids = new Set(players.map(p => p.id))
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id)
    for (const p of players) {
      const [hx, hy] = snap(p.x, p.y)
      const w = map.get(p.id)
      if (!w) map.set(p.id, { x: hx, y: hy, homeX: hx, homeY: hy, targetX: hx, targetY: hy, orientation: DOWN, moving: false, restUntil: 0 })
      else if (w.homeX !== hx || w.homeY !== hy) { w.homeX = hx; w.homeY = hy; w.targetX = Math.round(w.x); w.targetY = Math.round(w.y) }
    }
  }, [players])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const p of playersRef.current) {
        const w = walkers.current.get(p.id)
        if (!w) continue
        const wandering = p.isThinking
        if (!wandering && w.hopX === undefined && w.x === w.homeX && w.y === w.homeY) {
          if (w.moving) { w.moving = false; changed = true }
          if (w.orientation !== DOWN) { w.orientation = DOWN; changed = true }
          continue
        }
        if (!wandering) { w.targetX = w.homeX; w.targetY = w.homeY }

        // Mid-hop: keep walking to the adjacent tile we committed to.
        if (w.hopX !== undefined && w.hopY !== undefined) {
          const dx = w.hopX - w.x, dy = w.hopY - w.y
          const dist = Math.abs(dx) + Math.abs(dy)
          if (dist <= STEP) { w.x = w.hopX; w.y = w.hopY; w.hopX = w.hopY = undefined }
          else { w.x += Math.sign(dx) * Math.min(STEP, Math.abs(dx)); w.y += Math.sign(dy) * Math.min(STEP, Math.abs(dy)) }
          changed = true
          continue
        }

        if (w.x === w.targetX && w.y === w.targetY) {
          if (w.moving) { w.moving = false; w.restUntil = now + 1200 + Math.random() * 3000; changed = true }
          if (wandering && now >= w.restUntil) [w.targetX, w.targetY] = pickTarget(w)
          continue
        }

        // Next hop: one tile along the longer axis (grid movement, like upstream);
        // try the other axis if that tile is an obstacle, else give up the target.
        const dx = w.targetX - w.x, dy = w.targetY - w.y
        const options: Array<[number, number, number]> = []
        const xs: [number, number, number] = [w.x + Math.sign(dx), w.y, dx > 0 ? 0 : 180]
        const ys: [number, number, number] = [w.x, w.y + Math.sign(dy), dy > 0 ? 90 : 270]
        if (Math.abs(dx) >= Math.abs(dy)) { if (dx) options.push(xs); if (dy) options.push(ys) }
        else { if (dy) options.push(ys); if (dx) options.push(xs) }
        const hop = options.find(([hx, hy]) => !blocked(hx, hy))
        if (!hop) { w.targetX = w.x; w.targetY = w.y; continue }
        ;[w.hopX, w.hopY, w.orientation] = hop
        w.moving = true
        changed = true
      }
      if (changed) setFrame(f => f + 1)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return players.map(p => {
    const w = walkers.current.get(p.id)
    return w ? { ...p, x: w.x, y: w.y, orientation: w.orientation, isMoving: w.moving } : p
  })
}
