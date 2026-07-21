'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type NotifType = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id: string
  type: NotifType
  title: string
  body?: string
  ts: number
  read: boolean
}

interface NotifCtx {
  notifications: Notification[]
  unread: number
  push: (n: Omit<Notification, 'id' | 'ts' | 'read'>) => void
  markAllRead: () => void
  dismiss: (id: string) => void
  clear: () => void
}

const Ctx = createContext<NotifCtx>({
  notifications: [],
  unread: 0,
  push: () => {},
  markAllRead: () => {},
  dismiss: () => {},
  clear: () => {},
})

export function useNotifications() {
  return useContext(Ctx)
}

const ICONS: Record<NotifType, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }
const COLORS: Record<NotifType, string> = {
  info: 'border-sky-500/40 bg-sky-500/10',
  success: 'border-emerald-500/40 bg-emerald-500/10',
  warning: 'border-yellow-500/40 bg-yellow-500/10',
  error: 'border-red-500/40 bg-red-500/10',
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.read).length

  const push = useCallback((n: Omit<Notification, 'id' | 'ts' | 'read'>) => {
    const notif: Notification = { ...n, id: crypto.randomUUID(), ts: Date.now(), read: false }
    setNotifications(prev => [notif, ...prev].slice(0, 50))
    // Auto-toast for 4s
    const toastEl = document.getElementById('gf-toast-container')
    if (toastEl) {
      const toast = document.createElement('div')
      toast.className = `flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur-sm ${COLORS[n.type]} text-white animate-fade-in`
      toast.innerHTML = `<span>${ICONS[n.type]}</span><div><p class="font-medium">${n.title}</p>${n.body ? `<p class="text-xs opacity-70">${n.body}</p>` : ''}</div>`
      toastEl.appendChild(toast)
      setTimeout(() => toast.remove(), 4000)
    }
  }, [])

  const markAllRead = useCallback(() => setNotifications(prev => prev.map(n => ({ ...n, read: true }))), [])
  const dismiss = useCallback((id: string) => setNotifications(prev => prev.filter(n => n.id !== id)), [])
  const clear = useCallback(() => setNotifications([]), [])

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Expose push to window for bridge events
  useEffect(() => {
    (window as unknown as Record<string, unknown>).gfNotify = push
  }, [push])

  const ctx = useMemo(
    () => ({ notifications, unread, push, markAllRead, dismiss, clear }),
    [notifications, unread, push, markAllRead, dismiss, clear]
  )

  return (
    <Ctx.Provider value={ctx}>
      {children}

      {/* Toast container */}
      <div id="gf-toast-container" className="fixed bottom-4 right-4 z-[9998] flex flex-col gap-2 items-end" />

      {/* Bell button */}
      <div className="fixed top-3 right-3 z-[9997]" ref={panelRef}>
        <button type="button"
          onClick={() => { setOpen(o => !o); if (!open) markAllRead() }}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-gray-900/80 text-white/60 backdrop-blur-sm hover:border-white/20 hover:text-white transition-colors"
          title="Notifications"
        >
          🔔
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* Panel */}
        {open && (
          <div className="absolute right-0 top-11 w-80 overflow-hidden rounded-2xl border border-white/10 bg-gray-900/95 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <p className="text-sm font-semibold text-white">Notifications</p>
              <button onClick={clear} className="text-[11px] text-white/40 hover:text-white transition-colors">Clear all</button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="py-8 text-center text-sm text-white/30">No notifications</p>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className={`relative border-b border-white/[0.05] px-4 py-3 ${n.read ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-sm">{ICONS[n.type]}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{n.title}</p>
                        {n.body && <p className="mt-0.5 text-xs text-white/50 line-clamp-2">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-white/30">
                          {new Date(n.ts).toLocaleTimeString()}
                        </p>
                      </div>
                      <button onClick={() => dismiss(n.id)} className="ml-1 text-white/20 hover:text-white/60 transition-colors">✕</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}
