// Types for lib/cli-sessions.mjs (plain JS so it stays shareable).
export function buildSnapshot(options?: { maxSessions?: number }): Promise<Record<string, unknown>>
export function getSessionDetail(id: string): Record<string, unknown> | null
export const WATCH_ROOTS: { dir: string; recursive?: boolean }[]
