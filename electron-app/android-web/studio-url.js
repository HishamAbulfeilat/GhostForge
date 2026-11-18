'use strict';

/*
 * Studio server address rules, shared by the launcher page (studio.js) and
 * its tests. Keep in step with src/main/studio-connection.ts (desktop) and the
 * Capacitor allowNavigation list in capacitor.config.json (Android).
 *
 * - HTTPS works for any host.
 * - Plain HTTP is accepted only for loopback and private LAN addresses
 *   (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, *.local,
 *   ::1, fc00::/7, fe80::/10), where the server is on the user's own network.
 * - On Android, private IPv4 LAN hosts, localhost and *.local open inside the
 *   app (they are in allowNavigation); any other host opens in the system
 *   browser, because Capacitor only keeps allowNavigation hosts in the WebView.
 */
(function (root) {
  const SECTIONS = ['/dashboard', '/jobs', '/agents', '/marketplace', '/settings'];

  function ipv4Parts(host) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    const parts = host.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts : null;
  }

  function isPrivateIPv4(host) {
    const p = ipv4Parts(host);
    if (!p) return false;
    return p[0] === 127 || p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254);
  }

  /** Loopback or private-network host (URL.hostname form, IPv6 in brackets). */
  function isPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host === 'localhost' || /^[a-z0-9-]+\.local$/.test(host)) return true;
    if (isPrivateIPv4(host)) return true;
    const v6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : '';
    if (!v6) return false;
    return v6 === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6);
  }

  /** Hosts Capacitor keeps inside the Android WebView (mirrors allowNavigation). */
  function opensInAndroidApp(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host === 'localhost' || /^[a-z0-9-]+\.local$/.test(host)) return true;
    const p = ipv4Parts(host);
    if (!p) return false;
    return host === '127.0.0.1' || p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254);
  }

  /**
   * Validate a server address and studio section. Returns the origin, the URL
   * to open and whether Android keeps it in the app. Throws a user-facing
   * message for anything else.
   */
  function studioTarget(raw, section) {
    const path = section || '/dashboard';
    if (!SECTIONS.includes(path)) throw new Error('Unknown studio section.');
    let url;
    try {
      url = new URL(String(raw || '').trim());
    } catch {
      throw new Error('Enter a full server address, for example http://192.168.1.20:3001.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Enter an HTTP or HTTPS server address without credentials, paths, queries or fragments.');
    }
    if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
      throw new Error('Plain HTTP is only allowed for local network addresses. Use HTTPS for a remote server.');
    }
    return { origin: url.origin, target: `${url.origin}${path}`, inApp: opensInAndroidApp(url.hostname) };
  }

  const api = { SECTIONS, isPrivateHost, opensInAndroidApp, studioTarget };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GhostForgeStudioUrl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
