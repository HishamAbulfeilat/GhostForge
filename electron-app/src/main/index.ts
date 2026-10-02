import { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme, shell } from 'electron';
import { isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
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
import { GeminiLiveVoice } from './gemini-live';
import { N8nIntegration } from './n8n-integration';
import bridgeManager from './bridge-manager';
import { registerAutonomousAgentIPC } from './autonomous-agent';
import { getDaemon, JarvisDaemon } from './jarvis-daemon';
import { SelfUpdater } from './self-updater';
import { CodeModifier } from './code-modifier';
import { VoiceboxIntegration } from './voicebox-integration';
import {
  listEmails as emailList, readEmail, sendEmail as emailSend, replyToEmail,
  markAsRead, markAsUnread, starEmail, unstarEmail, deleteEmail,
  getUnreadCount, getRecentEmails, searchEmails, getAccounts as getEmailAccounts,
  removeAccount as removeEmailAccount, addImapAccount,
  startGmailOAuth, handleOAuthCallback,
} from './email-integration';
import {
  getHeadlessSwitches,
  HEADLESS_BRIDGE_LOG,
  HEADLESS_STARTUP_LOG,
  HEADLESS_WINDOW_LOG,
  isHeadlessSmokeMode,
  logHeadlessSmoke,
  reportShutdownOutcome,
  runBoundedCleanup,
  shouldMinimizeWindowToTray,
} from './headless-smoke';
import {
  setApiKey as setAIStudioKey, getApiKeyStatus as getAIStudioKeyStatus,
  listTunedModels, getTunedModel, generateContent, updateTunedModel,
  listModels, getModelInfo, compareModels, testPrompt as aiStudioTest,
  exportModelConfig, importModelConfig,
} from './google-ai-studio';
import {
  listTodayEvents, listUpcomingEvents, createEvent, updateEvent, deleteEvent,
  checkAvailability, getFreeSlots, getCalendarAccounts, removeCalendarAccount,
  startGoogleCalendarOAuth, handleCalendarOAuthCallback, addCaldavAccount,
} from './calendar-integration';
import {
  searchContacts, getContact, createContact, deleteContact,
  getContactsByPhone, getRecentContacts, getContactAccounts, removeContactAccount,
  startGoogleContactsOAuth, handleContactsOAuthCallback,
} from './contacts-integration';
import type { ScreenCaptureOptions, CursorTarget, JarvisConfig, EmailSearchParams, EmailSendParams, CreateEventParams } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/constants';
import { readFileSync } from 'fs';
import { join as pathJoin } from 'path';

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let screenCapture: ScreenCapture;
let cursorOverlay: CursorOverlay;
let voiceSystem: VoiceSystem;
let systemControl: SystemControl;
let config: JarvisConfig = { ...DEFAULT_CONFIG };
let jarvisConnection: JarvisConnection;
let connectionToggle: ConnectionToggle;
let geminiLiveVoice: GeminiLiveVoice;
let n8nIntegration: N8nIntegration;
let jarvisDaemon: JarvisDaemon;
let selfUpdater: SelfUpdater;
let codeModifier: CodeModifier;
let voiceboxIntegration: VoiceboxIntegration;
let isQuitting = false;
let isExplicitWindowClose = false;
let cleanupComplete = false;
let cleanupPromise: Promise<void> | null = null;

const SHUTDOWN_TIMEOUT_MS = 10_000;

app.on('before-quit', (event) => {
  isQuitting = true;
  if (cleanupComplete) return;

  event.preventDefault();
  if (cleanupPromise) return;

  cleanupPromise = runBoundedCleanup([
    { name: 'daemon', run: () => jarvisDaemon?.destroy() },
    { name: 'updater', run: () => selfUpdater?.destroy() },
    { name: 'code modifier', run: () => codeModifier?.destroy() },
    { name: 'voicebox', run: () => voiceboxIntegration?.destroy() },
    { name: 'bridge', run: () => bridgeManager.stopBridge() },
    { name: 'Gemini voice', run: async () => { await geminiLiveVoice?.disconnect(); } },
    { name: 'global shortcuts', run: () => globalShortcut.unregisterAll() },
    { name: 'cursor overlays', run: () => cursorOverlay?.destroyAll() },
    {
      name: 'voice system',
      run: () => {
        voiceSystem?.stopListening();
        voiceSystem?.unregisterAll();
      },
    },
    { name: 'clipboard watcher', run: () => stopClipboardWatcher() },
    { name: 'JARVIS connection', run: () => jarvisConnection?.destroy() },
    { name: 'connection toggle', run: () => connectionToggle?.destroy() },
    { name: 'tray', run: () => trayManager?.destroy() },
  ], SHUTDOWN_TIMEOUT_MS);

  void reportShutdownOutcome(cleanupPromise, {
    smoke: isHeadlessSmokeMode(),
    log: logHeadlessSmoke,
    error: (message, error) => console.error(message, error),
    quit: () => {
      cleanupComplete = true;
      app.quit();
    },
    exit: (code) => app.exit(code),
  });
});

const GOT_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();

if (isHeadlessSmokeMode()) {
  for (const switchName of getHeadlessSwitches()) {
    app.commandLine.appendSwitch(switchName);
  }
}

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

/** Load the first URL that connects (HTTPS → HTTP fallback for the web UI). */
async function loadFirstReachable(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await mainWindow?.loadURL(url);
      return;
    } catch {
      // try next candidate
    }
  }
  try {
    await mainWindow?.loadURL(urls[urls.length - 1]);
  } catch (e) {
    console.error('[electron] all web UI candidates failed:', (e as Error).message);
  }
}

// ── Navigation / IPC trust guards ───────────────────────────────────────────

/** Origins the renderer is allowed to navigate to and send IPC from. */
function getAppOrigins(): Set<string> {
  const origins = new Set<string>([
    'https://localhost:3001',
    'http://localhost:3001',
    'https://localhost:3000',
    'http://localhost:3000',
  ]);
  const envUrl = process.env.JARVIS_WEB_UI_URL;
  if (envUrl) {
    try {
      origins.add(new URL(envUrl).origin);
    } catch { /* ignore invalid env URL */ }
  }
  return origins;
}

/** True when the IPC call originated from the app's own origin. */
function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  try {
    const senderFrame = event.senderFrame;
    if (!senderFrame?.url) return false;
    const url = new URL(senderFrame.url);
    // file:, data:, about: and sandboxed frames all report origin "null", so
    // file: pages are trusted only when they are the app's own bundled files.
    if (url.protocol === 'file:') {
      const rel = relative(resolve(__dirname, '..'), fileURLToPath(url));
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    }
    return getAppOrigins().has(url.origin);
  } catch {
    return false;
  }
}

/** Guard wrapper for IPC handlers that take action with untrusted arguments. */
function trusted(
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown
): (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown {
  return (event, ...args) => {
    if (!isTrustedSender(event)) {
      throw new Error('IPC rejected: untrusted sender origin');
    }
    return handler(event, ...args);
  };
}

function createMainWindow(): void {
  const headlessSmoke = isHeadlessSmokeMode();
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
      sandbox: true,
    },
    show: !headlessSmoke,
  });

  if (headlessSmoke) {
    mainWindow.setSkipTaskbar(true);
  }

  // ── Navigation lockdown ──────────────────────────────────────────────────
  // Pop-ups: only allow the app's own origin; open everything else in the
  // system browser (http/https only), otherwise deny.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (getAppOrigins().has(origin)) {
        return { action: 'allow' };
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url);
      }
    } catch { /* invalid URL — deny */ }
    return { action: 'deny' };
  });

  // Navigation: block any navigation away from the app's own origins.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const origin = new URL(url).origin;
      if (!getAppOrigins().has(origin)) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // ── Electron-level permission handler (mic, screen — camera is never granted) ──
  const { session } = require('electron');
  const allowedPermissions = ['microphone', 'screen-capture', 'media', 'mediaKeySystem', 'display-capture'];
  session.defaultSession.setPermissionRequestHandler((_webContents: any, permission: string, callback: (granted: boolean) => void, details: any) => {
    // 'media' covers both mic and camera — deny any request that includes video
    if (permission === 'media' && Array.isArray(details?.mediaTypes) && details.mediaTypes.includes('video')) {
      return callback(false);
    }
    callback(allowedPermissions.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents: any, permission: string, _origin: string, details: any) => {
    if (permission === 'media' && details?.mediaType === 'video') return false;
    return allowedPermissions.includes(permission);
  });

  // Load the GhostForge web UI (runs on 3001; HTTPS when certs exist, else HTTP)
  const webUICandidates = [
    process.env.JARVIS_WEB_UI_URL,
    'https://localhost:3001',
    'http://localhost:3001',
  ].filter((u): u is string => Boolean(u));
  loadFirstReachable(webUICandidates);

  mainWindow.once('ready-to-show', () => {
    logHeadlessSmoke(HEADLESS_WINDOW_LOG);
    if (isHeadlessSmokeMode()) {
      mainWindow?.hide();
      return;
    }
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    const skipTrayInterception = isQuitting || isExplicitWindowClose;
    isExplicitWindowClose = false;
    if (shouldMinimizeWindowToTray(skipTrayInterception, config.minimizeToTray)) {
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
  geminiLiveVoice = new GeminiLiveVoice(/* memory */ {} as any, {
    apiKey: process.env.GEMINI_API_KEY || '',
  });
  geminiLiveVoice.setMainWindow(mainWindow);
  n8nIntegration = new N8nIntegration();
  trayManager = new TrayManager(mainWindow);

  // Initialize daemon, updater, and code modifier
  jarvisDaemon = getDaemon();
  jarvisDaemon.setMainWindow(mainWindow);
  jarvisDaemon.registerIPC();

  selfUpdater = new SelfUpdater();
  selfUpdater.setMainWindow(mainWindow);
  selfUpdater.registerIPC();

  codeModifier = new CodeModifier();
  codeModifier.setMainWindow(mainWindow);
  codeModifier.registerIPC();

  // Initialize Voicebox integration
  voiceboxIntegration = new VoiceboxIntegration();
  voiceboxIntegration.setMainWindow(mainWindow);
  voiceboxIntegration.checkConnection().catch(() => {});

  // Register clipboard change events for renderer
  const { onClipboardChange } = require('./clipboard-intel');
  onClipboardChange((text: string) => {
    mainWindow?.webContents.send('clipboard:change', text);
  });

  // Register IPC handlers
  registerIPC();

  // Create tray
  trayManager.createTray();

  // Register autonomous agent IPC
  registerAutonomousAgentIPC(ipcMain);

  // Register global shortcuts
  registerGlobalShortcuts();
}

function registerIPC(): void {
  // Screen capture
  ipcMain.handle('screen:capture', trusted(async (_event, options: ScreenCaptureOptions) => {
    return screenCapture.capture(options);
  }));

  ipcMain.handle('screen:captureRegion', trusted(async (
    _event, x: number, y: number, w: number, h: number, options?: ScreenCaptureOptions
  ) => {
    return screenCapture.captureRegion(x, y, w, h, options);
  }));

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

  ipcMain.handle('voice:speak', trusted(async (_event, text: string, voice?: string) => {
    return voiceSystem.speak(text, voice);
  }));

  ipcMain.handle('voice:setVolume', (_event, direction: 'up' | 'down' | 'mute') => {
    voiceSystem.setSystemVolume(direction);
    return { success: true };
  });

  // System control
  ipcMain.handle('system:openApp', trusted(async (_event, appName: string) => {
    return systemControl.openApp(appName);
  }));

  ipcMain.handle('system:openUrl', trusted(async (_event, url: string) => {
    return systemControl.openUrl(url);
  }));

  ipcMain.handle('system:lockScreen', trusted(async () => {
    return systemControl.lockScreen();
  }));

  ipcMain.handle('system:getInfo', async () => {
    return systemControl.getSystemInfo();
  });

  ipcMain.handle('system:getVolume', async () => {
    return systemControl.getVolume();
  });

  ipcMain.handle('system:setVolume', async (_event, level: number) => {
    return systemControl.setVolume(level);
  });

  ipcMain.handle('system:volumeUp', async () => {
    return systemControl.volumeUp();
  });

  ipcMain.handle('system:volumeDown', async () => {
    return systemControl.volumeDown();
  });

  ipcMain.handle('system:processes', async () => {
    return systemControl.listRunningProcesses();
  });

  ipcMain.handle('system:killProcess', trusted(async (_event, name: string) => {
    return systemControl.killProcess(name);
  }));

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
  ipcMain.handle('window:close', () => {
    if (!mainWindow) return;
    isExplicitWindowClose = true;
    mainWindow?.close();
  });
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
  ipcMain.handle('file:read', trusted(async (_event, filePath: string) => extractText(filePath)));
  ipcMain.handle('file:summarize', trusted(async (_event, filePath: string) =>
    readAndSummarize(filePath)
  ));
  ipcMain.handle('file:ask', trusted(async (_event, filePath: string, question: string) =>
    askQuestionAboutFile(filePath, question)
  ));
  ipcMain.handle('file:convert', trusted(async (_event, inputPath: string, format: string) =>
    convertFormat(inputPath, format as 'txt' | 'md' | 'json' | 'csv' | 'html')
  ));

  // ── Hardware Monitor ──────────────────────────────────────────────────────
  ipcMain.handle('hardware:cpu', () => getCpuStats());
  ipcMain.handle('hardware:ram', () => getRamStats());
  ipcMain.handle('hardware:disk', () => getDiskStats());
  ipcMain.handle('hardware:gpu', () => getGpuStats());
  ipcMain.handle('hardware:fan', () => getFanSpeed());
  ipcMain.handle('hardware:full-report', () => getFullSystemReport());

  // ── Combined System Info (for JARVIS / dashboard quick-poll) ────────────
  ipcMain.handle('jarvis:get-system-info', async () => {
    const report = await getFullSystemReport();
    const primaryDisk = report.disks?.[0];
    return {
      cpuUsage: report.cpu.usagePercent,
      ramUsage: { usedGB: report.ram.usedGB, totalGB: report.ram.totalGB, percent: report.ram.percent },
      batteryLevel: report.battery.percent,
      batteryCharging: report.battery.charging,
      diskUsage: primaryDisk ? { usedGB: primaryDisk.usedGB, totalGB: primaryDisk.totalGB, percent: primaryDisk.percent } : null,
      uptime: report.uptime,
      platform: report.platform,
    };
  });

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

  // ── Mark-L Bridge Manager ─────────────────────────────────────────────────
  ipcMain.handle('jarvis:bridge-start', async () => {
    await bridgeManager.startBridge();
    return { success: true, status: bridgeManager.getBridgeStatus() };
  });

  ipcMain.handle('jarvis:bridge-stop', async () => {
    await bridgeManager.stopBridge();
    return { success: true, status: bridgeManager.getBridgeStatus() };
  });

  ipcMain.handle('jarvis:bridge-restart', async () => {
    await bridgeManager.restartBridge();
    return { success: true, status: bridgeManager.getBridgeStatus() };
  });

  ipcMain.handle('jarvis:bridge-status', () => {
    return {
      status: bridgeManager.getBridgeStatus(),
      url: bridgeManager.getBridgeUrl(),
    };
  });

  ipcMain.handle('jarvis:bridge-logs', () => {
    return { logs: bridgeManager.getBridgeLogs() };
  });

  ipcMain.handle('jarvis:bridge-auto-start', (_event, enabled?: boolean) => {
    if (enabled !== undefined) {
      bridgeManager.setAutoStart(enabled);
    }
    return { autoStart: bridgeManager.isAutoStartEnabled() };
  });

  bridgeManager.on('status', (status) => {
    mainWindow?.webContents.send('jarvis:bridge-status', status);
  });

  // ── Gemini Live Voice ────────────────────────────────────────────────────────
  ipcMain.handle('jarvis:voice-connect', async () => {
    return geminiLiveVoice.connect();
  });

  ipcMain.handle('jarvis:voice-disconnect', async () => {
    await geminiLiveVoice.disconnect();
    return { success: true };
  });

  ipcMain.handle('jarvis:voice-start', async () => {
    return geminiLiveVoice.startListening();
  });

  ipcMain.handle('jarvis:voice-stop', async () => {
    await geminiLiveVoice.stopListening();
    return { success: true };
  });

  ipcMain.handle('jarvis:voice-status', () => {
    return geminiLiveVoice.getSessionInfo();
  });

  ipcMain.handle('jarvis:voice-send-text', async (_event, text: string) => {
    await geminiLiveVoice.sendText(text);
    return { success: true };
  });

  ipcMain.handle('jarvis:voice-settings-save', (_event, settings: Record<string, unknown>) => {
    geminiLiveVoice.updateSettings(settings as Partial<import('./gemini-live').GeminiLiveSettings>);
    return { success: true };
  });

  ipcMain.handle('jarvis:voice-settings-load', () => {
    return geminiLiveVoice.getConfig();
  });

  // Audio chunk relay: renderer captures mic → sends base64 → main forwards to Gemini WS
  ipcMain.handle('jarvis:voice-audio-chunk', (_event, base64Audio: string) => {
    geminiLiveVoice.sendAudioChunkFromRenderer(base64Audio);
    return { success: true };
  });

  // ── n8n Workflows ─────────────────────────────────────────────────────────
  ipcMain.handle('jarvis:n8n-status', async () => {
    const connected = await n8nIntegration.isConnected();
    const status = n8nIntegration.getStatus();
    return { ...status, connected };
  });

  ipcMain.handle('jarvis:n8n-connect', async (_event, url?: string, apiKey?: string) => {
    if (url) n8nIntegration.updateConfig({ baseUrl: url });
    if (apiKey) n8nIntegration.updateConfig({ apiKey });
    const connected = await n8nIntegration.isConnected();
    if (connected) {
      await n8nIntegration.listWorkflows();
    }
    const status = n8nIntegration.getStatus();
    return { ...status, connected };
  });

  ipcMain.handle('jarvis:n8n-workflows', async () => {
    return n8nIntegration.listWorkflows();
  });

  ipcMain.handle('jarvis:n8n-workflow-get', async (_event, id: string) => {
    return n8nIntegration.getWorkflow(id);
  });

  ipcMain.handle('jarvis:n8n-workflow-create', async (_event, workflow: { name: string; nodes: unknown[]; connections: Record<string, unknown> }) => {
    return n8nIntegration.createWorkflow(workflow);
  });

  ipcMain.handle('jarvis:n8n-workflow-activate', async (_event, id: string) => {
    return n8nIntegration.activateWorkflow(id);
  });

  ipcMain.handle('jarvis:n8n-workflow-deactivate', async (_event, id: string) => {
    return n8nIntegration.deactivateWorkflow(id);
  });

  ipcMain.handle('jarvis:n8n-trigger', async (_event, workflowId: string, data: Record<string, unknown>) => {
    return n8nIntegration.triggerWebhook(workflowId, data);
  });

  ipcMain.handle('jarvis:n8n-trigger-by-name', async (_event, name: string, data: Record<string, unknown>) => {
    return n8nIntegration.triggerByName(name, data);
  });

  ipcMain.handle('jarvis:n8n-deploy', async (_event, action: 'test' | 'build' | 'deploy', project: string, branch?: string) => {
    return n8nIntegration.deployWorkflow(action, project, branch);
  });

  ipcMain.handle('jarvis:n8n-notify', async (_event, channel: string, message: string, priority?: 'low' | 'medium' | 'high') => {
    return n8nIntegration.notifyWorkflow(channel, message, priority);
  });

  ipcMain.handle('jarvis:n8n-pr', async (_event, action: 'review' | 'merge' | 'comment', prNumber: number, repo: string, comment?: string) => {
    return n8nIntegration.prWorkflow(action, prNumber, repo, comment);
  });

  ipcMain.handle('jarvis:n8n-workflows-import', async () => {
    const workflowsDir = join(__dirname, '../../n8n-workflows');
    const files = ['ghostforge-deploy.json', 'ghostforge-notify.json', 'ghostforge-pr.json'];
    const imported: string[] = [];
    for (const file of files) {
      try {
        const filePath = pathJoin(workflowsDir, file);
        const content = readFileSync(filePath, 'utf8');
        const workflow = JSON.parse(content) as { name: string; nodes: unknown[]; connections: Record<string, unknown> };
        const result = await n8nIntegration.createWorkflow(workflow);
        if (result) imported.push(result.name);
      } catch (err) {
        console.error(`Failed to import workflow ${file}:`, err);
      }
    }
    return { imported, count: imported.length };
  });

  // ── Email Integration ───────────────────────────────────────────────────
  ipcMain.handle('email:list', async (_event, params: EmailSearchParams & { accountId?: string }) => {
    return emailList(params);
  });

  ipcMain.handle('email:read', async (_event, messageId: string, accountId?: string) => {
    return readEmail(messageId, accountId);
  });

  ipcMain.handle('email:send', async (_event, params: EmailSendParams & { accountId?: string }) => {
    return emailSend(params);
  });

  ipcMain.handle('email:reply', async (_event, messageId: string, body: string, bodyHtml?: string, accountId?: string) => {
    return replyToEmail(messageId, body, bodyHtml, accountId);
  });

  ipcMain.handle('email:mark-read', async (_event, messageId: string, accountId?: string) => {
    return markAsRead(messageId, accountId);
  });

  ipcMain.handle('email:mark-unread', async (_event, messageId: string, accountId?: string) => {
    return markAsUnread(messageId, accountId);
  });

  ipcMain.handle('email:star', async (_event, messageId: string, accountId?: string) => {
    return starEmail(messageId, accountId);
  });

  ipcMain.handle('email:unstar', async (_event, messageId: string, accountId?: string) => {
    return unstarEmail(messageId, accountId);
  });

  ipcMain.handle('email:delete', async (_event, messageId: string, accountId?: string) => {
    return deleteEmail(messageId, accountId);
  });

  ipcMain.handle('email:unread-count', async (_event, accountId?: string) => {
    return getUnreadCount(accountId);
  });

  ipcMain.handle('email:recent', async (_event, count?: number, accountId?: string) => {
    return getRecentEmails(count, accountId);
  });

  ipcMain.handle('email:search', async (_event, query: string, accountId?: string) => {
    return searchEmails(query, accountId);
  });

  ipcMain.handle('email:accounts', () => {
    return getEmailAccounts();
  });

  ipcMain.handle('email:remove-account', (_event, accountId: string) => {
    return removeEmailAccount(accountId);
  });

  ipcMain.handle('email:add-imap', (_event, config: Parameters<typeof addImapAccount>[0]) => {
    return addImapAccount(config);
  });

  ipcMain.handle('email:oauth-start', (_event, provider: 'gmail' | 'outlook') => {
    if (provider === 'gmail') return startGmailOAuth();
    throw new Error(`OAuth not implemented for ${provider}`);
  });

  ipcMain.handle('email:oauth-callback', async (_event, code: string, provider: 'gmail' | 'outlook') => {
    return handleOAuthCallback(code, provider);
  });

  // ── Google AI Studio ────────────────────────────────────────────────────
  ipcMain.handle('ai-studio:set-key', (_event, apiKey: string) => {
    return setAIStudioKey(apiKey);
  });

  ipcMain.handle('ai-studio:key-status', () => {
    return getAIStudioKeyStatus();
  });

  ipcMain.handle('ai-studio:list-models', async () => {
    return listTunedModels();
  });

  ipcMain.handle('ai-studio:get-model', async (_event, modelId: string) => {
    return getTunedModel(modelId);
  });

  ipcMain.handle('ai-studio:generate', async (_event, model: string, prompt: string, options?: Record<string, unknown>) => {
    return generateContent(model, prompt, options as Parameters<typeof generateContent>[2]);
  });

  ipcMain.handle('ai-studio:update-model', async (_event, modelId: string, updates: { displayName?: string; description?: string }) => {
    return updateTunedModel(modelId, updates);
  });

  ipcMain.handle('ai-studio:base-models', async () => {
    return listModels();
  });

  ipcMain.handle('ai-studio:model-info', async (_event, modelName: string) => {
    return getModelInfo(modelName);
  });

  ipcMain.handle('ai-studio:compare', async (_event, prompt: string, modelA: string, modelB: string, options?: Record<string, unknown>) => {
    return compareModels(prompt, modelA, modelB, options as Parameters<typeof compareModels>[3]);
  });

  ipcMain.handle('ai-studio:test', async (_event, model: string, prompt: string, options?: Record<string, unknown>) => {
    return aiStudioTest(model, prompt, options as Parameters<typeof aiStudioTest>[2]);
  });

  ipcMain.handle('ai-studio:export-config', async (_event, modelId: string) => {
    return exportModelConfig(modelId);
  });

  ipcMain.handle('ai-studio:import-config', async (_event, config: Record<string, unknown>) => {
    return importModelConfig(config as Parameters<typeof importModelConfig>[0]);
  });

  // ── Calendar Integration ────────────────────────────────────────────────
  ipcMain.handle('calendar:today', async (_event, accountId?: string) => {
    return listTodayEvents(accountId);
  });

  ipcMain.handle('calendar:upcoming', async (_event, days?: number, accountId?: string) => {
    return listUpcomingEvents(days, accountId);
  });

  ipcMain.handle('calendar:create', async (_event, params: CreateEventParams & { accountId?: string }) => {
    return createEvent(params);
  });

  ipcMain.handle('calendar:update', async (_event, eventId: string, updates: Partial<CreateEventParams> & { accountId?: string }) => {
    return updateEvent(eventId, updates);
  });

  ipcMain.handle('calendar:delete', async (_event, eventId: string, accountId?: string) => {
    return deleteEvent(eventId, accountId);
  });

  ipcMain.handle('calendar:free-busy', async (_event, timeMin: string, timeMax: string, accountId?: string) => {
    return checkAvailability(timeMin, timeMax, accountId);
  });

  ipcMain.handle('calendar:free-slots', async (_event, date: string, accountId?: string) => {
    return getFreeSlots(date, accountId);
  });

  ipcMain.handle('calendar:accounts', () => {
    return getCalendarAccounts();
  });

  ipcMain.handle('calendar:remove-account', (_event, accountId: string) => {
    return removeCalendarAccount(accountId);
  });

  ipcMain.handle('calendar:oauth-start', (_event, provider: 'google' | 'outlook') => {
    if (provider === 'google') return startGoogleCalendarOAuth();
    throw new Error(`OAuth not implemented for ${provider}`);
  });

  ipcMain.handle('calendar:oauth-callback', async (_event, code: string, provider: 'google' | 'outlook') => {
    return handleCalendarOAuthCallback(code, provider);
  });

  ipcMain.handle('calendar:add-caldav', (_event, config: Parameters<typeof addCaldavAccount>[0]) => {
    return addCaldavAccount(config);
  });

  // ── Contacts Integration ────────────────────────────────────────────────
  ipcMain.handle('contacts:search', async (_event, query: string, accountId?: string) => {
    return searchContacts(query, accountId);
  });

  ipcMain.handle('contacts:get', async (_event, contactId: string, accountId?: string) => {
    return getContact(contactId, accountId);
  });

  ipcMain.handle('contacts:create', async (_event, contact: Record<string, unknown> & { accountId?: string }) => {
    return createContact(contact as Parameters<typeof createContact>[0]);
  });

  ipcMain.handle('contacts:delete', async (_event, contactId: string, accountId?: string) => {
    return deleteContact(contactId, accountId);
  });

  ipcMain.handle('contacts:by-phone', async (_event, phone: string, accountId?: string) => {
    return getContactsByPhone(phone, accountId);
  });

  ipcMain.handle('contacts:recent', async (_event, count?: number) => {
    return getRecentContacts(count);
  });

  ipcMain.handle('contacts:accounts', () => {
    return getContactAccounts();
  });

  ipcMain.handle('contacts:remove-account', (_event, accountId: string) => {
    return removeContactAccount(accountId);
  });

  ipcMain.handle('contacts:oauth-start', (_event, provider: 'google' | 'outlook') => {
    if (provider === 'google') return startGoogleContactsOAuth();
    throw new Error(`OAuth not implemented for ${provider}`);
  });

  ipcMain.handle('contacts:oauth-callback', async (_event, code: string, provider: 'google' | 'outlook') => {
    return handleContactsOAuthCallback(code, provider);
  });

  // ── Voicebox Integration ───────────────────────────────────────────────────
  ipcMain.handle('voicebox:status', async () => {
    return voiceboxIntegration.checkConnection();
  });

  ipcMain.handle('voicebox:generate', async (
    _event,
    text: string,
    options?: {
      profileId?: string;
      profileName?: string;
      language?: string;
      engine?: string;
      effects?: { pitchShift?: number; reverb?: number; delay?: number; chorus?: number };
    }
  ) => {
    return voiceboxIntegration.generateSpeech(text, options || {});
  });

  ipcMain.handle('voicebox:speak', async (
    _event,
    text: string,
    options?: { profile?: string; personality?: boolean; clientId?: string }
  ) => {
    await voiceboxIntegration.speak(text, options || {});
    return { success: true };
  });

  ipcMain.handle('voicebox:transcribe', async (
    _event,
    audioBase64: string,
    options?: { model?: string; language?: string }
  ) => {
    const buffer = Buffer.from(audioBase64, 'base64');
    return voiceboxIntegration.transcribe(buffer.buffer as ArrayBuffer, {
      model: options?.model as 'base' | 'small' | 'medium' | 'large' | 'turbo',
      language: options?.language,
    });
  });

  ipcMain.handle('voicebox:profiles', async () => {
    return voiceboxIntegration.listProfiles();
  });

  ipcMain.handle('voicebox:clone', async (
    _event,
    name: string,
    referenceAudioBase64: string,
    description?: string
  ) => {
    const buffer = Buffer.from(referenceAudioBase64, 'base64');
    return voiceboxIntegration.cloneVoice({ name, referenceAudio: buffer.buffer as ArrayBuffer, description });
  });

  ipcMain.handle('voicebox:engines', async () => {
    return voiceboxIntegration.getEngines();
  });

  ipcMain.handle('voicebox:languages', async () => {
    return voiceboxIntegration.getLanguages();
  });

  ipcMain.handle('voicebox:set-config', async (
    _event,
    updates: Partial<import('./voicebox-integration').VoiceboxConfig>
  ) => {
    voiceboxIntegration.updateConfig(updates);
    return voiceboxIntegration.getConfig();
  });

  ipcMain.handle('voicebox:get-config', () => {
    return voiceboxIntegration.getConfig();
  });

  ipcMain.handle('voicebox:create-profile', async (
    _event,
    options: { name: string; description?: string; language?: string }
  ) => {
    return voiceboxIntegration.createProfile(options);
  });

  ipcMain.handle('voicebox:delete-profile', async (_event, id: string) => {
    await voiceboxIntegration.deleteProfile(id);
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
process.on('unhandledRejection', (reason) => {
  console.error('[electron] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[electron] uncaughtException:', err);
});

app.whenReady().then(async () => {
  let startupFailed = false;
  try {
    createMainWindow();
  } catch (e) {
    startupFailed = true;
    console.error('[electron] createMainWindow failed:', (e as Error).message);
  }

  if (startupFailed) {
    app.quit();
    return;
  }

  if (isHeadlessSmokeMode()) {
    logHeadlessSmoke(HEADLESS_STARTUP_LOG);
    let exitScheduled = false;
    const scheduleSmokeExit = () => {
      if (exitScheduled) return;
      exitScheduled = true;
      setTimeout(() => app.quit(), 250);
    };
    bridgeManager.on('status', (status) => {
      if (status === 'running') {
        logHeadlessSmoke(HEADLESS_BRIDGE_LOG);
        scheduleSmokeExit();
      }
    });
    setTimeout(scheduleSmokeExit, 1_000);
  }

  if (bridgeManager.isAutoStartEnabled()) {
    bridgeManager.startBridge().catch((e) => console.error('[bridge] start failed:', (e as Error).message));
  }

  if (jarvisConnection) {
    try { await jarvisConnection.connect(); } catch (e) { console.error('[jarvis] connect failed:', (e as Error).message); }
  }

  // Start the JARVIS daemon (keeps running in background)
  if (jarvisDaemon) {
    try { await jarvisDaemon.start(mainWindow); } catch (e) { console.error('[daemon] start failed:', (e as Error).message); }
  }

  // Start auto-update checker (every 6 hours)
  if (selfUpdater) {
    try { selfUpdater.startAutoCheck(6 * 60 * 60 * 1000); } catch (e) { console.error('[updater] startAutoCheck failed:', (e as Error).message); }
  }
});

app.on('window-all-closed', () => {
  if (jarvisDaemon?.isRunning()) {
    jarvisDaemon.hideWindow();
    return;
  }
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
