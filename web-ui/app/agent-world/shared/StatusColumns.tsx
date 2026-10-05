'use client'

import ContextMeter from './ContextMeter'
import { isClaude } from './format'
import { COLUMNS, type Column } from './status'
import type { WorldAgent } from './world-model'

const HEAD_TONE: Record<Column, string> = {
  needs: 'text-gf-warn', working: 'text-gf-ok', done: 'text-gf-ink', ended: 'text-gf-muted',
}

/**
 * The roster as four columns — Needs you · Working · Done · Ended. Every card
 * opens the session's details.
 */
export default function StatusColumns({
  agents, selectedId, onSelect, compacting, title = 'Sessions',
}: {
  agents: WorldAgent[]
  selectedId?: string
  onSelect: (id: string | undefined) => void
  compacting?: Set<string>
  title?: string
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-gf-line bg-gf-surface p-3">
      <h3 className="text-sm font-semibold">{title} <span className="font-normal text-gf-muted">· {agents.length}</span></h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map(col => {
          const cards = agents.filter(a => a.column === col.id)
          return (
            <div key={col.id} className="min-w-0">
              <h4 className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${HEAD_TONE[col.id]}`}>
                {col.id === 'needs' && cards.length > 0 && <span className="size-2 animate-pulse rounded-full bg-gf-warn" aria-hidden="true" />}
                {col.label} <span className="font-normal text-gf-muted">{cards.length}</span>
              </h4>
              {cards.length ? (
                <ul className="grid max-h-[22rem] list-none gap-1.5 overflow-y-auto p-0">
                  {cards.map(a => (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={a.id === selectedId}
                        onClick={() => onSelect(a.id === selectedId ? undefined : a.id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-start hover:border-gf-accent aria-pressed:border-gf-ink aria-pressed:bg-gf-raised ${col.id === 'needs' ? 'border-gf-warn/60' : 'border-gf-line'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.name}</span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${isClaude(a.provider) ? 'bg-orange-500/15 text-orange-500' : 'bg-gf-violet-soft text-gf-violet'}`}>
                            {isClaude(a.provider) ? 'Claude' : 'Copilot'}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-gf-muted">{a.role.split(' · ')[1]} · {a.taskTitle}</span>
                        <span className="mt-1.5 flex items-center justify-between gap-2">
                          <ContextMeter context={a.context} compacting={compacting?.has(a.id)} />
                          {a.onBreak && <span className="text-[10px] text-gf-muted">on a break</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-gf-line p-2.5 text-xs text-gf-muted">{col.empty}</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
