'use client'

import { useEffect, useRef, useState } from 'react'
import type { AttentionItem } from './hooks'

/**
 * Header badge: how many sessions need you, with a drop-down list. Selecting
 * one opens its details.
 */
export default function AttentionBadge({
  items, permission, onRequestPermission, onOpen,
}: {
  items: AttentionItem[]
  permission: NotificationPermission | 'unsupported'
  onRequestPermission: () => void
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const count = items.length
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${count} ${count === 1 ? 'session needs' : 'sessions need'} you`}
        className={`flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm ${count ? 'border-gf-warn text-gf-warn' : 'border-gf-line text-gf-muted'} hover:border-gf-accent`}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M8 2a4 4 0 0 0-4 4v2.5L2.8 11h10.4L12 8.5V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" />
        </svg>
        <span className="font-mono">{count}</span>
        <span className="hidden sm:inline">need{count === 1 ? 's' : ''} you</span>
      </button>
      {open && (
        <div className="absolute end-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gf-line bg-gf-surface p-3 text-sm shadow-2xl">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gf-muted">Needs you</h3>
          {count ? (
            <ul className="mt-2 grid max-h-72 list-none gap-1 overflow-y-auto p-0">
              {items.map(item => (
                <li key={item.key}>
                  <button type="button" onClick={() => { setOpen(false); onOpen(item.id) }}
                    className="flex w-full items-center gap-2 rounded-lg border border-gf-line px-2.5 py-1.5 text-start hover:border-gf-accent">
                    <span className={`size-2 shrink-0 rounded-full ${item.kind === 'waiting' ? 'bg-gf-warn' : 'bg-gf-danger'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
                    <span className="shrink-0 text-xs text-gf-muted">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-xs text-gf-muted">Nothing is waiting on you.</p>}
          <p className="mt-3 border-t border-gf-line pt-2 text-xs text-gf-muted">
            {permission === 'granted' && 'Browser notifications are on: you get one when a session newly needs you.'}
            {permission === 'denied' && 'Browser notifications are blocked for this page; allow them in the site settings.'}
            {permission === 'unsupported' && 'This browser does not support notifications.'}
            {permission === 'default' && (
              <button type="button" onClick={onRequestPermission} className="font-semibold text-gf-accent underline">
                Turn on browser notifications
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
