'use client'

import { useReducedMotion, useSky } from './hooks'

/**
 * Day/night tint over a world scene, from the viewer's local time. Purely
 * visual (pointer events pass through); no transition under reduced motion.
 */
export default function Ambience({ enabled }: { enabled: boolean }) {
  const sky = useSky()
  const reduced = useReducedMotion()
  if (!enabled) return null
  return (
    <div
      aria-hidden="true"
      data-phase={sky.phase}
      className="pointer-events-none absolute inset-0 z-[5] rounded-xl"
      style={{ background: sky.tint, mixBlendMode: 'multiply', transition: reduced ? undefined : 'background 4s ease' }}
    />
  )
}

/** Small "☀ day / ☾ night" toggle shared by both scenes. */
export function AmbienceToggle({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  const sky = useSky()
  const icon = sky.phase === 'night' ? '☾' : sky.phase === 'day' ? '☀' : '◐'
  return (
    <button type="button" aria-pressed={enabled} onClick={() => onChange(!enabled)}
      title="Day/night tint from your local time; idle characters take breaks"
      className="rounded-md border border-gf-line px-2.5 py-1 text-xs hover:border-gf-accent aria-pressed:border-gf-accent aria-pressed:text-gf-accent">
      {icon} Ambience: {enabled ? sky.phase : 'off'}
    </button>
  )
}
