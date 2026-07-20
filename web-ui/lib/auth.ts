import type { NextRequest } from 'next/server'

export const AUTH_COOKIE_NAME = 'gf_token'

export function getAccessPin() {
  return process.env.ACCESS_PIN || '1234'
}

export function getAuthSecret() {
  return process.env.AUTH_SECRET || 'ghostforge-secret'
}

export function isValidAuthToken(token?: string | null) {
  return Boolean(token) && token === getAuthSecret()
}

export function isAuthorizedRequest(req: NextRequest) {
  return isValidAuthToken(req.cookies.get(AUTH_COOKIE_NAME)?.value)
}

export async function isAuthenticatedSession() {
  const { cookies } = await import('next/headers')
  const store = await cookies()
  return isValidAuthToken(store.get(AUTH_COOKIE_NAME)?.value)
}
