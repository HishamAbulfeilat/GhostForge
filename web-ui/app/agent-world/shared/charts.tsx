/** Tiny activity sparkline: one bar per 5-minute bucket, oldest first. */
export function Spark({ values, className = '', tone = '#6EE7B7', label }: { values: number[]; className?: string; tone?: string; label?: string }) {
  const max = Math.max(1, ...values)
  const w = 2, gap = 1, h = 16
  return (
    <svg
      role="img"
      aria-label={label ?? `activity over the last ${values.length * 5} minutes`}
      viewBox={`0 0 ${values.length * (w + gap)} ${h}`}
      preserveAspectRatio="none"
      className={className}
    >
      {values.map((v, i) => (
        <rect key={i} x={i * (w + gap)} y={h - Math.max(v ? 2 : 1, (v / max) * h)} width={w}
          height={Math.max(v ? 2 : 1, (v / max) * h)} fill={v ? tone : '#262B38'} rx={0.5} />
      ))}
    </svg>
  )
}

/** Larger column chart for the 2-hour activity panel, with a time axis. */
export function Columns({ values, bucketMinutes }: { values: number[]; bucketMinutes: number }) {
  const max = Math.max(1, ...values)
  const total = values.length * bucketMinutes
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={`Activity per ${bucketMinutes} minutes over the last ${total} minutes`}>
        {values.map((v, i) => (
          <div key={i} className="group relative flex-1">
            <div
              className="w-full rounded-t-[3px] bg-gf-ok/80 transition-[height] group-hover:bg-gf-ok"
              style={{ height: `${Math.max(v ? 4 : 1, (v / max) * 112)}px`, opacity: v ? 1 : 0.25 }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gf-ink px-1.5 py-0.5 font-mono text-[10px] text-gf-bg group-hover:block">
              {v} · {(values.length - 1 - i) * bucketMinutes}m ago
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-gf-muted">
        <span>{total / 60}h ago</span><span>1h ago</span><span>now</span>
      </div>
    </div>
  )
}

/** Horizontal bars for ranked counts (tools, models). */
export function Bars({ items, tone = '#FDBA74', format = (n: number) => String(n) }: {
  items: { name: string; count: number }[]
  tone?: string
  format?: (n: number) => string
}) {
  const max = Math.max(1, ...items.map(i => i.count))
  if (!items.length) return <p className="text-xs text-gf-muted">Nothing recorded yet.</p>
  return (
    <ul className="grid list-none gap-1.5 p-0">
      {items.map(i => (
        <li key={i.name} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate font-mono" title={i.name}>{i.name}</span>
          <span className="h-2 overflow-hidden rounded-full bg-gf-raised">
            <span className="block h-full rounded-full" style={{ width: `${(i.count / max) * 100}%`, background: tone }} />
          </span>
          <span className="w-12 text-end font-mono text-gf-muted">{format(i.count)}</span>
        </li>
      ))}
    </ul>
  )
}
