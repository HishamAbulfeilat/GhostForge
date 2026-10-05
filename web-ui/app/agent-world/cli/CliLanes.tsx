'use client'

import { activity, ago, isClaude, modelShort, providerLabel, project, usd } from '../shared/format'
import type { Session, World } from '../shared/types'

/** Working → FORGING, waiting on you → QUENCH · REVIEW, trouble → BLOCKED,
 *  finished in the last 12 hours → ARMORY · DONE. */
function lane(session: Session): 'forging' | 'review' | 'blocked' | 'done' | null {
  if (session.health !== 'ok') return 'blocked'
  if (session.status === 'working') return 'forging'
  if (session.status === 'active') return 'review'
  return Date.parse(session.updatedAt ?? '') >= Date.now() - 12 * 60 * 60_000 ? 'done' : null
}

const LANES = [
  { id: 'forging', label: 'FORGING', color: 'text-orange-300' },
  { id: 'review', label: 'QUENCH · REVIEW', color: 'text-gf-warn' },
  { id: 'blocked', label: 'BLOCKED', color: 'text-gf-danger' },
  { id: 'done', label: 'ARMORY · DONE', color: 'text-gf-ok' },
] as const

/** A compact "what every CLI session is doing right now" board for Forge World. */
export default function CliLanes({ world, now, onOpen }: {
  world?: World
  now: number
  onOpen: (id: string) => void
}) {
  if (!world) return null
  const grouped = LANES.map(l => ({ ...l, items: world.sessions.filter(s => lane(s) === l.id) }))
    .filter(l => l.items.length > 0)

  return (
    <section aria-labelledby="cli-lanes-heading" className="rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cli-lanes-heading" className="font-display text-lg font-semibold">CLI sessions</h2>
        <span className="text-xs text-gf-muted">
          {world.counts.working} working · {world.counts.active - world.counts.working} waiting · {usd(world.totals.today.costUSD)} today
        </span>
      </div>
      {grouped.length ? (
        <div className="grid gap-px overflow-hidden rounded-xl border border-gf-line bg-gf-line sm:grid-cols-2 xl:grid-cols-4">
          {grouped.map(l => (
            <section key={l.id} aria-label={`${l.label}, ${l.items.length} sessions`} className="min-w-0 bg-gf-bar p-3">
              <h3 className={`font-mono text-xs font-semibold tracking-wider ${l.color}`}>
                {l.label} <span className="font-normal text-gf-muted">({l.items.length})</span>
              </h3>
              <ul className="mt-2 grid list-none gap-1.5 p-0">
                {l.items.slice(0, 12).map(s => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onOpen(s.id)}
                      className="w-full rounded-lg border border-gf-line px-2 py-1.5 text-start hover:border-gf-accent">
                      <span className="flex items-center gap-1.5">
                        <span className={`size-1.5 shrink-0 rounded-full ${isClaude(s.provider) ? 'bg-orange-400' : 'bg-gf-violet'}`} />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">{project(s).name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-gf-muted">{ago(s.updatedAt, now)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-gf-muted">
                        {providerLabel(s.provider)} · {modelShort(s.model)} · {activity(s)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {l.items.length > 12 && <p className="mt-2 text-[11px] text-gf-muted">+{l.items.length - 12} more in the CLI Sessions view.</p>}
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">
          No CLI sessions have written anything in the last 12 hours.
        </p>
      )}
    </section>
  )
}
