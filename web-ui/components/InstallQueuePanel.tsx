'use client'

import { useState } from 'react'

/**
 * The web side of the consented installer queue (marketplace/install-queue.mjs).
 *
 * Each queued tool shows the exact command and its source. Installing needs a
 * per-item approval (there is deliberately no "install all"); dual-use tools
 * also need the authorized-use box ticked. The server re-checks all of this.
 */

export interface QueueEntry {
  id: string
  name: string
  command: string
  source: string
  url: string | null
  authorizedUseOnly: boolean
  stale: boolean
  reason: string
  lastError?: string
}

interface Props {
  queue: QueueEntry[]
  busyId: string | null
  onInstall: (entry: QueueEntry, authorized: boolean) => void
  onRemove: (id: string) => void
  lastOutput: { id: string; ok: boolean; output: string } | null
}

export default function InstallQueuePanel({ queue, busyId, onInstall, onRemove, lastOutput }: Props) {
  const [authorized, setAuthorized] = useState<Record<string, boolean>>({})

  if (queue.length === 0 && !lastOutput) return null

  return (
    <section className="mx-4 mb-3 rounded-lg border border-amber-800/40 bg-amber-950/10 p-3" aria-label="Install queue" data-testid="install-queue">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-200">⬇️ Install queue ({queue.length})</p>
        <p className="text-[10px] text-gray-500">Review each command. Nothing runs until you approve that item.</p>
      </div>
      <ul className="space-y-2">
        {queue.map(entry => {
          const busy = busyId === entry.id
          const needsAuth = entry.authorizedUseOnly && !authorized[entry.id]
          return (
            <li key={entry.id} className="rounded border border-white/[0.06] bg-[#080d18] p-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-gray-100">{entry.name}</span>
                <span className="text-[10px] text-gray-500">
                  source:{' '}
                  {entry.url ? (
                    <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{entry.source}</a>
                  ) : entry.source}
                </span>
              </div>
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-emerald-300">{entry.command}</pre>
              {entry.stale && <p className="mt-1 text-amber-300">{entry.reason}</p>}
              {entry.lastError && <p className="mt-1 text-red-300">Last attempt failed: {entry.lastError.slice(-200)}</p>}
              {entry.authorizedUseOnly && !entry.stale && (
                <label className="mt-1.5 flex items-start gap-2 text-[11px] text-amber-200">
                  <input type="checkbox" checked={Boolean(authorized[entry.id])}
                    onChange={e => setAuthorized(prev => ({ ...prev, [entry.id]: e.target.checked }))} className="mt-0.5" />
                  I will only use this tool on systems I own or have written permission to test.
                </label>
              )}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => onRemove(entry.id)} disabled={busy}
                  className="rounded border border-white/[0.08] px-2.5 py-1 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Remove
                </button>
                <button type="button" onClick={() => onInstall(entry, Boolean(authorized[entry.id]))}
                  disabled={busy || entry.stale || needsAuth}
                  className="rounded border border-emerald-700/50 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40">
                  {busy ? 'Installing…' : 'Approve & run this command'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {lastOutput && (
        <details className="mt-2 text-[11px]" open={!lastOutput.ok}>
          <summary className={lastOutput.ok ? 'text-emerald-300' : 'text-red-300'}>
            {lastOutput.ok ? `✓ ${lastOutput.id} installed` : `✗ ${lastOutput.id} failed`} — output
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-gray-400">{lastOutput.output || '(no output)'}</pre>
        </details>
      )}
    </section>
  )
}
