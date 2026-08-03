import { NextRequest, NextResponse } from 'next/server'
import { isValidAuthToken } from '@/lib/auth'

const AUTH_COOKIE = 'gf_token'

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
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Skip public routes and API routes
  if (!PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value

  if (!isValidAuthToken(token)) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    // Preserve the original destination so login can redirect back
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
  ],
}
