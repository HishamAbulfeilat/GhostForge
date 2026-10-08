// Types for push.mjs (plain JS so the Node server can import it unbuilt).
export const STREAM_HEADERS: Record<string, string>
export function sseEvent(type: string, data: unknown): string
export type WatchRoot = { dir: string; recursive?: boolean }
export function watchRoots(roots: WatchRoot[], onChange: () => void, watchImpl?: unknown): () => void
export type SnapshotHub = {
  readonly size: number
  readonly full: boolean
  subscribe(send: (chunk: string) => void, close?: () => void): (() => void) | null
}
export function createSnapshotHub(options: {
  build: () => Promise<unknown>
  roots?: WatchRoot[]
  intervalMs?: number
  debounceMs?: number
  maxClients?: number
  maxStreamMs?: number
  watch?: (roots: WatchRoot[], onChange: () => void) => () => void
}): SnapshotHub
