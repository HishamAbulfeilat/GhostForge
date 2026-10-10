'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ATTENTION_LABEL, type Attention } from './status'
import type { WorldAgent } from './world-model'

/** True when the OS asks for reduced motion; follows changes live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

/**
 * False while the element is scrolled out of view, so a scene can stop
 * rendering (IntersectionObserver; inside a frame it is measured against the
 * top-level viewport). True when the observer is unavailable.
 */
export function useOnScreen(ref: RefObject<Element | null>, rootMargin = '64px'): boolean {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      if (entry) setOnScreen(entry.isIntersecting)
    }, { rootMargin })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin])
  return onScreen
}

/** Counts up every `ms`; bubbles use it to rotate their phrases. */
export function useRotation(ms = 4000): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return tick
}

/** The bubble a character shows at this tick ('' = quiet). */
export function bubbleAt(agent: Pick<WorldAgent, 'bubbles'> | undefined, tick: number): string {
  const lines = agent?.bubbles ?? []
  return lines.length ? lines[tick % lines.length] : ''
}

/** A boolean persisted in localStorage (per browser), e.g. a panel toggle. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored !== null) setValue(stored === '1')
    } catch { /* storage unavailable */ }
  }, [key])
  const update = (next: boolean) => {
    setValue(next)
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* storage unavailable */ }
  }
  return [value, update]
}

/**
 * Session ids whose context window was just compacted (their compaction count
 * went up since the last snapshot). Each id stays in the set for `holdMs` so
 * the trash-can animation can play.
 */
export function useCompactions(agents: Pick<WorldAgent, 'id' | 'context'>[], holdMs = 2600): Set<string> {
  const seen = useRef(new Map<string, number>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [active, setActive] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const fresh: string[] = []
    for (const a of agents) {
      const count = a.context?.compactions ?? 0
      const before = seen.current.get(a.id)
      if (before !== undefined && count > before) fresh.push(a.id)
      seen.current.set(a.id, count)
    }
    if (!fresh.length) return
    setActive(prev => new Set([...prev, ...fresh]))
    // Not cancelled by the next snapshot: a refresh inside holdMs must not leave the animation stuck on.
    const t = setTimeout(() => {
      timers.current.delete(t)
      setActive(prev => {
        const next = new Set(prev)
        for (const id of fresh) next.delete(id)
        return next
      })
    }, holdMs)
    timers.current.add(t)
  }, [agents, holdMs])
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t) }, [])
  return active
}

export type AttentionItem = { id: string; name: string; kind: Attention; label: string; key: string }

type NotifyPermission = NotificationPermission | 'unsupported'
const ASKED_KEY = 'aw-notify-asked'

/**
 * Sessions that need the user (waiting for them, stalled or unhealthy). Fires
 * one browser notification when a session newly enters one of those states —
 * never twice while it stays in it — and asks for permission once, on the
 * first click anywhere on the page.
 */
export function useAttention(agents: WorldAgent[], onOpen?: (id: string) => void) {
  const items = useMemo<AttentionItem[]>(() => agents.flatMap(a => a.attention ? [{
    id: a.id,
    name: a.name,
    kind: a.attention,
    label: ATTENTION_LABEL[a.attention],
    key: `${a.id}|${a.attention}`,
  }] : []), [agents])
  const [permission, setPermission] = useState<NotifyPermission>('unsupported')
  // Last known reason per session ('' = fine); undefined until the first snapshot.
  const last = useRef<Map<string, string>>()
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    setPermission(Notification.permission)
    if (Notification.permission !== 'default') return
    let asked = false
    try { asked = localStorage.getItem(ASKED_KEY) === '1' } catch { /* storage unavailable */ }
    if (asked) return
    const ask = () => {
      try { localStorage.setItem(ASKED_KEY, '1') } catch { /* storage unavailable */ }
      void Notification.requestPermission().then(setPermission, () => {})
    }
    window.addEventListener('pointerdown', ask, { once: true })
    return () => window.removeEventListener('pointerdown', ask)
  }, [])

  useEffect(() => {
    if (!agents.length) return
    const next = new Map(agents.map(a => [a.id, a.attention ?? '']))
    const before = last.current
    last.current = next
    // The first snapshot only records what is already pending: no burst on load.
    if (!before) return
    for (const item of items) {
      if (before.get(item.id) === item.kind) continue
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') continue
      try {
        const n = new Notification(`${item.name}: ${item.label}`, { body: 'Agent World', tag: item.key })
        n.onclick = () => { window.focus(); onOpenRef.current?.(item.id); n.close() }
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [items, agents])

  const request = () => {
    if (typeof Notification === 'undefined') return
    try { localStorage.setItem(ASKED_KEY, '1') } catch { /* storage unavailable */ }
    void Notification.requestPermission().then(setPermission, () => {})
  }

  return { items, permission, request }
}

/** Local-time sky tint for the worlds: night, dawn, day or dusk. */
export function skyAt(date: Date): { phase: 'night' | 'dawn' | 'day' | 'dusk'; tint: string } {
  const h = date.getHours() + date.getMinutes() / 60
  if (h >= 6 && h < 8) return { phase: 'dawn', tint: 'rgba(255, 170, 110, 0.16)' }
  if (h >= 8 && h < 17.5) return { phase: 'day', tint: 'rgba(0, 0, 0, 0)' }
  if (h >= 17.5 && h < 19.5) return { phase: 'dusk', tint: 'rgba(170, 90, 160, 0.22)' }
  return { phase: 'night', tint: 'rgba(20, 30, 90, 0.38)' }
}

/** The sky right now, re-checked every minute. */
export function useSky() {
  const [sky, setSky] = useState(() => skyAt(new Date()))
  useEffect(() => {
    const t = setInterval(() => setSky(skyAt(new Date())), 60_000)
    return () => clearInterval(t)
  }, [])
  return sky
}
