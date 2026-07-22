import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/Navbar'
import { ChunkErrorHandler } from '@/components/ChunkErrorHandler'

export const metadata: Metadata = {
  title: 'G.F.A.I. — GhostForge AI',
  description: 'Your personal JARVIS-style AI assistant. Operator-grade dev tools, forged in the shadows.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GFAI',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#06b6d4',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#030712' },
    { media: '(prefers-color-scheme: light)', color: '#06b6d4' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="auto" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <Providers>
          <ChunkErrorHandler />
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  )
}
