'use client'

import { NotificationProvider } from '@/components/NotificationCenter'
import { AccessProvider } from '@/components/AccessGuard'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <AccessProvider>{children}</AccessProvider>
    </NotificationProvider>
  )
}
