'use client'

import { memo, useEffect } from 'react'

export interface InboxMessage { id: string; from: string; text: string; ts: string }

/**
 * Polls /api/jarvis/inbox every 20 s for messages from other GhostForge users
 * and hands each new one to `onMessage` once. Renders nothing.
 */
function InboxWatcher({ onMessage }: { onMessage: (message: InboxMessage) => void }) {
  useEffect(() => {
    let cancelled = false
    const seen = new Set<string>()

    const checkInbox = async () => {
      try {
        const res = await fetch('/api/jarvis/inbox')
        if (!res.ok) return
        const data = await res.json() as { messages: InboxMessage[]; unread: number }
        if (cancelled) return
        for (const m of data.messages) {
          if (seen.has(m.id)) continue
          seen.add(m.id)
          onMessage(m)
        }
        void fetch('/api/jarvis/inbox', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        }).catch(() => {})
      } catch {
        /* server unreachable — retry next tick */
      }
    }

    void checkInbox()
    const timer = window.setInterval(checkInbox, 20000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [onMessage])

  return null
}

export default memo(InboxWatcher)
