'use client'

import { useState } from 'react'
import type { AgentWorldData, AgentWorldRecord } from './agent-world-model'

type ForgeWorldSceneProps = Pick<AgentWorldData, 'agents' | 'tasks' | 'boss'>

type TaskLane = {
  id: 'todo' | 'forging' | 'review' | 'done' | 'blocked' | 'other'
  label: string
  color: string
  tasks: AgentWorldRecord[]
}

const EMPTY_LANES: Omit<TaskLane, 'tasks'>[] = [
  { id: 'todo', label: 'ORE · TODO', color: '#B9AFA4' },
  { id: 'forging', label: 'FORGING', color: '#F2A65A' },
  { id: 'review', label: 'QUENCH · REVIEW', color: '#E9D27A' },
  { id: 'done', label: 'ARMORY · DONE', color: '#8FD3A8' },
  { id: 'blocked', label: 'BLOCKED', color: '#E58C8C' },
  { id: 'other', label: 'OTHER · REPORTED', color: '#A9ADB6' },
]

function text(record: AgentWorldRecord, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field]
    if ((typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      && String(value).trim()) {
      return String(value).trim()
    }
  }
  return null
}

function taskLane(task: AgentWorldRecord): TaskLane['id'] {
  const status = text(task, ['status', 'state'])?.toLowerCase().replaceAll('_', '-')
  if (!status) return 'other'
  if (['todo', 'pending', 'queued'].includes(status)) return 'todo'
  if (['in-progress', 'in progress', 'working', 'active', 'forging'].includes(status)) return 'forging'
  if (['review', 'in-review', 'in review', 'quench'].includes(status)) return 'review'
  if (['done', 'complete', 'completed'].includes(status)) return 'done'
  if (status === 'blocked') return 'blocked'
  return 'other'
}

function agentName(agent: AgentWorldRecord, index: number): string {
  return text(agent, ['name', 'id']) ?? `Agent identity not reported (${index + 1})`
}

function agentTone(agent: AgentWorldRecord): { color: string; border: string } {
  const state = text(agent, ['state', 'status'])?.toLowerCase()
  if (state && ['working', 'active', 'in-progress', 'busy', 'forging'].includes(state)) {
    return { color: '#F2A65A', border: '#8A5A2B' }
  }
  if (state && ['review', 'in-review'].includes(state)) {
    return { color: '#E9D27A', border: '#6B5C25' }
  }
  if (state && ['done', 'complete', 'completed'].includes(state)) {
    return { color: '#8FD3A8', border: '#386747' }
  }
  if (state === 'blocked' || state === 'error' || state === 'failed') {
    return { color: '#E58C8C', border: '#793F3F' }
  }
  return { color: '#B9AFA4', border: '#3A2C27' }
}

function AgentDetails({ agent, label }: { agent: AgentWorldRecord; label: string }) {
  const fields = [
    ['State', ['state', 'status']],
    ['Task', ['task', 'taskTitle']],
    ['Provider', ['provider']],
    ['Model', ['model']],
    ['Role', ['role']],
    ['Source', ['source']],
  ] as const

  return (
    <dl aria-label={label} aria-live="polite" className="mt-3 grid gap-2 border-t border-[#3A2C27] pt-3 text-xs sm:grid-cols-2">
      {fields.map(([title, keys]) => {
        const value = text(agent, [...keys])
        return value ? (
          <div key={title} className="min-w-0">
            <dt className="text-[#B9AFA4]">{title}</dt>
            <dd className="m-0 mt-1 break-words">{value}</dd>
          </div>
        ) : null
      })}
    </dl>
  )
}

function AgentStation({
  agent,
  index,
  selected,
  onSelect,
}: {
  agent: AgentWorldRecord
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const name = agentName(agent, index)
  const state = text(agent, ['state', 'status']) ?? 'State not reported'
  const task = text(agent, ['task', 'taskTitle']) ?? 'Task not reported'
  const tone = agentTone(agent)

  return (
    <li className="min-w-0 list-none">
      <button
        type="button"
        aria-label={`${name}; ${state}; ${task}`}
        aria-pressed={selected}
        onClick={onSelect}
        className={`min-h-36 w-full rounded-2xl border-2 p-4 text-start text-[#EDE6DD] shadow-sm outline-none transition-colors hover:bg-[#2A201D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2A65A] motion-reduce:transition-none${selected ? ' rounded-b-none' : ''}`}
        style={{ backgroundColor: '#1E1715', borderColor: tone.border }}
      >
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl font-mono text-sm font-bold" style={{ backgroundColor: tone.color, color: '#1A1208' }}>
            {name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block break-words text-sm font-semibold">{name}</span>
            <span className="mt-1 block font-mono text-[11px]" style={{ color: tone.color }}>{state}</span>
          </span>
        </span>
        <span className="mt-3 block break-words text-sm leading-snug">{task}</span>
      </button>
      {selected && (
        <div className="-mt-px rounded-b-2xl border-2 border-t-0 px-4 pb-4" style={{ backgroundColor: '#1E1715', borderColor: tone.border }}>
          <AgentDetails agent={agent} label={`${name} snapshot details`} />
        </div>
      )}
    </li>
  )
}

export default function ForgeWorldScene({ agents, tasks, boss }: ForgeWorldSceneProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const leaderIndex = agents.findIndex(agent => agent.leader === true || text(agent, ['role'])?.toLowerCase() === 'boss')
  const selectedBoss = selectedAgent === 'snapshot-boss'
  const lanes = EMPTY_LANES.map(lane => ({
    ...lane,
    tasks: tasks.filter(task => taskLane(task) === lane.id),
  }))
  const bossTone = boss ? agentTone(boss) : { color: '#B9AFA4', border: '#3A2C27' }
  const bossLabel = boss ? text(boss, ['name', 'id']) ?? 'Boss' : leaderIndex >= 0 ? agentName(agents[leaderIndex], leaderIndex) : null
  const bossRecord = boss ?? (leaderIndex >= 0 ? agents[leaderIndex] : null)
  const workers = agents.filter((_, index) => index !== leaderIndex)

  return (
    <section aria-labelledby="forge-world-heading" className="min-w-0 overflow-hidden rounded-2xl border border-[#3A2C27] bg-[#121010] p-4 text-[#EDE6DD] sm:p-6">
      <header className="mb-6">
        <h2 id="forge-world-heading" className="font-display text-2xl font-bold">Forge World</h2>
        <p className="mt-2 max-w-3xl text-sm text-[#B9AFA4]">
          Each worker tends a furnace. The boss holds the anvil; every status, task, and agent shown here comes from the available snapshot.
        </p>
        <p className="mt-2 font-mono text-xs text-[#B9AFA4]">
          {agents.length + (boss && leaderIndex < 0 ? 1 : 0)} reported agents · {tasks.length} reported tasks · no inferred progress
        </p>
      </header>

      <div className="mx-auto mb-7 max-w-xl">
        <section aria-label="Boss anvil" className="rounded-3xl border-2 p-5 text-center" style={{ backgroundColor: '#2B1C12', borderColor: bossTone.color }}>
          {bossRecord ? (
            <div>
              <button
                type="button"
                aria-label={`The Anvil; ${bossLabel}; ${text(bossRecord, ['state', 'status']) ?? 'State not reported'}`}
                aria-pressed={selectedBoss}
                onClick={() => setSelectedAgent(selectedBoss ? null : 'snapshot-boss')}
                className="mx-auto block w-full rounded-xl p-2 text-[#EDE6DD] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2A65A]"
              >
                <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-full font-display text-xl font-bold" style={{ backgroundColor: bossTone.color, color: '#1A1208' }}>
                  {(bossLabel ?? 'B').slice(0, 1).toUpperCase()}
                </span>
                <span className="mt-2 block font-display text-base font-bold">The Anvil · {bossLabel}</span>
                <span className="mt-1 block font-mono text-xs" style={{ color: bossTone.color }}>
                  {[text(bossRecord, ['state', 'status']), text(bossRecord, ['task', 'taskTitle']), text(bossRecord, ['model'])].filter(Boolean).join(' · ') || 'No further details reported'}
                </span>
              </button>
              {selectedBoss && <AgentDetails agent={bossRecord} label="Boss snapshot details" />}
            </div>
          ) : (
            <p className="m-0 font-mono text-sm text-[#B9AFA4]">Boss details were not reported in this snapshot.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="forge-world-workers-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="forge-world-workers-heading" className="font-display text-lg font-semibold">Furnaces · agents</h3>
          <span className="font-mono text-xs text-[#B9AFA4]">{workers.length} reported worker{workers.length === 1 ? '' : 's'}</span>
        </div>
        {workers.length ? (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {workers.map((agent, index) => {
              const sourceIndex = index >= leaderIndex && leaderIndex >= 0 ? index + 1 : index
              const id = text(agent, ['id', 'name']) ?? `unidentified-${sourceIndex}`
              const selectionId = `${id}-${sourceIndex}`
              return (
                <AgentStation
                  key={`${id}-${sourceIndex}`}
                  agent={agent}
                  index={sourceIndex}
                  selected={selectedAgent === selectionId}
                  onSelect={() => setSelectedAgent(selectedAgent === selectionId ? null : selectionId)}
                />
              )
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-[#3A2C27] p-4 text-sm text-[#B9AFA4]">
            No worker agents were reported by the available snapshots.
          </p>
        )}
      </section>

      <section aria-labelledby="forge-world-lanes-heading" className="mt-7">
        <h3 id="forge-world-lanes-heading" className="mb-3 font-display text-lg font-semibold">Work lanes</h3>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-[#3A2C27] bg-[#3A2C27] sm:grid-cols-2 xl:grid-cols-3">
          {lanes.map(lane => (
            <section key={lane.id} aria-label={`${lane.label}, ${lane.tasks.length} reported tasks`} className="min-w-0 bg-[#1A1413] p-4">
              <h4 className="font-mono text-xs font-semibold tracking-wider" style={{ color: lane.color }}>
                {lane.label} <span className="font-normal">({lane.tasks.length})</span>
              </h4>
              {lane.tasks.length ? (
                <ul className="mt-3 grid list-none gap-2 p-0">
                  {lane.tasks.map((task, index) => (
                    <li key={`${text(task, ['id']) ?? 'task'}-${index}`} className="min-w-0 rounded-lg border px-3 py-2 font-mono text-xs" style={{ backgroundColor: '#2A201D', borderColor: lane.color }}>
                      <span className="block break-words font-semibold">{text(task, ['id']) ?? 'Task ID not reported'}</span>
                      <span className="mt-1 block break-words font-sans">{text(task, ['title', 'description']) ?? 'Task title not reported'}</span>
                      {text(task, ['status', 'state']) && (
                        <span className="mt-1 block break-words text-[#B9AFA4]">Status: {text(task, ['status', 'state'])}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-[#B9AFA4]">No tasks with this reported status.</p>
              )}
            </section>
          ))}
        </div>
        {tasks.length === 0 && (
          <p className="sr-only">No workflow tasks were reported by the available snapshots.</p>
        )}
      </section>
    </section>
  )
}
