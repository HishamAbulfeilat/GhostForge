import { readFileSync, writeFileSync, existsSync } from 'fs';

const SECTIONS = new Set(['/dashboard', '/jobs', '/agents', '/marketplace', '/settings']);

export function studioTarget(raw: unknown, section: unknown = '/dashboard'): string {
  if (typeof raw !== 'string' || typeof section !== 'string' || !SECTIONS.has(section)) {
    throw new Error('A server URL and a supported studio section are required');
  }
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS server address without credentials, paths, queries or fragments');
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
