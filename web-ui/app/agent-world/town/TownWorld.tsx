'use client'

import { useMemo, useState } from 'react'
import type { AgentWorldData, AgentWorldRecord } from '../agent-world-model'
import StatusColumns from '../shared/StatusColumns'
import TownStage from '../shared/town/TownStage'
import type { WorldAgent } from '../shared/world-model'
import type { AgentTownCharacter } from '../../../vendor/ai-town/src/types'
import { adaptAgentTownSnapshot } from './agent-town-model.js'
import RuntimeAgents from '../RuntimeAgents'

type TownWorldProps = {
  data: Pick<AgentWorldData, 'agents' | 'tasks'>
  boss?: AgentWorldRecord
  /** CLI sessions among data.agents (shared Agent World characters). */
  cliAgents: WorldAgent[]
  selectedCliId?: string
  onSelectCli: (id: string | undefined) => void
  compacting: Set<string>
}

/**
 * Agent Town: the shared Agent World town stage (same as the external Agent
 * World app) fed with GhostForge runtime agents plus CLI sessions.
 */
export default function TownWorld({ data, boss, cliAgents, selectedCliId, onSelectCli, compacting }: TownWorldProps) {
  const players = useMemo(
    () => adaptAgentTownSnapshot({ agents: data.agents, tasks: data.tasks, boss }) as AgentTownCharacter[],
    [data.agents, data.tasks, boss],
  )
  const cliIds = useMemo(() => new Set(cliAgents.map(a => a.id)), [cliAgents])
  const [runtimeId, setRuntimeId] = useState<string>()

  const select = (element?: { kind: 'player'; id: string }) => {
    const id = element?.kind === 'player' ? element.id : undefined
    if (id && cliIds.has(id)) { onSelectCli(id); setRuntimeId(undefined) } else setRuntimeId(id)
  }

  return (
    <section aria-labelledby="agent-town-heading" className="grid min-w-0 gap-4 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-town-heading" className="font-display text-lg font-semibold">Agent Town</h2>
          <p className="mt-1 text-xs text-gf-muted">
            a16z AI Town&apos;s map. Working agents stroll around their slot and say what they are doing; sessions waiting for you
            stand under ⏳; idle ones take a break on the lawn. Positions are display slots, not simulated work.
          </p>
        </div>
        <span className="rounded-full border border-gf-line2 px-2 py-1 text-xs text-gf-muted">
          {players.length} reported {players.length === 1 ? 'character' : 'characters'}
        </span>
      </div>
      <TownStage players={players} agents={cliAgents} selectedId={selectedCliId ?? runtimeId} onSelect={select} />
      <StatusColumns title="CLI sessions" agents={cliAgents} selectedId={selectedCliId} onSelect={onSelectCli} compacting={compacting} />
      <RuntimeAgents
        agents={players.filter(p => !cliIds.has(p.id)).map(p => ({ id: p.id, name: p.name, role: p.role, status: p.status, task: p.description }))}
        selectedId={runtimeId}
        onSelect={setRuntimeId}
      />
    </section>
  )
}
