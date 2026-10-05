import { NextRequest, NextResponse } from 'next/server'
import { isValidAuthToken, AUTH_COOKIE } from '@/lib/auth-edge'
import { isBlockedPage } from '@/lib/hosted'

const AUTH_COOKIE_NAME = AUTH_COOKIE

// Page routes that require authentication. Every top-level app/ section except
// the public '/' and '/login' must be listed here (and in config.matcher below);
// test/api-route-auth.test.js fails when a new section is left unprotected.
// /api/* is NOT covered here — each API route handler guards itself in-route.
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
  '/testing',
  '/code-health',
  '/tickets',
  '/api/tickets',
  '/api/code-health',
  '/agent-world',
  '/agents',
  '/api-docs',
  '/api-types',
  '/automation',
  '/design-resources',
  '/history',
  '/jobs',
  '/maintenance',
  '/media-tools',
  '/mock-api',
  '/models',
  '/notifications',
  '/open-source-tools',
  '/orchestrate',
  '/remote',
  '/setup',
  '/snippets',
  '/vigolium',
  '/projects',
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

  // Hosted mode: pages for host / owner-account features are off (their APIs return 403)
  if (isBlockedPage(pathname)) {
    const home = req.nextUrl.clone()
    home.pathname = '/jarvis'
    home.search = ''
    home.searchParams.set('unavailable', pathname)
    return NextResponse.redirect(home)
  }

  return NextResponse.next()
}

// Next.js requires a static literal here; keep it in sync with PROTECTED_PREFIXES.
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
    '/testing/:path*',
    '/code-health/:path*',
    '/tickets/:path*',
    '/api/tickets/:path*',
    '/api/code-health/:path*',
    '/agent-world/:path*',
    '/agents/:path*',
    '/api-docs/:path*',
    '/api-types/:path*',
    '/automation/:path*',
    '/design-resources/:path*',
    '/history/:path*',
    '/jobs/:path*',
    '/maintenance/:path*',
    '/media-tools/:path*',
    '/mock-api/:path*',
    '/models/:path*',
    '/notifications/:path*',
    '/open-source-tools/:path*',
    '/orchestrate/:path*',
    '/remote/:path*',
    '/setup/:path*',
    '/snippets/:path*',
    '/vigolium/:path*',
    '/projects/:path*',
  ],
}

export const _internal = { PROTECTED_PREFIXES }
