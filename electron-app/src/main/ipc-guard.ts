import { ipcMain } from 'electron';
import { isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { openExternalUrl } from './external-open';

/**
 * Trust boundary for the renderer: which pages may navigate the app windows
 * and which senders may call privileged IPC. Every `ipcMain` handler in the
 * main process is registered through `secureHandle` / `secureOn` (deny by
 * default), and every webContents gets `attachNavigationGuards`.
 */

export const STUDIO_LAUNCHER = resolve(__dirname, '../../android-web/studio.html');
export const LOCAL_INTERFACE = resolve(__dirname, '../../android-web/index.html');

let connectedStudioOrigin: string | null = null;

export function getConnectedStudioOrigin(): string | null {
  return connectedStudioOrigin;
}

export function setConnectedStudioOrigin(origin: string | null): void {
  connectedStudioOrigin = origin;
}

/** Origins the renderer is allowed to navigate to and send IPC from. */
export function getAppOrigins(): Set<string> {
  const origins = new Set<string>([
    'https://localhost:3001',
    'http://localhost:3001',
    'https://localhost:3000',
    'http://localhost:3000',
  ]);
  if (connectedStudioOrigin) origins.add(connectedStudioOrigin);
  const envUrl = process.env.JARVIS_WEB_UI_URL;
  if (envUrl) {
    try {
      origins.add(new URL(envUrl).origin);
    } catch { /* ignore invalid env URL */ }
  }
  return origins;
}

/** True when a renderer-initiated navigation or redirect to `raw` stays inside the app. */
export function isAllowedNavigationUrl(raw: string): boolean {
  try {
    const target = new URL(raw);
    if (target.protocol === 'file:') {
      return [STUDIO_LAUNCHER, LOCAL_INTERFACE].includes(resolve(fileURLToPath(target)));
    }
    return getAppOrigins().has(target.origin);
  } catch {
    return false;
  }
}

/** True when the IPC call originated from the app's own origin. */
export function isTrustedSender(event: { senderFrame: Electron.WebFrameMain | null }): boolean {
  try {
    const senderFrame = event.senderFrame;
    if (!senderFrame?.url) return false;
    const url = new URL(senderFrame.url);
    // file:, data:, about: and sandboxed frames all report origin "null", so
    // file: pages are trusted only when they are the app's own bundled files.
    if (url.protocol === 'file:') {
      const file = resolve(fileURLToPath(url));
      if (file === STUDIO_LAUNCHER || file === LOCAL_INTERFACE) return true;
      const rel = relative(resolve(__dirname, '..'), file);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    }
    return getAppOrigins().has(url.origin);
  } catch {
    return false;
  }
}

type InvokeHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown;
type EventListener = (event: Electron.IpcMainEvent, ...args: any[]) => void;

/** Guard wrapper for invoke handlers: rejects calls from untrusted senders. */
export function trusted(handler: InvokeHandler): InvokeHandler {
  return (event, ...args) => {
    if (!isTrustedSender(event)) {
      throw new Error('IPC rejected: untrusted sender origin');
    }
    return handler(event, ...args);
  };
}

/** `ipcMain.handle` that only runs for trusted senders. Use this for every handler. */
export function secureHandle(channel: string, handler: InvokeHandler): void {
  ipcMain.handle(channel, trusted(handler));
}

/** `ipcMain.on` that silently drops messages from untrusted senders. */
export function secureOn(channel: string, listener: EventListener): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] dropped '${channel}' from untrusted sender`);
      return;
    }
    listener(event, ...args);
  });
}

const guardedContents = new WeakSet<Electron.WebContents>();

/**
 * Keep a webContents on the app's own pages: block renderer navigations and
 * main-frame server redirects to other origins, and never create child
 * windows (they would inherit the preload). http(s) pop-up targets open in
 * the system browser instead.
 */
export function attachNavigationGuards(contents: Electron.WebContents): void {
  if (guardedContents.has(contents)) return;
  guardedContents.add(contents);

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      console.warn('[nav] blocked navigation to', url);
      event.preventDefault();
    }
  });

  contents.on('will-redirect', (event, url) => {
    if (event.isMainFrame && !isAllowedNavigationUrl(url)) {
      console.warn('[nav] blocked redirect to', url);
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch(() => { /* not http(s) or invalid: just deny */ });
    return { action: 'deny' };
  });
}
