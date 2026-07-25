import { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme } from 'electron';
import { join } from 'path';
import { ScreenCapture } from './screen-capture';
import { CursorOverlay } from './cursor-overlay';
import { VoiceSystem } from './voice';
import { SystemControl } from './system-control';
import { TrayManager } from './tray';
import { enableAutoStart, disableAutoStart, isAutoStartEnabled } from './auto-start';
import { searchAndPlay, getTranscript, getVideoInfo, getTrending, summarizeVideo } from './youtube';
import { listAllGames, scanSteamGames, scanEpicGames, checkForUpdates, updateGame } from './game-updater';
import { startClipboardWatcher, stopClipboardWatcher, analyzeClipboard, getClipboardHistory, smartPaste } from './clipboard-intel';
import { getSetupStatus, getSetupSteps, completeStep, isFirstRun } from './setup-wizard';
import { openUrl as browserOpen, searchWeb, navigateTab, clickElement, typeText, goBack, goForward, scrollPage, takeScreenshot as browserScreenshot, getPageText } from './browser-automation';
import { extractText, readAndSummarize, askQuestionAboutFile, convertFormat } from './file-processor';
import { getCpuStats, getRamStats, getDiskStats, getGpuStats, getFanSpeed, getFullSystemReport } from './hardware-monitor';
import { JarvisConnection } from './jarvis-connection';
import { ConnectionToggle } from './connection-toggle';
import type { ScreenCaptureOptions, CursorTarget, JarvisConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let screenCapture: ScreenCapture;
let cursorOverlay: CursorOverlay;
let voiceSystem: VoiceSystem;
let systemControl: SystemControl;
let config: JarvisConfig = { ...DEFAULT_CONFIG };
let jarvisConnection: JarvisConnection;
let connectionToggle: ConnectionToggle;

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
  jarvisConnection = new JarvisConnection(config);
  connectionToggle = new ConnectionToggle(jarvisConnection, config);
  trayManager = new TrayManager(mainWindow);

  // Register clipboard change events for renderer
  const { onClipboardChange } = require('./clipboard-intel');
  onClipboardChange((text: string) => {
    mainWindow?.webContents.send('clipboard:change', text);
  });

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

  // ── Auto-Start ────────────────────────────────────────────────────────────
  ipcMain.handle('auto-start:enable', () => enableAutoStart());
  ipcMain.handle('auto-start:disable', () => disableAutoStart());
  ipcMain.handle('auto-start:status', () => isAutoStartEnabled());

  // ── YouTube ───────────────────────────────────────────────────────────────
  ipcMain.handle('youtube:search', (_event, query: string) => searchAndPlay(query));
  ipcMain.handle('youtube:transcript', (_event, url: string) => getTranscript(url));
  ipcMain.handle('youtube:info', (_event, url: string) => getVideoInfo(url));
  ipcMain.handle('youtube:trending', (_event, region: string) => getTrending(region));
  ipcMain.handle('youtube:summarize', (_event, url: string) => summarizeVideo(url));

  // ── Game Updater ──────────────────────────────────────────────────────────
  ipcMain.handle('games:list', () => listAllGames());
  ipcMain.handle('games:scan-steam', () => scanSteamGames());
  ipcMain.handle('games:scan-epic', () => scanEpicGames());
  ipcMain.handle('games:check-update', (_event, name: string) => checkForUpdates(name));
  ipcMain.handle('games:update', (_event, name: string) => updateGame(name));

  // ── Clipboard Intelligence ────────────────────────────────────────────────
  ipcMain.handle('clipboard:start-watcher', (_event, interval: number) => {
    startClipboardWatcher(interval);
    return { success: true };
  });
  ipcMain.handle('clipboard:stop-watcher', () => {
    stopClipboardWatcher();
    return { success: true };
  });
  ipcMain.handle('clipboard:analyze', (_event, text: string, action?: string) =>
    analyzeClipboard(text, (action as any) || 'explain')
  );
  ipcMain.handle('clipboard:history', () => getClipboardHistory());
  ipcMain.handle('clipboard:smart-paste', (_event, action: string) =>
    smartPaste(action as any)
  );

  // ── Setup Wizard ──────────────────────────────────────────────────────────
  ipcMain.handle('setup:status', () => getSetupStatus());
  ipcMain.handle('setup:steps', () => getSetupSteps());
  ipcMain.handle('setup:complete-step', (_event, stepId: string, config: Record<string, unknown>) =>
    completeStep(stepId, config)
  );
  ipcMain.handle('setup:is-first-run', () => isFirstRun());

  // ── System Control (new methods) ──────────────────────────────────────────
  ipcMain.handle('system:set-brightness', (_event, level: number) =>
    systemControl.setBrightness(level)
  );
  ipcMain.handle('system:get-brightness', () => systemControl.getBrightness());
  ipcMain.handle('system:toggle-wifi', () => systemControl.toggleWifi());
  ipcMain.handle('system:wifi-status', () => systemControl.getWifiStatus());
  ipcMain.handle('system:toggle-bluetooth', () => systemControl.toggleBluetooth());
  ipcMain.handle('system:sleep', () => systemControl.sleepComputer());
  ipcMain.handle('system:restart', () => systemControl.restartComputer());
  ipcMain.handle('system:shutdown', () => systemControl.shutdownComputer());
  ipcMain.handle('system:battery', () => systemControl.getBatteryStatus());
  ipcMain.handle('system:screenshot', () => systemControl.takeScreenshot());

  // ── Browser Automation ────────────────────────────────────────────────────
  ipcMain.handle('browser:open', (_event, url: string) => browserOpen(url));
  ipcMain.handle('browser:search', (_event, query: string) => searchWeb(query));
  ipcMain.handle('browser:navigate', (_event, url: string) => navigateTab(url));
  ipcMain.handle('browser:click', (_event, selector: string) => clickElement(selector));
  ipcMain.handle('browser:type', (_event, text: string) => typeText(text));
  ipcMain.handle('browser:back', () => goBack());
  ipcMain.handle('browser:forward', () => goForward());
  ipcMain.handle('browser:scroll', (_event, dir: string) =>
    scrollPage(dir as 'up' | 'down' | 'left' | 'right')
  );
  ipcMain.handle('browser:screenshot', (_event, filePath?: string) =>
    browserScreenshot(filePath)
  );
  ipcMain.handle('browser:get-text', () => getPageText());

  // ── File Processor ────────────────────────────────────────────────────────
  ipcMain.handle('file:read', (_event, filePath: string) => extractText(filePath));
  ipcMain.handle('file:summarize', (_event, filePath: string) =>
    readAndSummarize(filePath)
  );
  ipcMain.handle('file:ask', (_event, filePath: string, question: string) =>
    askQuestionAboutFile(filePath, question)
  );
  ipcMain.handle('file:convert', (_event, inputPath: string, format: string) =>
    convertFormat(inputPath, format as 'txt' | 'md' | 'json' | 'csv' | 'html')
  );

  // ── Hardware Monitor ──────────────────────────────────────────────────────
  ipcMain.handle('hardware:cpu', () => getCpuStats());
  ipcMain.handle('hardware:ram', () => getRamStats());
  ipcMain.handle('hardware:disk', () => getDiskStats());
  ipcMain.handle('hardware:gpu', () => getGpuStats());
  ipcMain.handle('hardware:fan', () => getFanSpeed());
  ipcMain.handle('hardware:full-report', () => getFullSystemReport());

  // ── JARVIS Connection ─────────────────────────────────────────────────────
  ipcMain.handle('jarvis:connect', async (_event, serverUrl?: string) => {
    return jarvisConnection.connect(serverUrl);
  });

  ipcMain.handle('jarvis:connect-ws', async (_event, serverUrl?: string) => {
    return jarvisConnection.connectWebSocket(serverUrl);
  });

  ipcMain.handle('jarvis:disconnect', () => {
    jarvisConnection.disconnect();
    return { success: true };
  });

  ipcMain.handle('jarvis:discover-servers', async () => {
    return jarvisConnection.discoverServers();
  });

  ipcMain.handle('jarvis:get-state', () => {
    return jarvisConnection.getState();
  });

  ipcMain.handle('jarvis:send-command', async (_event, command: string, payload?: Record<string, unknown>) => {
    return jarvisConnection.sendCommand(command, payload);
  });

  ipcMain.handle('jarvis:send-ws-message', (_event, message: Record<string, unknown>) => {
    jarvisConnection.sendWsMessage(message);
    return { success: true };
  });

  ipcMain.handle('jarvis:is-connected', () => {
    return jarvisConnection.isConnected();
  });

  // ── Connection Toggle / OmniRoute ─────────────────────────────────────────
  ipcMain.handle('connection:get-mode', () => {
    return connectionToggle.getConnectionMode();
  });

  ipcMain.handle('connection:set-mode', async (_event, mode: 'server' | 'omniroute') => {
    return connectionToggle.setConnectionMode(mode);
  });

  ipcMain.handle('connection:get-status', async () => {
    return connectionToggle.getStatus();
  });

  ipcMain.handle('connection:get-server-status', async () => {
    return connectionToggle.getServerStatus();
  });

  ipcMain.handle('connection:get-servers', async () => {
    return connectionToggle.getAvailableServers();
  });

  ipcMain.handle('connection:process', async (_event, text: string) => {
    return connectionToggle.processWithMode(text);
  });

  // ── Connection Events (to renderer) ───────────────────────────────────────
  jarvisConnection.on('status', (state) => {
    mainWindow?.webContents.send('jarvis:status', state);
  });

  jarvisConnection.on('connected', (info) => {
    mainWindow?.webContents.send('jarvis:connected', info);
  });

  jarvisConnection.on('disconnected', () => {
    mainWindow?.webContents.send('jarvis:disconnected');
  });

  jarvisConnection.on('message', (msg) => {
    mainWindow?.webContents.send('jarvis:message', msg);
  });

  jarvisConnection.on('reconnecting', (info) => {
    mainWindow?.webContents.send('jarvis:reconnecting', info);
  });

  jarvisConnection.on('fallback', (info) => {
    mainWindow?.webContents.send('jarvis:fallback', info);
  });

  connectionToggle.on('mode:changed', (status) => {
    mainWindow?.webContents.send('connection:mode-changed', status);
  });

  connectionToggle.on('server:offline', (state) => {
    mainWindow?.webContents.send('connection:server-offline', state);
  });

  connectionToggle.on('fallback', (info) => {
    mainWindow?.webContents.send('connection:fallback', info);
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
app.whenReady().then(async () => {
  createMainWindow();
  if (jarvisConnection) {
    await jarvisConnection.connect();
  }
});

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
  jarvisConnection?.destroy();
  connectionToggle?.destroy();
  trayManager?.destroy();
});
