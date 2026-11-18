// One place for every TUI call to the GhostForge web UI.
//
// The web UI serves on port 3001: plain HTTP with `npm run dev`, HTTPS with
// `npm start` when mkcert is installed (port 3000 is then only an HTTP -> HTTPS
// redirect). GF_WEB_UI_URL overrides the default; for the HTTPS server set it
// to https://localhost:3001 and point NODE_EXTRA_CA_CERTS at the mkcert root
// CA (`$(mkcert -CAROOT)/rootCA.pem`) so Node trusts the certificate.
//
// Requests use fetch, so the scheme always follows the URL.

export const DEFAULT_WEB_UI_URL = 'http://localhost:3001';

/** Validated origin (scheme, host, port) of the web UI. */
export function webUiOrigin(env = process.env) {
  const raw = env.GF_WEB_UI_URL?.trim() || DEFAULT_WEB_UI_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('GF_WEB_UI_URL must be an absolute http(s) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('GF_WEB_UI_URL must contain only an http(s) scheme, host, and optional port.');
  }
  return url.origin;
}

/** Absolute URL of a web UI page or API route (pathname must start with "/"). */
export function webUiUrl(pathname, env = process.env) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
    throw new Error('Web UI path must start with a single "/".');
  }
  return new URL(pathname, webUiOrigin(env)).toString();
}

/**
 * The web UI gf_token session value. GF_WEB_UI_TOKEN is the TUI's name;
 * GF_SESSION_TOKEN (scripts/users.mjs, device-status.mjs) and GHOSTFORGE_TOKEN
 * (older TUI builds) are accepted so one exported value works everywhere.
 */
export function webUiSessionToken(env = process.env) {
  for (const name of ['GF_WEB_UI_TOKEN', 'GF_SESSION_TOKEN', 'GHOSTFORGE_TOKEN']) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (/[\r\n;]/.test(value)) throw new Error(`${name} contains invalid characters.`);
    return value;
  }
  return '';
}

/** Cookie header for the web UI session, or {} when no token is set. */
export function webUiAuthHeaders(env = process.env) {
  const token = webUiSessionToken(env);
  return token ? { Cookie: `gf_token=${encodeURIComponent(token)}` } : {};
}

export function webUiOfflineMessage(origin) {
  const hint = origin.startsWith('https:')
    ? ' For the HTTPS server, set NODE_EXTRA_CA_CERTS to the mkcert root CA so Node trusts its certificate.'
    : ' If the web UI runs with "npm start" (HTTPS), set GF_WEB_UI_URL=https://localhost:3001.';
  return `Web UI offline: cannot reach ${origin}. Start it with "cd web-ui && npm run dev" (or set GF_WEB_UI_URL).${hint}`;
}

/**
 * Call a web UI route. Resolves { ok, status, body } where body is parsed JSON
 * (or { text } when the reply is not JSON). Rejects with `offline: true` when
 * the server cannot be reached or times out. Redirects are not followed: a
 * redirect means GF_WEB_UI_URL points at the wrong port or scheme, and
 * following it cross-origin would drop the session cookie.
 */
export async function webUiRequest(pathname, {
  method = 'GET', body, timeoutMs = 8000, env = process.env, fetchImpl = fetch,
} = {}) {
  const origin = webUiOrigin(env);
  const headers = { Accept: 'application/json', ...webUiAuthHeaders(env) };
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let response;
  try {
    response = await fetchImpl(webUiUrl(pathname, env), init);
  } catch (error) {
    const offline = new Error(error?.name === 'TimeoutError'
      ? `The web UI request to ${origin} timed out.`
      : webUiOfflineMessage(origin));
    offline.offline = true;
    throw offline;
  }
  if (response.status >= 300 && response.status < 400) {
    let target = '';
    try { target = new URL(response.headers?.get?.('location') || '', origin).origin; } catch { /* ignore */ }
    const error = new Error(`The web UI at ${origin} redirected${target ? ` to ${target}` : ''}. ` +
      'Set GF_WEB_UI_URL to the address the web UI really serves on (e.g. https://localhost:3001).');
    error.offline = true;
    throw error;
  }
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text };
  }
  return { ok: response.ok, status: response.status, body: parsed && typeof parsed === 'object' ? parsed : { value: parsed } };
}

/** True when anything answers at the web UI origin (any HTTP status counts). */
export async function webUiReachable({ env = process.env, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  try {
    await fetchImpl(webUiUrl('/', env), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

// Collaboration sessions live on the bridge (:8765). Share links point at the
// web UI's real origin with ?session=<id>; any GhostForge terminal can also
// join with "Load a session by ID".
export function collabShareUrl(id, sharePath = `/jarvis?session=${encodeURIComponent(id)}`, env = process.env) {
  let origin;
  try {
    origin = webUiOrigin(env);
  } catch (error) {
    throw new Error(`${error.message} It is needed to build a share link.`);
  }
  const safePath = typeof sharePath === 'string' && /^\/jarvis\?session=[a-z0-9]{8,64}$/i.test(sharePath)
    ? sharePath
    : `/jarvis?session=${encodeURIComponent(id)}`;
  return new URL(safePath, origin).toString();
}
