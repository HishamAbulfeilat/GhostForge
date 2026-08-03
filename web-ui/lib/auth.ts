import type { NextRequest } from 'next/server'

export const AUTH_COOKIE = 'gf_token'
export const AUTH_COOKIE_NAME = 'gf_token'

export function getAccessPin() {
  const pin = process.env.ACCESS_PIN
  if (!pin && process.env.NODE_ENV === 'production') {
    throw new Error('ACCESS_PIN not set. Set ACCESS_PIN in production to authenticate access.')
  }
  return pin || '1234'
}

export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET not set. Set AUTH_SECRET in production to authenticate access.')
  }
  return secret || 'ghostforge-secret'
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
