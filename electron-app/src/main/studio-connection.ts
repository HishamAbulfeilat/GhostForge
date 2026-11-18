import { readFileSync, writeFileSync, existsSync } from 'fs';

const SECTIONS = new Set(['/dashboard', '/jobs', '/agents', '/marketplace', '/settings']);

/**
 * Loopback or private-network host, in URL.hostname form. Plain HTTP is only
 * accepted for these; keep in step with android-web/studio-url.js.
 */
export function isPrivateStudioHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || /^[a-z0-9-]+\.local$/.test(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const p = host.split('.').map(Number);
    if (p.some(part => part > 255)) return false;
    return p[0] === 127 || p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254);
  }
  const v6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : '';
  return v6 === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6);
}

export function studioTarget(raw: unknown, section: unknown = '/dashboard'): string {
  if (typeof raw !== 'string' || typeof section !== 'string' || !SECTIONS.has(section)) {
    throw new Error('A server URL and a supported studio section are required');
  }
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS server address without credentials, paths, queries or fragments');
  }
  if (url.protocol === 'http:' && !isPrivateStudioHost(url.hostname)) {
    throw new Error('Plain HTTP is only allowed for local network addresses; use HTTPS for a remote server');
  }
  return `${url.origin}${section}`;
}

export function readStudioUrl(file: string): string | null {
  if (!existsSync(file)) return null;
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof value !== 'string') throw new Error('Invalid saved studio URL');
  return new URL(studioTarget(value)).origin;
}

export function saveStudioUrl(file: string, url: string): void {
  writeFileSync(file, JSON.stringify(new URL(studioTarget(url)).origin), { encoding: 'utf8', mode: 0o600 });
}
