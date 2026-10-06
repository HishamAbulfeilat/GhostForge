'use client'

// Test-only page: the command palette inside the real access provider, so the
// palette sees the same signed-in user the navbar does.
import { AccessProvider } from '@/components/AccessGuard'
import CommandPalette from '@/components/CommandPalette'

export default function CommandPaletteFixture() {
  return (
    <AccessProvider>
      <CommandPalette />
    </AccessProvider>
  )
}
