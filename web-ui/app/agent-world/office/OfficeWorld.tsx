'use client'

import { useMemo, useState } from 'react'
import type { AgentWorldData, AgentWorldRecord } from '../agent-world-model'
import type { ChatTraffic } from '../shared/ChatBox'
import OfficeStage, { type OfficeModel } from '../shared/office/OfficeStage'
import StatusColumns from '../shared/StatusColumns'
import type { WorldAgent } from '../shared/world-model'
import { adaptAgentOfficeSnapshot, DESK_SLOTS } from './agent-office-model.js'
import RuntimeAgents from '../RuntimeAgents'

type OfficeWorldProps = {
  data: Pick<AgentWorldData, 'agents' | 'tasks'>
  boss?: AgentWorldRecord
  /** CLI sessions among data.agents (shared Agent World characters). */
  cliAgents: WorldAgent[]
  selectedCliId?: string
  onSelectCli: (id: string | undefined) => void
  compacting: Set<string>
  traffic?: ChatTraffic & { at: number }
}

/**
 * Agent Office: the shared Agent World office stage (same as the external
 * Agent World app) fed with GhostForge runtime agents plus CLI sessions.
 */
export default function OfficeWorld({ data, boss, cliAgents, selectedCliId, onSelectCli, compacting, traffic }: OfficeWorldProps) {
  const model = useMemo(
    () => adaptAgentOfficeSnapshot({ agents: data.agents, tasks: data.tasks, boss }) as OfficeModel,
    [data.agents, data.tasks, boss],
  )
  const cliIds = useMemo(() => new Set(cliAgents.map(a => a.id)), [cliAgents])
  const [runtimeId, setRuntimeId] = useState<string>()

  const select = (id: string | undefined) => {
    if (id && cliIds.has(id)) { onSelectCli(id); setRuntimeId(undefined) } else setRuntimeId(id)
  }

  return (
    <section aria-labelledby="agent-office-heading" className="grid min-w-0 gap-4 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-office-heading" className="font-display text-lg font-semibold">Agent Office</h2>
          <p className="mt-1 text-xs text-gf-muted">
            harishkotra/agent-office&apos;s office. Agents sit at desks with short thought bubbles; one that newly needs you gets the
            camera (cinematic mode); idle ones take a break in the Coffee &amp; Pantry. The boss works from the meeting room.
            Click an agent to follow; arrow keys or WASD pan.
          </p>
        </div>
        <span className="rounded-full border border-gf-line2 px-2 py-1 text-xs text-gf-muted">
          {model.agents.length} reported {model.agents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>
      <OfficeStage
        model={model}
        deskSlots={DESK_SLOTS}
        agents={cliAgents}
        selectedId={selectedCliId ?? runtimeId}
        onSelect={select}
        traffic={traffic}
      />
      <StatusColumns title="CLI sessions" agents={cliAgents} selectedId={selectedCliId} onSelect={onSelectCli} compacting={compacting} />
      <RuntimeAgents
        agents={model.agents.filter(a => !cliIds.has(a.id)).map(a => ({ id: a.id, name: a.name, role: a.role ?? '', status: a.status ?? a.action, task: a.currentTask }))}
        selectedId={runtimeId}
        onSelect={setRuntimeId}
      />
    </section>
  )
}
