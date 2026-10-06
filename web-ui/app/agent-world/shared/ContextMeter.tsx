'use client'

import type { Context } from './types'

// Keyframes live here so the component works the same in both apps.
const KEYFRAMES = `
@keyframes aw-crumple { 0% { transform: translate(-14px,-10px) rotate(0) scale(1); opacity: 1 }
  60% { transform: translate(-2px,-2px) rotate(200deg) scale(.7); opacity: 1 }
  100% { transform: translate(0,2px) rotate(320deg) scale(.2); opacity: 0 } }
@keyframes aw-lid { 0%, 100% { transform: rotate(0) } 35%, 70% { transform: rotate(-28deg) } }
@keyframes aw-drain { 0% { opacity: .35 } 100% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .aw-motion { animation: none !important } }
`

/**
 * How full a session's context window is, as a little trash can: the bar is
 * the fill; when Claude Code compacts the context, a crumpled page drops into
 * the can (skipped under prefers-reduced-motion).
 */
export default function ContextMeter({
  context, compacting = false, size = 'sm',
}: {
  context?: Context
  compacting?: boolean
  size?: 'sm' | 'md'
}) {
  const pct = context?.pct
  if (pct === null || pct === undefined) {
    return size === 'md' ? <p className="text-xs text-gf-muted">Context size not reported for this session.</p> : null
  }
  const tone = pct >= 85 ? 'bg-gf-danger' : pct >= 60 ? 'bg-gf-warn' : 'bg-gf-ok'
  const label = `Context ${pct}% full${context?.compactions ? `, compacted ${context.compactions}×` : ''}${compacting ? ' — just compacted' : ''}`
  return (
    <span className={`flex items-center gap-1.5 ${size === 'md' ? 'text-xs' : 'text-[10px]'}`} title={label} aria-label={label} role="img">
      <style>{KEYFRAMES}</style>
      <span className="relative inline-block h-4 w-4 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="absolute inset-0 h-4 w-4 text-gf-muted" fill="none" stroke="currentColor" strokeWidth="1.3">
          <g className="aw-motion" style={{ transformOrigin: '2px 4px', animation: compacting ? 'aw-lid 1.4s ease-in-out' : undefined }}>
            <path d="M2 4h12M6 4V2.5h4V4" />
          </g>
          <path d="M3.5 4.5l.8 9h7.4l.8-9" />
          <path d="M6.5 7v4.5M9.5 7v4.5" />
        </svg>
        {compacting && (
          <span className="aw-motion absolute start-1 top-0 block h-2 w-2 rounded-sm bg-gf-ink/80"
            style={{ animation: 'aw-crumple 1.2s ease-in forwards' }} />
        )}
      </span>
      <span className={`relative h-1.5 overflow-hidden rounded-full bg-gf-raised ${size === 'md' ? 'w-28' : 'w-14'}`}>
        <span className={`aw-motion absolute inset-y-0 start-0 rounded-full ${tone}`}
          style={{ width: `${pct}%`, animation: compacting ? 'aw-drain 1.2s ease-out' : undefined }} />
      </span>
      <span className="font-mono text-gf-muted">{pct}%</span>
      {size === 'md' && !!context?.compactions && <span className="text-gf-muted">· compacted {context.compactions}×</span>}
    </span>
  )
}
