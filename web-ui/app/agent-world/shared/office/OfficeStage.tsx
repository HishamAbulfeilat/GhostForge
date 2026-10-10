'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { eventBus } from '../../../../vendor/agent-office/src/events'
import type { AgentFields, LayoutItem, SnapshotOffice } from '../../../../vendor/agent-office/src/snapshot-room'
import Ambience, { AmbienceToggle } from '../Ambience'
import type { ChatTraffic } from '../ChatBox'
import { bubbleAt, useOnScreen, useReducedMotion, useRotation, useStoredFlag } from '../hooks'
import Minimap, { type MinimapState } from '../Minimap'
import { clipWords } from '../status'
import type { WorldAgent } from '../world-model'
import { startOfficeSession } from './office-session'
import { inPantry, seatAgents, type Cell, type OfficeModel } from './seating'
import { attachTouchControls, type TouchCamera } from './touch'

export type { OfficeAgent, OfficeModel } from './seating'

// The upstream floor is 40x40 cells of 16px. Coffee & Pantry = px 350-526,
// i.e. cells 22-32; its door is on the west wall around cell y 26-27.
const GRID = 40 * 16
const PANTRY_DOOR: Cell[] = [{ x: 20, y: 27 }, { x: 23, y: 27 }]
// Six cells apart so name tags do not overlap; more than six guests share spots.
const BREAK_SPOTS: Cell[] = [25, 28, 31].flatMap((y, row) => [23, 29].map(x => ({ x: x + (row % 2) * 2, y })))
const STEP_MS = 220
const TALK_MS = 8000
const DESKS_KEY = 'aw-office-desks'

/** Cells from `from` to `to`, one step at a time (x first), via waypoints. */
function route(from: Cell, waypoints: Cell[]): Cell[] {
  const path: Cell[] = []
  let at = { ...from }
  for (const wp of waypoints) {
    while (at.x !== wp.x) { at = { x: at.x + Math.sign(wp.x - at.x), y: at.y }; path.push(at) }
    while (at.y !== wp.y) { at = { x: at.x, y: at.y + Math.sign(wp.y - at.y) }; path.push(at) }
  }
  return path
}

type Walker = { at: Cell; goal: 'desk' | 'break'; path: Cell[] }

/**
 * harishkotra/agent-office's office scene (vendor/agent-office) driven through
 * its own room messages: layout-sync for desks (draggable in layout-edit
 * mode), highlight-event when a session needs you (cinematic camera follow),
 * chat for chat-box traffic, and the upstream thought/emote bubbles for short
 * rotating status. Adds a minimap, an activity log, day/night tint and idle
 * breaks in the Coffee & Pantry.
 */
export default function OfficeStage({
  model, deskSlots, agents, selectedId, onSelect, traffic,
}: {
  model: OfficeModel
  deskSlots: Cell[]
  agents: WorldAgent[]
  selectedId?: string
  onSelect: (id: string | undefined) => void
  /** Latest chat-box event, forwarded to the scene as a `chat` message. */
  traffic?: ChatTraffic & { at: number }
}) {
  const reduced = useReducedMotion()
  const tick = useRotation()
  const [ambience, setAmbience] = useStoredFlag('aw-ambience', true)
  const [cinematic, setCinematic] = useStoredFlag('aw-office-cinematic', true)
  const [editing, setEditing] = useState(false)
  const [moved, setMoved] = useState<Record<string, Cell>>({})
  const [log, setLog] = useState<{ key: number; time: string; text: string }[]>([])
  const [sceneError, setSceneError] = useState<string>()
  const [, setStep] = useState(0)
  const byId = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])
  const talking = useRef(new Map<string, number>())
  const walkers = useRef(new Map<string, Walker>())

  useEffect(() => {
    try { setMoved(JSON.parse(localStorage.getItem(DESKS_KEY) || '{}')) } catch { /* storage unavailable */ }
  }, [])

  // Desk per agent, kept between snapshots so nobody changes desk when someone else leaves.
  const deskMemory = useRef(new Map<string, number>())
  const seated = useMemo(() => seatAgents(model, deskSlots, moved, deskMemory.current), [model, deskSlots, moved])

  // Walk idle agents to the pantry and back, one cell per STEP_MS.
  useEffect(() => {
    const map = walkers.current
    const ids = new Set(seated.agents.map(a => a.id))
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id)
    let spot = 0
    for (const a of seated.agents) {
      const seat = seated.seats.get(a.id)!
      const breakSpot = BREAK_SPOTS[spot % BREAK_SPOTS.length]
      const goal = ambience && !a.isBoss && byId.get(a.id)?.onBreak ? 'break' : 'desk'
      if (goal === 'break') spot++
      const w = map.get(a.id)
      if (!w) { map.set(a.id, { at: goal === 'break' ? breakSpot : seat, goal, path: [] }); continue }
      if (w.goal === goal && (goal === 'break' || !w.path.length)) {
        if (goal === 'desk' && (w.at.x !== seat.x || w.at.y !== seat.y)) w.path = reduced ? [seat] : route(w.at, [seat])
        continue
      }
      w.goal = goal
      const waypoints = goal === 'break' ? [...PANTRY_DOOR, breakSpot] : [...PANTRY_DOOR].reverse().concat(seat)
      w.path = reduced ? [waypoints[waypoints.length - 1]] : route(w.at, inPantry(w.at) || goal === 'break' ? waypoints : [seat])
    }
  }, [seated, byId, ambience, reduced])

  // Off screen (scrolled to the columns or the log): the Phaser loop sleeps
  // and the walkers and minimap stop.
  const viewRef = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(viewRef)
  const onScreenRef = useRef(onScreen)
  onScreenRef.current = onScreen

  useEffect(() => {
    const t = setInterval(() => {
      if (!onScreenRef.current) return
      let changed = false
      for (const w of walkers.current.values()) {
        const next = w.path.shift()
        if (next) { w.at = next; changed = true }
      }
      if (changed) setStep(n => n + 1)
    }, STEP_MS)
    return () => clearInterval(t)
  }, [])

  // What the scene gets: positions from the walkers, ≤ 6-word thoughts, emotes from state.
  const now = Date.now()
  const sceneAgents: AgentFields[] = seated.agents.map(a => {
    const w = walkers.current.get(a.id)
    const at = w?.at ?? { x: a.x, y: a.y }
    const extra = byId.get(a.id)
    const walking = !!w?.path.length
    const talkingNow = (talking.current.get(a.id) ?? 0) > now
    let action = a.action
    let thought = clipWords(a.thought ?? '')
    if (extra) {
      thought = walking ? '' : bubbleAt(extra, tick)
      action = walking ? 'move'
        : talkingNow || extra.attention === 'waiting' ? 'talk'
        : extra.column === 'working' ? (extra.taskTitle.startsWith('thinking') || extra.taskTitle === 'responding' ? 'think' : 'use_tool')
        : 'idle'
      if (w?.goal === 'break' && !walking) thought = ''
    }
    return {
      id: a.id, name: a.name, x: at.x, y: at.y, direction: a.direction, action,
      currentTask: thought, thought, mood: a.mood, reputation: a.reputation, riskLevel: a.riskLevel, momentum: a.momentum,
    }
  })

  const officeRef = useRef<SnapshotOffice | null>(null)
  const gameRef = useRef<{ scene: { getScene(key: string): unknown }; loop: { sleep(): void; wake(): void } } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef({ agents: sceneAgents, layout: seated.layout })
  sceneRef.current = { agents: sceneAgents, layout: seated.layout }
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const cinematicRef = useRef(cinematic)
  cinematicRef.current = cinematic

  useEffect(() => {
    officeRef.current?.update(sceneRef.current.agents, sceneRef.current.layout)
  })

  // Phaser touches `window` on import, so the scene loads inside the effect.
  // The office is created and disposed in this one effect (see office-session).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let seq = 0
    let lastEntry = ''
    const push = (text: string) => {
      if (text === lastEntry) return
      lastEntry = text
      setLog(prev => [{ key: ++seq, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), text }, ...prev].slice(0, 40))
    }
    const onFocus = (event: Event) => {
      const id = ((event as CustomEvent).detail as { id?: string } | null)?.id
      onSelectRef.current(id && id !== 'you' ? id : undefined)
    }
    const onActivity = (event: Event) => {
      const d = (event as CustomEvent).detail as { agent?: string; action?: string; thought?: string }
      if (d?.agent && d.thought) push(`${d.agent}: ${d.thought}`)
      else if (d?.agent && d.action && d.action !== 'idle') push(`${d.agent} → ${d.action}`)
    }
    const onChat = (event: Event) => {
      const d = (event as CustomEvent).detail as { name?: string; direction?: ChatTraffic['direction'] }
      if (!d?.name) return
      push(d.direction === 'sent' ? `You messaged ${d.name}` : d.direction === 'received' ? `${d.name} replied to you` : `Message to ${d.name} failed`)
    }
    // The scene starts listening for cinematic-toggle in create(); layout-sync arrives after that.
    const onLayout = () => eventBus.dispatchEvent(new CustomEvent('cinematic-toggle', { detail: { enabled: cinematicRef.current } }))
    const onMoved = (event: Event) => {
      const items = ((event as CustomEvent).detail as { items?: LayoutItem[] })?.items ?? []
      const next: Record<string, Cell> = {}
      for (const item of items) if (item.id.startsWith('desk-')) next[item.id] = { x: item.x, y: item.y }
      setMoved(prev => {
        const merged = { ...prev, ...next }
        try { localStorage.setItem(DESKS_KEY, JSON.stringify(merged)) } catch { /* storage unavailable */ }
        return merged
      })
    }
    eventBus.addEventListener('agent-focus', onFocus)
    eventBus.addEventListener('activity-log', onActivity)
    eventBus.addEventListener('chat-message', onChat)
    eventBus.addEventListener('layout-sync', onLayout)
    eventBus.addEventListener('layout-item-moved', onMoved)

    const session = startOfficeSession(
      sceneRef.current,
      async isCancelled => {
        const [Phaser, { OfficeScene }] = await Promise.all([
          import('phaser'),
          import('../../../../vendor/agent-office/src/game/Game'),
        ])
        if (isCancelled()) return undefined
        const game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host,
          width: host.clientWidth || 800,
          height: host.clientHeight || 560,
          scene: [OfficeScene],
          pixelArt: true,
          scale: { mode: Phaser.Scale.RESIZE },
          input: { keyboard: { capture: [] } },
        })
        gameRef.current = game
        if (!onScreenRef.current) game.loop.sleep()
        return () => {
          gameRef.current = null
          // Stop first so the scene removes its window key handlers.
          try { game.scene.stop('OfficeScene') } catch { /* never started */ }
          game.destroy(true)
        }
      },
      error => setSceneError(error instanceof Error ? error.message : 'Unable to load Agent Office.'),
    )
    officeRef.current = session.office
    return () => {
      eventBus.removeEventListener('agent-focus', onFocus)
      eventBus.removeEventListener('activity-log', onActivity)
      eventBus.removeEventListener('chat-message', onChat)
      eventBus.removeEventListener('layout-sync', onLayout)
      eventBus.removeEventListener('layout-item-moved', onMoved)
      officeRef.current = null
      session.stop()
    }
  }, [])

  useEffect(() => {
    const loop = gameRef.current?.loop
    if (onScreen) loop?.wake()
    else loop?.sleep()
  }, [onScreen])

  useEffect(() => {
    eventBus.dispatchEvent(new CustomEvent('cinematic-toggle', { detail: { enabled: cinematic } }))
  }, [cinematic])
  useEffect(() => {
    eventBus.dispatchEvent(new CustomEvent('layout-edit-mode', { detail: { enabled: editing } }))
  }, [editing])

  // A session that newly needs you: the scene's cinematic camera follows it for a few seconds.
  const attentionSeen = useRef(new Map<string, string>())
  useEffect(() => {
    for (const a of agents) {
      const key = a.attention ?? ''
      const before = attentionSeen.current.get(a.id)
      if (key && before !== undefined && before !== key) officeRef.current?.send('highlight-event', { agentId: a.id, type: 'attention' })
      attentionSeen.current.set(a.id, key)
    }
  }, [agents])

  // Picking someone in a roster also brings the camera to them.
  useEffect(() => {
    if (selectedId) officeRef.current?.send('highlight-event', { agentId: selectedId, type: 'focus' })
  }, [selectedId])

  // Chat-box traffic becomes the scene's own `chat` message; the agent talks for a moment.
  useEffect(() => {
    if (!traffic) return
    const name = seated.agents.find(a => a.id === traffic.sessionId)?.name ?? 'a session'
    if (traffic.direction !== 'failed') talking.current.set(traffic.sessionId, Date.now() + TALK_MS)
    officeRef.current?.send('chat', { agentId: traffic.sessionId, name, direction: traffic.direction, time: new Date(traffic.at).toISOString() })
    setStep(n => n + 1)
  }, [traffic]) // eslint-disable-line react-hooks/exhaustive-deps

  type SceneLike = {
    cameras?: { main: TouchCamera & { worldView: { x: number; y: number; width: number; height: number }; centerOn(x: number, y: number): void } }
    agentSprites?: Map<string, { x: number; y: number }>
    followTarget?: unknown
    cinematicReleaseAt?: number
    layoutEditMode?: boolean
    layoutDragItemId?: string | null
  }
  const scene = () => gameRef.current?.scene.getScene('OfficeScene') as SceneLike | undefined

  // Phones and tablets: drag to pan, pinch to zoom (the scene only has keys and the wheel).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    return attachTouchControls(host, () => {
      const s = gameRef.current?.scene.getScene('OfficeScene') as SceneLike | undefined
      if (!s?.cameras) return null
      return {
        camera: s.cameras.main,
        release: () => { s.followTarget = null; s.cinematicReleaseAt = 0 },
        canPan: () => !(s.layoutEditMode && s.layoutDragItemId),
      }
    })
  }, [])
  const readMinimap = (): MinimapState | null => {
    const s = scene()
    if (!s?.cameras) return null
    const v = s.cameras.main.worldView
    return {
      width: GRID,
      height: GRID,
      view: { x: v.x, y: v.y, w: v.width, h: v.height },
      dots: [...(s.agentSprites ?? new Map()).entries()].map(([id, c]) => {
        const a = byId.get(id)
        const boss = seated.agents.find(x => x.id === id)?.isBoss
        return { id, x: c.x, y: c.y, tone: boss ? 'you' : a ? a.column : 'other', selected: id === selectedId }
      }),
    }
  }
  const pan = (x: number, y: number) => {
    const s = scene()
    if (!s?.cameras) return
    // Manual panning wins over follow, as with the scene's own arrow keys.
    s.followTarget = null
    s.cinematicReleaseAt = 0
    s.cameras.main.centerOn(x, y)
  }

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <AmbienceToggle enabled={ambience} onChange={setAmbience} />
          <button type="button" aria-pressed={cinematic} onClick={() => setCinematic(!cinematic)}
            title="Follow a session with the camera when it newly needs you"
            className="rounded-md border border-gf-line px-2.5 py-1 hover:border-gf-accent aria-pressed:border-gf-accent aria-pressed:text-gf-accent">
            🎬 Cinematic {cinematic ? 'on' : 'off'}
          </button>
          <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}
            title="Drag desks to rearrange the office (saved in this browser)"
            className="rounded-md border border-gf-line px-2.5 py-1 hover:border-gf-accent aria-pressed:border-gf-accent aria-pressed:text-gf-accent">
            ✥ Edit layout {editing ? 'on' : 'off'}
          </button>
          {Object.keys(moved).length > 0 && (
            <button type="button" onClick={() => { setMoved({}); try { localStorage.removeItem(DESKS_KEY) } catch { /* storage unavailable */ } }}
              className="rounded-md border border-gf-line px-2.5 py-1 hover:border-gf-accent">Reset desks</button>
          )}
        </div>
        {sceneError && <p role="alert" className="mb-2 rounded-lg border border-gf-danger p-3 text-sm">{sceneError}</p>}
        <div ref={viewRef} className="relative">
          <div
            ref={hostRef}
            role="img"
            aria-label="Agent Office pixel-art scene"
            className="h-[min(70dvh,680px)] min-h-80 w-full touch-none overflow-hidden rounded-xl border border-gf-line bg-gf-bar"
          />
          <Ambience enabled={ambience} />
          <Minimap read={readMinimap} onPan={pan} label="Agent Office minimap" paused={!onScreen} />
        </div>
        {seated.hidden > 0 && (
          <p role="status" className="mt-2 text-xs text-gf-muted">
            {seated.hidden} more {seated.hidden === 1 ? 'agent has' : 'agents have'} no free desk (capacity {seated.capacity}).
          </p>
        )}
      </div>
      <aside aria-label="Office activity" className="min-w-0 rounded-xl border border-gf-line bg-gf-surface p-3">
        <h3 className="text-sm font-semibold">Activity</h3>
        {log.length ? (
          <ol className="mt-2 grid max-h-[min(70dvh,680px)] list-none gap-1 overflow-y-auto p-0 text-xs">
            {log.map(entry => (
              <li key={entry.key} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                <span className="font-mono text-gf-muted">{entry.time}</span>
                <span className="break-words">{entry.text}</span>
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-xs text-gf-muted">Status changes and chat traffic show up here.</p>}
      </aside>
    </div>
  )
}
