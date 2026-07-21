'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/chat',        icon: '💬', label: 'Chat' },
  { href: '/terminal',    icon: '🖥️', label: 'Terminal' },
  { href: '/dashboard',   icon: '📊', label: 'Dashboard' },
  { href: '/files',       icon: '🗂️', label: 'Files' },
  { href: '/features',    icon: '⚡', label: 'Features' },
  { href: '/marketplace', icon: '🏪', label: 'Market' },
  { href: '/settings',    icon: '⚙️', label: 'Settings' },
]

// Pages that use their own full-screen layout — hide global nav
const FULLSCREEN_ROUTES = ['/terminal', '/login', '/chat', '/jarvis']

export function Navbar() {
  const pathname = usePathname()
  if (FULLSCREEN_ROUTES.some(r => pathname.startsWith(r))) return null

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-gray-950/90 px-4 py-2 backdrop-blur-md">
      {/* Brand */}
      <Link href="/chat" className="flex items-center gap-2 shrink-0 group">
        <span className="text-lg group-hover:scale-110 transition-transform">👻</span>
        <span className="hidden sm:block text-xs font-bold uppercase tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">
          GhostForge
        </span>
      </Link>

      {/* Nav links */}
      <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
        {NAV_ITEMS.map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                active
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-white/40 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              <span className="text-sm leading-none">{item.icon}</span>
              <span className="hidden sm:block">{item.label}</span>
            </Link>
          )
        })}
      </div>

      {/* ⌘K hint */}
      <div className="hidden md:flex items-center gap-1 shrink-0">
        <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/30">⌘K</kbd>
      </div>
    </nav>
  )
}
