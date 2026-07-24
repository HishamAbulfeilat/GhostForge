import { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme } from 'electron';
import { join } from 'path';
import { ScreenCapture } from './screen-capture';
import { CursorOverlay } from './cursor-overlay';
import { VoiceSystem } from './voice';
import { SystemControl } from './system-control';
import { TrayManager } from './tray';
import type { ScreenCaptureOptions, CursorTarget, JarvisConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let screenCapture: ScreenCapture;
let cursorOverlay: CursorOverlay;
let voiceSystem: VoiceSystem;
let systemControl: SystemControl;
let config: JarvisConfig = { ...DEFAULT_CONFIG };

const GOT_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();

if (!GOT_SINGLE_INSTANCE_LOCK) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'GhostForge JARVIS',
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0f' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  // Load the GhostForge web UI
  const webUIUrl = process.env.JARVIS_WEB_UI_URL || 'http://localhost:3000';
  mainWindow.loadURL(webUIUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (config.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Initialize systems
  screenCapture = new ScreenCapture();
  cursorOverlay = new CursorOverlay();
  voiceSystem = new VoiceSystem(mainWindow);
  systemControl = new SystemControl();
  trayManager = new TrayManager(mainWindow);

  // Register IPC handlers
  registerIPC();

  // Create tray
  trayManager.createTray();

  // Register global shortcuts
  registerGlobalShortcuts();
}

function registerIPC(): void {
  // Screen capture
  ipcMain.handle('screen:capture', async (_event, options: ScreenCaptureOptions) => {
    return screenCapture.capture(options);
  });

  ipcMain.handle('screen:captureRegion', async (
    _event, x: number, y: number, w: number, h: number, options?: ScreenCaptureOptions
  ) => {
    return screenCapture.captureRegion(x, y, w, h, options);
  });

  ipcMain.handle('screen:getDisplays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      size: d.size,
      label: d.label,
      primary: d.id === screen.getPrimaryDisplay().id,
    }));
  });

  // Cursor overlay
  ipcMain.handle('cursor:point', (_event, screenId: number, target: CursorTarget) => {
    cursorOverlay.showCursor(screenId, target);
    return { success: true };
  });

  ipcMain.handle('cursor:highlight', (
    _event, screenId: number, x: number, y: number, w: number, h: number, label?: string
  ) => {
    cursorOverlay.highlightArea(screenId, x, y, w, h, label);
    return { success: true };
  });

  ipcMain.handle('cursor:hide', (_event, screenId?: number) => {
    if (screenId !== undefined) {
      cursorOverlay.hideCursor(screenId);
    } else {
      cursorOverlay.hideAll();
    }
    return { success: true };
  });

  // Voice
  ipcMain.handle('voice:start', () => {
    voiceSystem.startListening();
    return { success: true };
  });

  ipcMain.handle('voice:stop', () => {
    voiceSystem.stopListening();
    return { success: true };
  });

  ipcMain.handle('voice:speak', async (_event, text: string, voice?: string) => {
    return voiceSystem.speak(text, voice);
  });

  ipcMain.handle('voice:setVolume', (_event, direction: 'up' | 'down' | 'mute') => {
    voiceSystem.setSystemVolume(direction);
    return { success: true };
  });

  // System control
  ipcMain.handle('system:openApp', async (_event, appName: string) => {
    return systemControl.openApp(appName);
  });

  ipcMain.handle('system:openUrl', async (_event, url: string) => {
    return systemControl.openUrl(url);
  });

  ipcMain.handle('system:lockScreen', async () => {
    return systemControl.lockScreen();
  });

  ipcMain.handle('system:getInfo', async () => {
    return systemControl.getSystemInfo();
  });

  ipcMain.handle('system:getVolume', async () => {
    return systemControl.getVolume();
  });

  ipcMain.handle('system:setVolume', async (_event, level: number) => {
    return systemControl.setVolume(level);
  });

  ipcMain.handle('system:processes', async () => {
    return systemControl.listRunningProcesses();
  });

  ipcMain.handle('system:killProcess', async (_event, name: string) => {
    return systemControl.killProcess(name);
  });

  // Config
  ipcMain.handle('config:get', () => config);

  ipcMain.handle('config:set', (_event, updates: Partial<JarvisConfig>) => {
    config = { ...config, ...updates };
    return config;
  });

  // Window control
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:hide', () => mainWindow?.hide());
  ipcMain.handle('window:show', () => mainWindow?.show());

  // Tray updates
  ipcMain.handle('tray:updateStatus', (_event, status: string, model?: string) => {
    trayManager?.updateContextMenu(status, model);
    return { success: true };
  });
}

function registerGlobalShortcuts(): void {
  // Push-to-talk: Ctrl+Alt+V (hold to talk, release to stop)
  globalShortcut.register('CommandOrControl+Alt+V', () => {
    mainWindow?.webContents.send('voice:push-to-talk:start');
  });

  // Quick screen capture: Ctrl+Alt+C
  globalShortcut.register('CommandOrControl+Alt+C', async () => {
    try {
      const result = await screenCapture.capture({ format: 'jpeg', quality: 70 });
      mainWindow?.webContents.send('screen:captured', result);
    } catch (error: any) {
      mainWindow?.webContents.send('screen:error', error.message);
    }
  });

  // Toggle visibility: Ctrl+Alt+J
  globalShortcut.register('CommandOrControl+Alt+J', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// App lifecycle
app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cursorOverlay.destroyAll();
  voiceSystem.unregisterAll();
  trayManager?.destroy();
});
