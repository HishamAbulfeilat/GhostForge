'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { duration } from './format'
import { replayFrames, type Replay } from './replay'
import type { SessionEvent } from './types'

const STEP_MS = 1200

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/**
 * Scrubber over a session's recorded events (oldest first). While the user
 * scrubs or plays, `onReplay` gets the frame so the scene can move that
 * session's character to match; `undefined` hands the scene back to live data.
 */
export default function ReplayScrubber({
  sessionId, events, onReplay,
}: {
  sessionId: string
  events: SessionEvent[] | undefined
  onReplay?: (replay: Replay | undefined) => void
}) {
  const frames = useMemo(() => replayFrames(events), [events])
  // null = live (not replaying).
  const [index, setIndex] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const onReplayRef = useRef(onReplay)
  onReplayRef.current = onReplay

  // A different session starts live again.
  useEffect(() => { setIndex(null); setPlaying(false) }, [sessionId])

  const at = index === null ? null : Math.min(index, frames.length - 1)
  const frame = at === null || at < 0 ? undefined : frames[at]

  useEffect(() => {
    onReplayRef.current?.(frame ? { id: sessionId, frame } : undefined)
  }, [frame, sessionId])
  // Closing the drawer (unmount) always returns the scene to live.
  useEffect(() => () => onReplayRef.current?.(undefined), [])

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setIndex(i => Math.min((i ?? -1) + 1, frames.length - 1)), STEP_MS)
    return () => clearInterval(t)
  }, [playing, frames.length])
  // Stop at the last step.
  useEffect(() => { if (playing && at === frames.length - 1) setPlaying(false) }, [playing, at, frames.length])

  if (!frames.length) return <p className="text-xs text-gf-muted">Nothing to replay yet: no timed events were recorded for this session.</p>

  const describe = (i: number) => {
    const f = frames[i]
    return f.kind === 'idle'
      ? `${clock(f.at)}, quiet for ${duration(f.idleMs)}`
      : `${clock(f.at)}, ${f.event?.type}: ${f.line}`
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => {
          if (playing) { setPlaying(false); return }
          if (at === null || at >= frames.length - 1) setIndex(0)
          setPlaying(true)
        }}
          className="rounded-md border border-gf-line px-2.5 py-1 text-xs font-semibold hover:border-gf-accent">
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button type="button" disabled={at === null} onClick={() => { setPlaying(false); setIndex(null) }}
          className="rounded-md border border-gf-line px-2.5 py-1 text-xs hover:border-gf-accent disabled:opacity-40">
          Back to live
        </button>
        <span className="ms-auto font-mono text-[11px] text-gf-muted">
          {at === null ? `${frames.length} steps` : `${at + 1} / ${frames.length}`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        step={1}
        value={at ?? frames.length - 1}
        onChange={e => { setPlaying(false); setIndex(Number(e.target.value)) }}
        aria-label="Replay position"
        aria-valuetext={describe(at ?? frames.length - 1)}
        className="w-full accent-gf-accent"
      />
      <p aria-live="polite" className="min-h-5 text-xs">
        {frame ? (
          <>
            <span className="font-mono text-gf-muted">{clock(frame.at)}</span>{' '}
            {frame.kind === 'idle'
              ? <span className="text-gf-muted">quiet for {duration(frame.idleMs)}: the character takes a break</span>
              : <span className="font-semibold">{frame.line}</span>}
          </>
        ) : <span className="text-gf-muted">Showing live state. Play or drag to replay what this session did; its character follows in the scene.</span>}
      </p>
      {frame && (
        <p className="font-mono text-[11px] text-gf-muted">
          so far: {frame.counts.tools} tools · {frame.counts.subagents} subagents · {frame.counts.compactions} compactions · {frame.counts.errors} errors
        </p>
      )}
    </div>
  )
}
