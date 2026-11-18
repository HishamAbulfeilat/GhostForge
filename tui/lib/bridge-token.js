import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The bridge token, resolved the same way as the bridge, voice pipeline and
// web UI: the MARKL_BRIDGE_TOKEN environment variable first, then the token
// file the bridge writes at ~/.ghostforge/bridge/token.

export function bridgeTokenPath(home = homedir()) {
  return join(home, '.ghostforge', 'bridge', 'token');
}

export function resolveBridgeToken(env = process.env, { home = homedir(), readFile = readFileSync } = {}) {
  let token = env.MARKL_BRIDGE_TOKEN?.trim();
  if (!token) {
    const tokenPath = bridgeTokenPath(home);
    try {
      token = String(readFile(tokenPath, 'utf8')).trim();
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Bridge token not found. Set MARKL_BRIDGE_TOKEN or create ${tokenPath}.`);
      }
      throw new Error(`Could not read bridge token at ${tokenPath}: ${error.message}`);
    }
  }
  if (!token) throw new Error('Bridge token is empty. Set MARKL_BRIDGE_TOKEN or check the bridge token file.');
  if (/[\r\n]/.test(token)) throw new Error('Bridge token contains invalid characters.');
  return token;
}
