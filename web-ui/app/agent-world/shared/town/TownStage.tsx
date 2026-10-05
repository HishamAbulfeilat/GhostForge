'use client'

import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import type { Viewport } from 'pixi-viewport'
import type { AgentTownCharacter, SelectElement } from '../../../../vendor/ai-town/src/types'
import Ambience, { AmbienceToggle } from '../Ambience'
import { bubbleAt, useReducedMotion, useRotation, useStoredFlag } from '../hooks'
import Minimap, { type MinimapState } from '../Minimap'
import type { WorldAgent } from '../world-model'
import { useWalkers } from './walkers'

// The upstream AI Town renderer (PixiJS) only loads when this view opens.
const Game = lazy(() => import('../../../../vendor/ai-town/src/components/Game'))

const TILE = 32 // vendor/ai-town world-map tileDim
// Break area: the open lawn in the lower-left of the gentle map. useWalkers
// snaps each spot to the nearest walkable tile.
const BREAK_SPOTS = Array.from({ length: 20 }, (_, i) => ({ x: 5 + (i % 5) * 2, y: 24 + Math.floor(i / 5) * 2 }))

const EMOJI: Partial<Record<NonNullable<WorldAgent['attention']>, string>> = {
  waiting: '⏳', stalled: '⚠️', 'rate-limited': '🐢', erroring: '⚠️',
}

/**
 * a16z AI Town's map and characters (vendor/ai-town, unchanged apart from the
 * deviations in its NOTICE.md) plus Agent World's extras: short rotating
 * bubbles, upstream emoji bubbles, a minimap, day/night tint and idle breaks.
 * `players` come from the town adapter; `agents` add CLI session details.
 */
export default function TownStage({
  players, agents, selectedId, onSelect,
}: {
  players: AgentTownCharacter[]
  agents: WorldAgent[]
  selectedId?: string
  onSelect: SelectElement
}) {
  const [ambience, setAmbience] = useStoredFlag('aw-ambience', true)
  const reduced = useReducedMotion()
  const tick = useRotation()
  const byId = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])

  // Idle characters go on a break (with ambience on); upstream emoji bubbles show state.
  const placed = useMemo(() => {
    let spot = 0
    return players.map(p => {
      const a = byId.get(p.id)
      if (!a) return p
      const onBreak = ambience && a.onBreak
      const where = onBreak ? BREAK_SPOTS[spot++ % BREAK_SPOTS.length] : undefined
      const emoji = (a.attention && EMOJI[a.attention]) || (onBreak ? '☕' : '')
      return { ...p, ...(where ?? {}), emoji }
    })
  }, [players, byId, ambience])
  const walking = useWalkers(placed, reduced)
  const walkingRef = useRef(walking)
  walkingRef.current = walking

  // Bubbles are DOM labels over the canvas, positioned from the Pixi viewport each frame.
  const viewportRef = useRef<Viewport | undefined>()
  const bubbleRefs = useRef(new Map<string, HTMLSpanElement>())
  useEffect(() => {
    let frame = 0
    const place = () => {
      frame = requestAnimationFrame(place)
      const vp = viewportRef.current
      if (!vp) return
      for (const p of walkingRef.current) {
        const el = bubbleRefs.current.get(p.id)
        if (!el) continue
        const pt = vp.toScreen(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2)
        el.style.transform = `translate(${Math.round(pt.x)}px, ${Math.round(pt.y - 26 * vp.scale.y)}px) translate(-50%, -100%)`
      }
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [])

  const readMinimap = (): MinimapState | null => {
    const vp = viewportRef.current
    if (!vp) return null
    return {
      width: vp.worldWidth,
      height: vp.worldHeight,
      view: { x: vp.left, y: vp.top, w: vp.worldScreenWidth, h: vp.worldScreenHeight },
      dots: walkingRef.current.map(p => {
        const a = byId.get(p.id)
        return {
          id: p.id,
          x: p.x * TILE + TILE / 2,
          y: p.y * TILE + TILE / 2,
          tone: p.isBoss ? 'you' : a ? a.column : 'other',
          selected: p.id === selectedId,
        }
      }),
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <AmbienceToggle enabled={ambience} onChange={setAmbience} />
        <span className="text-gf-muted">Drag to pan, scroll to zoom, click a character for details.</span>
      </div>
      <div className="relative">
        <Suspense fallback={<div role="status" className="grid h-[min(70dvh,680px)] min-h-80 place-items-center rounded-xl border border-gf-line bg-gf-bar text-sm text-gf-muted">Loading AI Town…</div>}>
          <Game players={walking} selectedId={selectedId} onSelect={onSelect} viewportRef={viewportRef} />
        </Suspense>
        <Ambience enabled={ambience} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[6] overflow-hidden rounded-xl">
          {walking.map(p => {
            const text = bubbleAt(byId.get(p.id), tick)
            if (!text) return null
            const a = byId.get(p.id)
            return (
              <span
                key={p.id}
                ref={el => { if (el) bubbleRefs.current.set(p.id, el); else bubbleRefs.current.delete(p.id) }}
                className={`absolute whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow ${a?.attention ? 'bg-amber-200 text-amber-950' : 'bg-white/90 text-slate-900'}`}
                style={{ left: 0, top: 0, transform: 'translate(-9999px, 0)' }}
              >
                {text}
              </span>
            )
          })}
        </div>
        <Minimap read={readMinimap} onPan={(x, y) => viewportRef.current?.moveCenter(x, y)} label="AI Town minimap" />
      </div>
    </div>
  )
}
