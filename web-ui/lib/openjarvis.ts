/**
 * Client for the OpenJarvis endpoints on the bridge (mark-l-bridge/server.py,
 * 127.0.0.1:8765) — local-first personal AI agent primitives (Apache-2.0,
 * https://github.com/open-jarvis/OpenJarvis). It ships as the `jarvis` CLI
 * rather than a pip-importable package, so the bridge shells out to it; this
 * client mirrors `mark-liv-bridge.ts` and reuses the same bridge process.
 */
import { ensureMarkLivBridge } from './mark-liv-bridge'
import { getMarkLBridgeToken } from './bridge-token'

const BRIDGE_URL = (process.env.MARKL_BRIDGE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '')

export interface OpenJarvisHealth {
  installed: boolean
  binary: string | null
}

function token(): string {
  return getMarkLBridgeToken()
}

async function bridgeFetch(pathname: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  return fetch(`${BRIDGE_URL}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** Whether the `jarvis` CLI is installed on the bridge host. */
export async function openjarvisHealth(): Promise<OpenJarvisHealth> {
  if (!(await ensureMarkLivBridge())) return { installed: false, binary: null }
  try {
    const res = await bridgeFetch('/api/openjarvis/health', {}, 5_000)
    if (!res.ok) return { installed: false, binary: null }
    const body = await res.json() as { data?: OpenJarvisHealth }
    return body.data ?? { installed: false, binary: null }
  } catch {
    return { installed: false, binary: null }
  }
}

/** A failed OpenJarvis call, with the HTTP status the API route should return. */
export class OpenJarvisError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'OpenJarvisError'
  }
}

/**
 * Ask OpenJarvis a question via `jarvis ask "<prompt>"` and return its reply.
 * Throws OpenJarvisError when the bridge is down, OpenJarvis is not installed
 * or the ask fails, so callers never show a failure as if it were the answer.
 */
export async function openjarvisAsk(prompt: string, timeoutS = 60): Promise<string> {
  if (!(await ensureMarkLivBridge())) {
    throw new OpenJarvisError('Bridge is not running and could not be started.', 503)
  }
  let res: Response
  try {
    res = await bridgeFetch(
      '/api/openjarvis/ask',
      { method: 'POST', body: JSON.stringify({ prompt, timeout_s: timeoutS }) },
      (timeoutS + 10) * 1000
    )
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new OpenJarvisError(`OpenJarvis did not answer within ${timeoutS}s.`, 504)
    }
    throw new OpenJarvisError('Bridge unreachable.', 502)
  }
  if (res.status === 503) {
    throw new OpenJarvisError('OpenJarvis is not installed. See marketplace → "OpenJarvis" for the installer.', 503)
  }
  if (!res.ok) throw new OpenJarvisError(`OpenJarvis ask failed (${res.status}).`, 502)
  const body = await res.json().catch(() => null) as { data?: { response?: string } } | null
  if (!body || typeof body !== 'object') throw new OpenJarvisError('OpenJarvis returned an invalid reply.', 502)
  return body.data?.response ?? ''
}

/** Run `jarvis doctor` on the bridge host and return its raw output. */
export async function openjarvisDoctor(): Promise<string> {
  if (!(await ensureMarkLivBridge())) return 'Bridge is not running and could not be started.'
  const res = await bridgeFetch('/api/openjarvis/doctor', {}, 40_000)
  if (res.status === 503) return 'OpenJarvis is not installed.'
  if (!res.ok) return `openjarvis doctor failed (${res.status}).`
  const body = await res.json() as { data?: string }
  return body.data ?? ''
}
