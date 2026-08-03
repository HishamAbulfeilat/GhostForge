'use client'
import { useEffect, useState } from 'react'

const RELOAD_KEY = 'gf_chunk_reload_count'
const MAX_RELOADS = 3

function isChunkError(message: string) {
  return (
    message.includes('ChunkLoadError') ||
    message.includes('Loading chunk') ||
    message.includes('Failed to fetch dynamically imported module')
  )
}

function bumpReloadCount(): number {
  let count = 0
  try {
    count = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0
  } catch { /* storage unavailable */ }
  count += 1
  try {
    sessionStorage.setItem(RELOAD_KEY, String(count))
  } catch { /* ignore */ }
  return count
}

export function ChunkErrorHandler() {
  const [exhausted, setExhausted] = useState(false)

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (isChunkError(event.message ?? '')) {
        console.warn('[GF] Chunk load error — reloading')
        event.preventDefault()
        handleChunkReload()
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isChunkError(String(event.reason))) {
        console.warn('[GF] Chunk load rejection — reloading')
        event.preventDefault()
        handleChunkReload()
      }
    }

    const handleChunkReload = () => {
      const count = bumpReloadCount()
      if (count > MAX_RELOADS) {
        // Give up auto-reloading — show a manual fallback instead so we
        // don't loop forever.
        console.warn('[GF] Chunk load kept failing — showing fallback screen')
        setExhausted(true)
        return
      }
      window.location.reload()
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  if (!exhausted) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-950">
      <div className="mx-4 max-w-sm rounded-2xl border border-white/10 bg-gray-900/95 p-8 text-center shadow-2xl">
        <div className="mb-4 text-4xl">👻</div>
        <h1 className="text-lg font-semibold text-white">Something broke loading the app</h1>
        <p className="mt-2 text-sm text-gray-400">
          The app assets failed to load several times. Reload manually — if the problem
          persists, clear the browser cache or do a hard refresh.
        </p>
        <button
          type="button"
          onClick={() => {
            try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* ignore */ }
            window.location.reload()
          }}
          className="mt-6 w-full rounded-xl bg-sky-600 py-3 text-sm font-medium text-white transition-colors hover:bg-sky-500"
        >
          Reload app
        </button>
      </div>
    </div>
  )
}
