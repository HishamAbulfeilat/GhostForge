import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'

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

export function isAuthenticatedSession() {
  return isValidAuthToken(cookies().get(AUTH_COOKIE_NAME)?.value)
}
