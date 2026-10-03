'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { AgentWorldData, AgentWorldRecord } from '../agent-world-model'
import { adaptAgentTownSnapshot } from './agent-town-model.js'
import { useWalkers } from './walkers'

const Game = dynamic(() => import('../../../vendor/ai-town/src/components/Game'), {
  ssr: false,
  loading: () => (
    <div role="status" className="grid h-[min(70dvh,680px)] min-h-80 place-items-center rounded-xl border border-gf-line bg-gf-bar text-sm text-gf-muted">
      Loading Agent Town…
    </div>
  ),
})

type TownWorldProps = {
  data: Pick<AgentWorldData, 'agents' | 'tasks'>
  boss?: AgentWorldRecord
}

export default function TownWorld({ data, boss }: TownWorldProps) {
  const players = useMemo(
    () => adaptAgentTownSnapshot({ agents: data.agents, tasks: data.tasks, boss }),
    [data.agents, data.tasks, boss],
  )
  const walking = useWalkers(players)
  const [selectedId, setSelectedId] = useState<string>()
  const selected = players.find((player) => player.id === selectedId)

  const selectPlayer = (element?: { kind: 'player'; id: string }) => {
    if (element?.kind === 'player') setSelectedId(element.id)
  }

  return (
    <section aria-labelledby="agent-town-heading" className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-town-heading" className="font-display text-lg font-semibold">Agent Town</h2>
          <p className="mt-1 text-xs text-gf-muted">
            Positions are reported slots, not simulated work: working agents walk around their slot, everyone else stands still.
          </p>
        </div>
        <span className="rounded-full border border-gf-line2 px-2 py-1 text-xs text-gf-muted">
          {players.length} reported {players.length === 1 ? 'character' : 'characters'}
        </span>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Game players={walking} selectedId={selectedId} onSelect={selectPlayer} />
        <aside aria-label="Town agents" className="min-w-0 rounded-xl border border-gf-line p-3">
          <h3 className="font-semibold">Characters</h3>
          {players.length ? (
            <ul className="mt-2 grid max-h-[min(70dvh,680px)] list-none gap-2 overflow-y-auto p-0">
              {players.map((player) => (
                <li key={player.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={player.id === selectedId}
                    onClick={() => setSelectedId(player.id)}
                    className="min-h-11 w-full rounded-lg border border-gf-line2 p-2 text-start hover:border-gf-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-gf-accent"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-words text-sm font-semibold">{player.name}</span>
                      <span className="shrink-0 text-xs text-gf-muted">{player.role}</span>
                    </span>
                    <span className="mt-1 block text-xs text-gf-muted">{player.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-gf-line2 p-3 text-sm text-gf-muted">
              No agents were reported in the current snapshot.
            </p>
          )}
          {selected && (
            <div aria-live="polite" className="mt-3 border-t border-gf-line pt-3">
              <h4 className="text-sm font-semibold">{selected.name}</h4>
              <p className="mt-1 text-xs text-gf-muted">Status: {selected.status}</p>
              <p className="mt-2 break-words text-sm">
                {selected.description || 'No current task description was reported.'}
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
