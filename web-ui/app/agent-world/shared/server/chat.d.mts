// Types for chat.mjs (plain JS so the Node server can import it unbuilt).
export const CHAT_MAX_CHARS: number
export const CHAT_MAX_BODY_BYTES: number
export function resolveClaude(env?: Record<string, string | undefined>, platform?: string): { command: string; args: string[] } | null
export function validateChat(body: unknown, sessions: unknown[] | undefined):
  | { ok: true; session: { id: string; sessionId?: string; cwd: string; provider: string }; message: string }
  | { ok: false; status: number; error: string }
export function readJsonBody(stream: AsyncIterable<Uint8Array>, limit?: number): Promise<Record<string, unknown>>
export function sendChat(
  session: { id: string; sessionId?: string; cwd: string },
  message: string,
  options?: { timeoutMs?: number; spawnImpl?: unknown; env?: Record<string, string | undefined> },
): Promise<{ reply: string; isError: boolean; costUSD?: number }>
