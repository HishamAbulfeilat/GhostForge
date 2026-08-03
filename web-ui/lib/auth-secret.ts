export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET not set. Set AUTH_SECRET in production to authenticate access.')
  }
  return secret || 'ghostforge-secret'
}