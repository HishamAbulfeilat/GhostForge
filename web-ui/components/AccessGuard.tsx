'use client'

/**
 * Client-side page access.
 *
 * Loads the signed-in user once, then:
 *   - sends users who haven't finished the job-title setup to /setup
 *   - redirects away from pages their title doesn't grant
 * The navbar reads the same context to hide links. This is a UX layer only —
 * the APIs behind each page enforce the same permissions server-side.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { allowedPages, canAccessPage, type AccessSubject } from '@/lib/title-profiles'

interface AccessUser extends AccessSubject {
  name: string
  username: string
  setupComplete: boolean
}

const AccessContext = createContext<{ user: AccessUser | null; loaded: boolean }>({ user: null, loaded: false })

export const useAccess = () => useContext(AccessContext)

// Reachable before setup / without a session
const OPEN_PATHS = ['/', '/login', '/setup']

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<AccessUser | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Re-check after leaving the login or setup pages
  const authPhase = pathname === '/login' || pathname === '/setup'

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        setUser(data?.user ? { ...data.user, setupComplete: Boolean(data.user.setupComplete) } : null)
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [authPhase])

  const open = OPEN_PATHS.includes(pathname)
  const needsSetup = Boolean(user && !user.setupComplete && !open)
  const agentOperationsPath = pathname === '/agents' || pathname === '/agent-world'
  const denied = Boolean(user && !open && !agentOperationsPath && !canAccessPage(user, pathname))

  useEffect(() => {
    if (!loaded || !user) return
    if (needsSetup) router.replace('/setup')
    else if (denied) router.replace(allowedPages(user).find(p => p.path !== '/setup')?.path || '/jarvis')
  }, [loaded, user, needsSetup, denied, router])

  const accessValue = useMemo(() => ({ user, loaded }), [user, loaded])

  return (
    <AccessContext.Provider value={accessValue}>
      {needsSetup || denied ? (
        <div className="grid min-h-dvh place-items-center bg-gf-bg font-plex text-sm text-gf-muted" role="status">
          {needsSetup ? 'Taking you to setup…' : 'You don’t have access to this page.'}
        </div>
      ) : children}
    </AccessContext.Provider>
  )
}
