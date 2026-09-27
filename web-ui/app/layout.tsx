import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/Navbar'
import { ChunkErrorHandler } from '@/components/ChunkErrorHandler'
import CommandPalette from '@/components/CommandPalette'
import PWAInstallBanner from '@/components/PWAInstallBanner'

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

// Job Hunter / Setup design (Claude Design canvas): display + body faces
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' })
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex', display: 'swap' })

export const metadata: Metadata = {
  title: 'G.F.A.I. — GhostForge AI',
  description: 'Your personal JARVIS-style AI assistant. Operator-grade dev tools, forged in the shadows.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GFAI',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#18181b',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#18181b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (antivirus toolbars, etc.)
    // inject attributes like bis_skin_checked into <html>/<body> before React
    // hydrates, which previously aborted hydration and broke client-side
    // navigation (e.g. the dashboard's Settings button).
    <html lang="en" dir="auto" className={`dark ${mono.variable} ${display.variable} ${plex.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-gray-950 text-gray-100 antialiased" style={{ fontFamily: `var(--font-mono), ui-monospace, monospace` }} suppressHydrationWarning>
        <Providers>
          <ChunkErrorHandler />
          <Navbar />
          {children}
          <CommandPalette />
          <PWAInstallBanner />
        </Providers>
      </body>
    </html>
  )
}
