/**
 * Open a URL with the operating system's default handler without building a
 * shell command. The URL is parsed, its scheme checked against an allowlist,
 * and only the normalised `href` is handed to Electron's `shell.openExternal`.
 *
 * Electron is required lazily so modules that import this one can still be
 * loaded by plain-Node tests.
 */

const HTTP_SCHEMES: readonly string[] = ['http:', 'https:'];

/** Parse `raw` and return its normalised href if its scheme is allowed. */
export function assertUrlScheme(raw: string, schemes: readonly string[] = HTTP_SCHEMES): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!schemes.includes(parsed.protocol)) {
    throw new Error(`Blocked URL with disallowed scheme: ${parsed.protocol}`);
  }
  return parsed.href;
}

/** Validate an http(s) URL and return its normalised href. */
export function assertHttpUrl(raw: string): string {
  return assertUrlScheme(raw, HTTP_SCHEMES);
}

/** Open `raw` in the default handler after checking its scheme. Returns the href opened. */
export async function openExternalUrl(raw: string, schemes: readonly string[] = HTTP_SCHEMES): Promise<string> {
  const href = assertUrlScheme(raw, schemes);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { shell } = require('electron') as typeof import('electron');
  await shell.openExternal(href);
  return href;
}
