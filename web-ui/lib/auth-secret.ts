export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET not set. Set AUTH_SECRET in production to authenticate access.')
    // dev fallback: generate ephemeral secret and warn — never use static default
    const devSecret = `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`
    if (process.env.NODE_ENV !== 'test') console.warn('[auth] AUTH_SECRET not set — using ephemeral dev secret (sessions will not persist)')
    return devSecret
  }
  return secret
}