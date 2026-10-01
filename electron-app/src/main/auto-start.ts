import { app } from 'electron';
import { exec } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_KEY = 'autoStart';

/** electron-store instance — lazy-loaded to avoid circular imports */
let store: any = null;

function getStore(): any {
  if (!store) {
    // Dynamic require to avoid circular dependency at module load time
    const Store = require('electron-store');
    store = new Store({ name: 'ghostforge-settings' });
  }
  return store;
}

/** App metadata used for the Linux .desktop file */
const APP_META = {
  name: 'GhostForge JARVIS',
  exec: process.argv[0],
  args: process.argv.slice(1).join(' '),
  icon: 'ghostforge-jarvis',
  comment: 'GhostForge JARVIS AI Desktop Assistant',
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Enable auto-start on login.
 * - macOS / Windows: uses Electron's built-in `app.setLoginItemSettings()`.
 * - Linux: writes a `.desktop` file into `~/.config/autostart/`.
 */
export async function enableAutoStart(): Promise<void> {
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      openAsHidden: true,
    } as any);
  } else if (platform === 'linux') {
    ensureLinuxAutostartDir();
    const desktopPath = getLinuxDesktopFilePath();
    const content = [
      '[Desktop Entry]',
      `Name=${APP_META.name}`,
      `Exec=${APP_META.exec} ${APP_META.args}`.trim(),
      `Icon=${APP_META.icon}`,
      'Type=Application',
      'X-GNOME-Autostart-enabled=true',
      `Comment=${APP_META.comment}`,
      'Terminal=false',
      'StartupNotify=false',
    ].join('\n');

    writeFileSync(desktopPath, content, 'utf-8');
  } else {
    throw new Error(`Unsupported platform for auto-start: ${platform}`);
  }

  getStore().set(STORE_KEY, true);
}

/**
 * Disable auto-start on login.
 * Removes the login item (macOS/Windows) or deletes the `.desktop` file (Linux).
 */
export async function disableAutoStart(): Promise<void> {
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: false,
    });
  } else if (platform === 'linux') {
    const desktopPath = getLinuxDesktopFilePath();
    if (existsSync(desktopPath)) {
      unlinkSync(desktopPath);
    }
  }

  getStore().set(STORE_KEY, false);
}

/**
 * Check whether auto-start is currently enabled.
 * Verifies both the stored preference and the OS-level setting.
 */
export async function isAutoStartEnabled(): Promise<boolean> {
  const stored = getStore().get(STORE_KEY, false) as boolean;
  if (!stored) return false;

  const platform = process.platform;

  if (platform === 'darwin' || platform === 'win32') {
    try {
      const settings = app.getLoginItemSettings();
      return settings.openAtLogin;
    } catch {
      return false;
    }
  }

  if (platform === 'linux') {
    return existsSync(getLinuxDesktopFilePath());
  }

  return false;
}

// ── Linux Helpers ───────────────────────────────────────────────────────────

function ensureLinuxAutostartDir(): void {
  const dir = join(homedir(), '.config', 'autostart');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getLinuxDesktopFilePath(): string {
  return join(homedir(), '.config', 'autostart', 'ghostforge-jarvis.desktop');
}
