import { BrowserWindow, screen, ipcMain } from 'electron';
import { join } from 'path';
import type { CursorTarget } from '../shared/types';
import { CURSOR_OVERLAY } from '../shared/constants';

export class CursorOverlay {
  private windows: Map<number, BrowserWindow> = new Map();
  private targets: Map<number, CursorTarget> = new Map();

  createOverlay(screenId: number = 0): BrowserWindow {
    if (this.windows.has(screenId)) {
      this.windows.get(screenId)!.focus();
      return this.windows.get(screenId)!;
    }

    const display = screen.getAllDisplays()[screenId] || screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    const overlay = new BrowserWindow({
      x,
      y,
      width,
      height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setBackgroundColor('#00000000');
    overlay.loadFile(join(__dirname, '../renderer/cursor.html'));

    overlay.on('closed', () => {
      this.windows.delete(screenId);
      this.targets.delete(screenId);
    });

    this.windows.set(screenId, overlay);
    return overlay;
  }

  showCursor(screenId: number, target: CursorTarget): void {
    let overlay = this.windows.get(screenId);
    if (!overlay || overlay.isDestroyed()) {
      overlay = this.createOverlay(screenId);
    }

    this.targets.set(screenId, target);

    const display = screen.getAllDisplays()[screenId] || screen.getPrimaryDisplay();
    const { x: displayX, y: displayY } = display.bounds;

    // Convert absolute coordinates to display-relative
    const relativeTarget = {
      ...target,
      x: target.x - displayX,
      y: target.y - displayY,
    };

    overlay.webContents.send('cursor:point', relativeTarget);
  }

  highlightArea(
    screenId: number,
    x: number, y: number, w: number, h: number,
    label?: string
  ): void {
    let overlay = this.windows.get(screenId);
    if (!overlay || overlay.isDestroyed()) {
      overlay = this.createOverlay(screenId);
    }

    const display = screen.getAllDisplays()[screenId] || screen.getPrimaryDisplay();
    const { x: displayX, y: displayY } = display.bounds;

    overlay.webContents.send('cursor:highlight', {
      x: x - displayX,
      y: y - displayY,
      w,
      h,
      label,
    });
  }

  hideCursor(screenId: number): void {
    const overlay = this.windows.get(screenId);
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('cursor:hide');
    }
  }

  hideAll(): void {
    for (const [id] of this.windows) {
      this.hideCursor(id);
    }
  }

  destroyAll(): void {
    for (const [id, win] of this.windows) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
    this.windows.clear();
    this.targets.clear();
  }

  getScreenCount(): number {
    return screen.getAllDisplays().length;
  }

  getPrimaryScreenId(): number {
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays();
    return displays.findIndex(d => d.id === primary.id);
  }
}
