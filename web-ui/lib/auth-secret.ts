let devSecret: string | undefined

export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET
  // Hosted mode fails closed: no dev fallback, and no short secret
  if ((process.env.GHOSTFORGE_MODE || '').trim().toLowerCase() === 'hosted' && (!secret || secret.length < 32)) {
    throw new Error('AUTH_SECRET (at least 32 characters) is required in hosted mode')
  }
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET not set. Set AUTH_SECRET in production to authenticate access.')
    // Dev fallback: next.config.mjs normally sets AUTH_SECRET for `next dev`.
    // Otherwise generate one random secret per process (never a static
    // default) and reuse it, so tokens signed now still verify later.
    if (!devSecret) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      devSecret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      if (process.env.NODE_ENV !== 'test') console.warn('[auth] AUTH_SECRET not set — using ephemeral dev secret (sessions will not persist)')
    }
    return devSecret
  }
  return secret
}
