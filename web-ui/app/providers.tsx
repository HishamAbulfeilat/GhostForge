'use client'

import { NotificationProvider } from '@/components/NotificationCenter'

export function Providers({ children }: { children: React.ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>
}
