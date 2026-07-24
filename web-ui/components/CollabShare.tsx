'use client'
import { useState } from 'react'

interface Props {
  onJoinSession?: (id: string, messages: Array<{ role: string; content: string; ts: number }>) => void
}

export default function CollabShare({ onJoinSession }: Props) {
  const [shareUrl, setShareUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const createSession = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/jarvis/collab')
      const data = (await response.json()) as { id: string; shareUrl: string; messages?: Array<{ role: string; content: string; ts: number }> }
      const fullUrl = `${window.location.origin}${data.shareUrl}`
      setShareUrl(fullUrl)
      onJoinSession?.(data.id, data.messages || [])
    } finally {
      setLoading(false)
    }
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2">
      {!shareUrl ? (
        <button onClick={createSession} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-60">
          {loading ? '⏳' : '🔗'} Share Session
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5">
          <span className="max-w-[200px] truncate text-xs text-zinc-400">{shareUrl}</span>
          <button onClick={copyUrl} className="text-xs text-blue-400 transition-colors hover:text-blue-300">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={() => setShareUrl('')} className="text-xs text-zinc-600 hover:text-zinc-400">✕</button>
        </div>
      )}
    </div>
  )
}
