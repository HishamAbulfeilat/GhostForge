'use client'
import { useEffect } from 'react'

export function ChunkErrorHandler() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (
        event.message?.includes('ChunkLoadError') ||
        event.message?.includes('Loading chunk') ||
        event.message?.includes('Failed to fetch dynamically imported module')
      ) {
        console.warn('[GF] Chunk load error — clearing cache and reloading')
        // Clear Next.js router cache and hard reload
        if (typeof window !== 'undefined') {
          window.location.reload()
        }
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const msg = String(event.reason)
      if (
        msg.includes('ChunkLoadError') ||
        msg.includes('Loading chunk') ||
        msg.includes('Failed to fetch dynamically imported module')
      ) {
        console.warn('[GF] Chunk load rejection — clearing cache and reloading')
        event.preventDefault()
        window.location.reload()
      }
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null
}
