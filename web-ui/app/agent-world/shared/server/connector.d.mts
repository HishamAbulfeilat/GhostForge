// Types for connector.mjs (plain JS so the Node server can import it unbuilt).
export const CONNECTOR_MAX_BYTES: number
export function connectorSnapshot(world: unknown, options?: { maxBytes?: number }): Record<string, unknown> & {
  heartbeat: string
  agents: Record<string, unknown>[]
  sessions: Record<string, unknown>[]
  events: Record<string, unknown>[]
}
