'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentWorldData, AgentWorldRecord } from '../agent-world-model'
import { adaptAgentOfficeSnapshot } from './agent-office-model.js'
import { eventBus } from '../../../vendor/agent-office/src/events'
import type { SnapshotOffice } from '../../../vendor/agent-office/src/snapshot-room'
import { startOfficeSession } from './office-session'

type OfficeWorldProps = {
  data: Pick<AgentWorldData, 'agents' | 'tasks'>
  boss?: AgentWorldRecord
}

export default function OfficeWorld({ data, boss }: OfficeWorldProps) {
  const model = useMemo(
    () => adaptAgentOfficeSnapshot({ agents: data.agents, tasks: data.tasks, boss }),
    [data.agents, data.tasks, boss],
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const officeRef = useRef<SnapshotOffice | null>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const [sceneError, setSceneError] = useState<string>()
  const selected = model.agents.find(agent => agent.id === selectedId)

  const modelRef = useRef(model)
  modelRef.current = model

  useEffect(() => {
    officeRef.current?.update(model.agents, model.layout)
  }, [model])

  // Client-only: Phaser touches window on import, so the scene is loaded here.
  // The office is created and disposed in this one effect (see office-session).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent).detail as { id?: string } | null
      setSelectedId(detail?.id)
    }
    eventBus.addEventListener('agent-focus', onFocus)

    const session = startOfficeSession(
      modelRef.current,
      async (isCancelled) => {
        const [{ default: Phaser }, { OfficeScene }] = await Promise.all([
          import('phaser'),
          import('../../../vendor/agent-office/src/game/Game'),
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
        return () => {
          // Stop first so the scene removes its window key handlers.
          try { game.scene.stop('OfficeScene') } catch { /* scene was never started */ }
          game.destroy(true)
        }
      },
      (error) => setSceneError(error instanceof Error ? error.message : 'Unable to load Agent Office.'),
    )
    officeRef.current = session.office

    return () => {
      eventBus.removeEventListener('agent-focus', onFocus)
      officeRef.current = null
      session.stop()
    }
  }, [])

  return (
    <section aria-labelledby="agent-office-heading" className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-office-heading" className="font-display text-lg font-semibold">Agent Office</h2>
          <p className="mt-1 text-xs text-gf-muted">
            Agents sit at desks, the boss works from the meeting room, and each current task shows as a thought bubble.
            Click an agent to follow; use arrow keys or WASD to pan. Nothing is simulated beyond the reported snapshot.
          </p>
        </div>
        <span className="rounded-full border border-gf-line2 px-2 py-1 text-xs text-gf-muted">
          {model.agents.length} reported {model.agents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {sceneError && <p role="alert" className="mb-2 rounded-lg border border-red-900 bg-red-950/60 p-3 text-sm text-red-100">{sceneError}</p>}
          <div
            ref={hostRef}
            role="img"
            aria-label="Agent Office pixel-art scene"
            className="h-[min(70dvh,680px)] min-h-80 w-full overflow-hidden rounded-xl border border-gf-line bg-gf-bar"
          />
        </div>
        <aside aria-label="Office agents" className="min-w-0 rounded-xl border border-gf-line p-3">
          <h3 className="font-semibold">Agents</h3>
          {model.agents.length ? (
            <ul className="mt-2 grid max-h-[min(70dvh,680px)] list-none gap-2 overflow-y-auto p-0">
              {model.agents.map(agent => (
                <li key={agent.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={agent.id === selectedId}
                    onClick={() => setSelectedId(agent.id === selectedId ? undefined : agent.id)}
                    className="min-h-11 w-full rounded-lg border border-gf-line2 p-2 text-start hover:border-gf-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-gf-accent"
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
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-gf-line2 p-3 text-sm text-gf-muted">
              No agents were reported in the current snapshot.
            </p>
          )}
          {model.hidden > 0 && (
            <p role="status" className="mt-2 text-xs text-gf-muted">
              {model.hidden} more {model.hidden === 1 ? 'agent has' : 'agents have'} no free desk and {model.hidden === 1 ? 'is' : 'are'} not drawn (capacity {model.capacity}).
            </p>
          )}
          {selected && (
            <div aria-live="polite" className="mt-3 border-t border-gf-line pt-3">
              <h4 className="text-sm font-semibold">{selected.name}</h4>
              <p className="mt-1 text-xs text-gf-muted">Status: {selected.status}</p>
              <p className="mt-2 break-words text-sm">
                {selected.currentTask || 'No current task description was reported.'}
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
