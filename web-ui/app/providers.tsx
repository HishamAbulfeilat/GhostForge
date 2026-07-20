'use client'

import { CommandPalette } from '@/components/CommandPalette'
import { NotificationProvider } from '@/components/NotificationCenter'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      {children}
      <CommandPalette />
    </NotificationProvider>
  )
}
