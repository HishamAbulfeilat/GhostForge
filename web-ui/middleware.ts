import { NextRequest, NextResponse } from 'next/server'
import { isValidAuthToken, AUTH_COOKIE } from '@/lib/auth-edge'

const AUTH_COOKIE_NAME = AUTH_COOKIE

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/chat',
  '/dashboard',
  '/terminal',
  '/files',
  '/features',
  '/marketplace',
  '/settings',
  '/mac-control',
  '/jarvis',
  '/users',
  '/workflows',
  '/security',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Exact-or-subpath match to avoid /chat → /chatbot false positive
  if (!PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value

  if (!await isValidAuthToken(token)) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/chat/:path*',
    '/dashboard/:path*',
    '/terminal/:path*',
    '/files/:path*',
    '/features/:path*',
    '/marketplace/:path*',
    '/settings/:path*',
    '/mac-control/:path*',
    '/jarvis/:path*',
    '/users/:path*',
    '/workflows/:path*',
    '/security/:path*',
  ],
}

export const _internal = { PROTECTED_PREFIXES }