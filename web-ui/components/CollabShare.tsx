'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  onJoinSession?: (id: string, messages: Array<{ role: string; content: string; ts: number }>) => void
}

export default function CollabShare({ onJoinSession }: Props) {
  const [shareUrl, setShareUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const createSession = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/jarvis/collab')
      if (!response.ok) {
        throw new Error(`Failed to create session (${response.status})`)
      }
      const data = (await response.json()) as { id: string; shareUrl: string; messages?: Array<{ role: string; content: string; ts: number }> }
      const fullUrl = `${window.location.origin}${data.shareUrl}`
      setShareUrl(fullUrl)
      onJoinSession?.(data.id, data.messages || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  // Clear the "Copied" reset timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  return (
    <div className="flex flex-col items-end gap-1">
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
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
