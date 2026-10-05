'use client'

import { useEffect, useRef, useState } from 'react'
import type { WorldAgent } from './world-model'

export const CHAT_MAX_CHARS = 4000

type Line = { role: 'you' | 'claude' | 'error'; text: string; at: number }
export type ChatTraffic = { sessionId: string; direction: 'sent' | 'received' | 'failed' }

/**
 * Message a Claude Code session from any view. The server resumes the session
 * with `claude -p --resume <id>` in its folder and returns the reply. Only this
 * box's own messages are kept, in memory; transcripts are never read for it.
 */
export default function ChatBox({
  agents, selectedId, endpoint, onTraffic,
}: {
  agents: WorldAgent[]
  selectedId?: string
  endpoint: string
  onTraffic?: (traffic: ChatTraffic) => void
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string>()
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string>()
  const [log, setLog] = useState<Record<string, Line[]>>({})
  const listRef = useRef<HTMLOListElement>(null)
  const claude = agents.filter(a => a.provider === 'claude-code')

  // Follow the selected session when it can be chatted with.
  useEffect(() => {
    if (selectedId && claude.some(a => a.id === selectedId)) setTarget(selectedId)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = claude.find(a => a.id === target) ?? (target ? undefined : claude[0])
  const lines = current ? log[current.id] ?? [] : []

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [lines.length, open])

  const add = (id: string, line: Line) => setLog(prev => ({ ...prev, [id]: [...(prev[id] ?? []), line].slice(-50) }))

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const message = draft.trim()
    if (!current || !message || pending) return
    const id = current.id
    setDraft('')
    setPending(id)
    add(id, { role: 'you', text: message, at: Date.now() })
    onTraffic?.({ sessionId: id, direction: 'sent' })
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: id, message }),
      })
      const body = await r.json().catch(() => ({})) as { reply?: string; error?: string; isError?: boolean }
      if (!r.ok || body.error) throw new Error(body.error || `Chat request failed (${r.status})`)
      add(id, { role: body.isError ? 'error' : 'claude', text: body.reply || '(empty reply)', at: Date.now() })
      onTraffic?.({ sessionId: id, direction: 'received' })
    } catch (err) {
      add(id, { role: 'error', text: err instanceof Error ? err.message : 'Chat request failed.', at: Date.now() })
      onTraffic?.({ sessionId: id, direction: 'failed' })
    } finally {
      setPending(undefined)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="fixed bottom-4 end-4 z-30 flex items-center gap-2 rounded-full border border-gf-line bg-gf-surface px-4 py-2 text-sm font-semibold shadow-xl hover:border-gf-accent">
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></svg>
        Chat with a session
      </button>
    )
  }

  return (
    <section aria-label="Chat with a session"
      className="fixed bottom-4 end-4 z-30 flex max-h-[min(34rem,80dvh)] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-xl border border-gf-line bg-gf-surface shadow-2xl">
      <header className="flex items-center gap-2 border-b border-gf-line p-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        <select
          value={current?.id ?? ''}
          onChange={e => setTarget(e.target.value)}
          aria-label="Session to message"
          className="min-w-0 flex-1 rounded-md border border-gf-line bg-gf-bar px-2 py-1 text-sm"
        >
          {!claude.length && <option value="">No Claude Code sessions in view</option>}
          {claude.map(a => <option key={a.id} value={a.id}>{a.name} · {a.taskTitle}</option>)}
        </select>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"
          className="rounded-md border border-gf-line px-2 py-0.5 text-sm hover:border-gf-accent">×</button>
      </header>
      <ol ref={listRef} className="min-h-24 flex-1 list-none space-y-2 overflow-y-auto p-3" aria-live="polite">
        {!lines.length && (
          <li className="text-xs text-gf-muted">
            {current
              ? <>Messages go to <span className="font-semibold text-gf-ink">{current.name}</span> through <span className="font-mono">claude -p --resume</span>, in its folder, with that session&apos;s context. Replies show here only; nothing is read back from the transcript.</>
              : 'Copilot CLI sessions cannot be messaged from here yet; pick a Claude Code session.'}
          </li>
        )}
        {lines.map((line, i) => (
          <li key={i} className={`max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-sm ${
            line.role === 'you' ? 'ms-auto bg-gf-accent-soft text-gf-ink' : line.role === 'error' ? 'border border-gf-danger/50 text-gf-danger' : 'bg-gf-raised'}`}>
            {line.text}
          </li>
        ))}
        {pending && pending === current?.id && <li className="text-xs text-gf-muted">Waiting for Claude…</li>}
      </ol>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-gf-line p-3">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, CHAT_MAX_CHARS))}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
          rows={2}
          maxLength={CHAT_MAX_CHARS}
          disabled={!current}
          placeholder={current ? `Message ${current.name}…` : 'No session selected'}
          aria-label="Message"
          className="min-h-10 flex-1 resize-none rounded-md border border-gf-line bg-gf-bar px-2 py-1.5 text-sm"
        />
        <button type="submit" disabled={!current || !draft.trim() || !!pending}
          className="rounded-md border border-gf-accent px-3 py-1.5 text-sm font-semibold text-gf-accent disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  )
}
