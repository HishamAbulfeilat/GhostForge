import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join } from 'path';
import { requestExplicitAppQuit } from './app-lifecycle';

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  createTray(): void {
    // Create a simple 16x16 icon using nativeImage
    const icon = this.createTrayIcon();
    this.tray = new Tray(icon);

    this.tray.setToolTip('GhostForge JARVIS');
    this.tray.on('click', () => {
      if (this.mainWindow?.isVisible()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow?.show();
        this.mainWindow?.focus();
      }
    });

    this.updateContextMenu();
  }

  updateContextMenu(status: string = 'idle', model: string = 'Ollama'): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Status: ${status}`,
        enabled: false,
      },
      {
        label: `Model: ${model}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show JARVIS',
        click: () => {
          this.mainWindow?.show();
          this.mainWindow?.focus();
        },
      },
      {
        label: 'Push-to-Talk (Ctrl+Alt+V)',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          this.mainWindow?.show();
          this.mainWindow?.webContents.send('navigate', '/settings');
        },
      },
      {
        label: 'Voice Command',
        click: () => {
          this.mainWindow?.show();
          this.mainWindow?.webContents.send('voice:activate');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          if (requestExplicitAppQuit()) {
            app.quit();
          }
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  private createTrayIcon(): Electron.NativeImage {
    // Create a simple blue circle icon for the tray
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < size / 2 - 1) {
          // Blue circle
          canvas[idx] = 59;     // R
          canvas[idx + 1] = 130; // G
          canvas[idx + 2] = 246; // B
          canvas[idx + 3] = 255; // A
        } else if (dist < size / 2) {
          // Border
          canvas[idx] = 30;
          canvas[idx + 1] = 64;
          canvas[idx + 2] = 175;
          canvas[idx + 3] = 255;
        } else {
          // Transparent
          canvas[idx] = 0;
          canvas[idx + 1] = 0;
          canvas[idx + 2] = 0;
          canvas[idx + 3] = 0;
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size,
    });
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
