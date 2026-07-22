'use client'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Auto-recover from chunk load errors
    if (
      error?.message?.includes('ChunkLoadError') ||
      error?.message?.includes('Loading chunk') ||
      error?.name === 'ChunkLoadError'
    ) {
      window.location.reload()
    }
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-gray-100 gap-4">
      <div className="text-4xl">👻</div>
      <h2 className="text-xl font-bold text-cyan-400">GhostForge encountered an error</h2>
      <p className="text-gray-400 text-sm max-w-md text-center">{error?.message || 'Unknown error'}</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-medium transition"
      >
        Try Again
      </button>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition"
      >
        Hard Reload
      </button>
    </div>
  )
}
