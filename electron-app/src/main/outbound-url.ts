const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
};

/**
 * Validate a URL before sending credentials to it. Explicit non-default ports
 * are rejected so an allowed hostname cannot redirect secrets to another service.
 */
export function validateOutboundUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
  label: string,
  protocols: readonly string[] = ['https:'],
  allowedPorts: readonly string[] = [],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }

  if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} URL must use an allowed scheme without credentials`);
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`${label} URL host is not allowed`);
  }
  const defaultPort = DEFAULT_PORTS[parsed.protocol];
  if (parsed.port && parsed.port !== defaultPort && !allowedPorts.includes(parsed.port)) {
    throw new Error(`${label} URL must use the default port`);
  }
  return parsed;
}
