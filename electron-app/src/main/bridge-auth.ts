import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const TOKEN_FILE = join(homedir(), '.ghostforge', 'bridge', 'token');

export type BridgeService = 'jarvis' | 'mark-l';

/** Resolve the token used by the local Mark-L bridge. */
export function resolveBridgeToken(
  env: NodeJS.ProcessEnv = process.env,
  readToken: () => string = () => readFileSync(TOKEN_FILE, 'utf8')
): string {
  const configured = env.MARKL_BRIDGE_TOKEN?.trim();
  if (configured) return configured;

  try {
    return readToken().trim();
  } catch {
    return '';
  }
}

/** Return the authenticated headers expected by protected Mark-L endpoints. */
export function getBridgeAuthHeaders(
  env: NodeJS.ProcessEnv = process.env,
  readToken?: () => string
): Record<string, string> {
  const token = resolveBridgeToken(env, readToken);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Select the health endpoint for a specific bridge contract. */
export function getHealthEndpoint(baseUrl: string, service: BridgeService): string {
  const path = service === 'mark-l' ? '/api/mark-l/health' : '/health';
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}
