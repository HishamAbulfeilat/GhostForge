'use client'

import OrbSVG from './OrbSVG'
import { useStore, type Store } from './store'
import type { Mode } from './types'

/** The orb, subscribed to the mic level so only it re-renders on every frame. */
export default function LiveOrb({ mode, audioLevel }: { mode: Mode; audioLevel: Store<number> }) {
  const level = useStore(audioLevel)
  return <OrbSVG mode={mode} audioLevel={level} />
}
