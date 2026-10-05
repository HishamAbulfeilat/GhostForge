'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentWorldData, AgentWorldRecord } from '../agent-world-model'
import StatusColumns from '../shared/StatusColumns'
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

  const select = (id: string | undefined) => {
    if (id && cliIds.has(id)) { onSelectCli(id); setRuntimeId(undefined) } else setRuntimeId(id)
  }

  // The scene runs in pages/agent-world/town-frame (React 18 for @pixi/react 7).
  // It gets the characters by postMessage and sends selections back.
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameReady, setFrameReady] = useState(false)
  const selectRef = useRef(select)
  selectRef.current = select
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { type?: string; id?: string }
      if (data?.type === 'aw-town-ready') setFrameReady(true)
      else if (data?.type === 'aw-town-select') selectRef.current(data.id && data.id !== 'you' ? data.id : undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  const selectedId = selectedCliId ?? runtimeId
  useEffect(() => {
    if (!frameReady) return
    frameRef.current?.contentWindow?.postMessage({ type: 'aw-town-state', players, agents: cliAgents, selectedId }, window.location.origin)
  }, [frameReady, players, cliAgents, selectedId])

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
      <iframe
        ref={frameRef}
        src="/agent-world/town-frame"
        title="Agent Town scene"
        className="block w-full rounded-xl border-0"
        style={{ height: 'calc(min(70dvh, 680px) + 44px)', minHeight: 364 }}
      />
      <StatusColumns title="CLI sessions" agents={cliAgents} selectedId={selectedCliId} onSelect={onSelectCli} compacting={compacting} />
      <RuntimeAgents
        agents={players.filter(p => !cliIds.has(p.id)).map(p => ({ id: p.id, name: p.name, role: p.role, status: p.status, task: p.description }))}
        selectedId={runtimeId}
        onSelect={setRuntimeId}
      />
    </section>
  )
}
