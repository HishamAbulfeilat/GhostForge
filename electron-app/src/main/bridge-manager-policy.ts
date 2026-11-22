/**
 * Pure decisions of the bridge manager, kept free of Electron so they can be
 * tested with node:test.
 */

/** Interface the bridge binds to on every platform (start.sh uses the same). */
export const BRIDGE_HOST = '127.0.0.1';

/** Fast health polling for this long, then slower polling. */
export const FAST_POLL_WINDOW_MS = 30_000;
export const FAST_POLL_INTERVAL_MS = 1_000;
export const SLOW_POLL_INTERVAL_MS = 5_000;

export function bridgeSpawnCommand(
  platform: string,
  bridgeDir: string,
  port: number,
  joinPath: (...parts: string[]) => string,
): { cmd: string; args: string[] } {
  if (platform === 'win32') {
    // Loopback only, as on macOS/Linux: the token-protected API must not be
    // reachable from the LAN.
    return { cmd: 'python', args: ['-m', 'uvicorn', 'server:app', '--host', BRIDGE_HOST, '--port', String(port)] };
  }
  // Run through bash so a lost exec bit in the packaged copy doesn't matter
  return { cmd: 'bash', args: [joinPath(bridgeDir, 'start.sh')] };
}

/**
 * Delay before the next health probe, or null to stop polling.
 *
 * Polling continues for as long as this spawn is still the current process and
 * the status is still "starting". A first start can take minutes (start.sh
 * builds a venv and installs requirements), so instead of giving up silently
 * after 30 s and leaving the status stuck at "starting", it slows down. The
 * process exiting (or a stop/restart) ends it.
 */
export function nextHealthPollDelay(
  elapsedMs: number,
  status: string,
  isCurrentProcess: boolean,
): number | null {
  if (!isCurrentProcess || status !== 'starting') return null;
  return elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
}
