import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono } from 'next/font/google'
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
    <html lang="en" dir="auto" className={`dark ${mono.variable}`}>
      <body className="min-h-dvh bg-gray-950 text-gray-100 antialiased" style={{ fontFamily: `var(--font-mono), ui-monospace, monospace` }}>
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
