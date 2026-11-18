import { app, BrowserWindow, screen, globalShortcut, nativeTheme } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
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
import { assertOAuthProvider } from './oauth-providers';
import { readStudioUrl, saveStudioUrl, studioTarget } from './studio-connection';
import {
  STUDIO_LAUNCHER,
  attachNavigationGuards,
  getConnectedStudioOrigin,
  secureHandle,
  setConnectedStudioOrigin,
} from './ipc-guard';

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
  console.warn('[electron] web UI unavailable; opening the bundled studio connection screen');
  await mainWindow?.loadFile(STUDIO_LAUNCHER);
}

// ── Navigation / IPC trust guards ───────────────────────────────────────────
// Every webContents (main window, overlays, any child) is kept on the app's
// own pages; see ipc-guard.ts. Registered before any window exists.
app.on('web-contents-created', (_event, contents) => {
  attachNavigationGuards(contents);
});

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
  // No child windows (they would inherit the preload; http(s) targets open in
  // the system browser), and no navigation or main-frame redirect away from
  // the app's own origins. Also attached via 'web-contents-created'.
  attachNavigationGuards(mainWindow.webContents);

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
  let savedStudioUrl: string | null = null;
  try {
    savedStudioUrl = readStudioUrl(join(app.getPath('userData'), 'studio-url.json'));
    setConnectedStudioOrigin(savedStudioUrl);
  } catch (error) {
    console.error('[electron] could not restore studio URL:', error);
  }
  const webUICandidates = [
    process.env.JARVIS_WEB_UI_URL,
    savedStudioUrl,
    'https://localhost:3001',
    'http://localhost:3001',
  ].filter((u): u is string => Boolean(u));
  void loadFirstReachable(webUICandidates).catch(error => console.error('[electron] could not load the studio launcher:', error));

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
  registerAutonomousAgentIPC();

  // Register global shortcuts
  registerGlobalShortcuts();
}

function registerIPC(): void {
  const requireLauncher = (event: Electron.IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || frame.url.split(/[?#]/)[0] !== pathToFileURL(STUDIO_LAUNCHER).href) {
      throw new Error('Studio connection can only be changed from the bundled launcher');
    }
  };
  secureHandle('studio:get-url', event => {
    requireLauncher(event);
    return readStudioUrl(join(app.getPath('userData'), 'studio-url.json'));
  });
  secureHandle('studio:connect', async (event, raw: unknown, section: unknown) => {
    requireLauncher(event);
    const target = studioTarget(raw, section);
    const previous = getConnectedStudioOrigin();
    const origin = new URL(target).origin;
    setConnectedStudioOrigin(origin);
    try {
      await mainWindow?.loadURL(target);
      saveStudioUrl(join(app.getPath('userData'), 'studio-url.json'), origin);
    } catch (error) {
      setConnectedStudioOrigin(previous);
      await mainWindow?.loadFile(STUDIO_LAUNCHER, {
        query: { error: `Could not connect: ${error instanceof Error ? error.message : String(error)}` },
      });
      throw error;
    }
  });
  // Screen capture
  secureHandle('screen:capture', (async (_event, options: ScreenCaptureOptions) => {
    return screenCapture.capture(options);
  }));

  secureHandle('screen:captureRegion', (async (
    _event, x: number, y: number, w: number, h: number, options?: ScreenCaptureOptions
  ) => {
    return screenCapture.captureRegion(x, y, w, h, options);
  }));

  secureHandle('screen:getDisplays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      size: d.size,
      label: d.label,
      primary: d.id === screen.getPrimaryDisplay().id,
    }));
  });

  // Cursor overlay
  secureHandle('cursor:point', (_event, screenId: number, target: CursorTarget) => {
    cursorOverlay.showCursor(screenId, target);
    return { success: true };
  });

  secureHandle('cursor:highlight', (
    _event, screenId: number, x: number, y: number, w: number, h: number, label?: string
  ) => {
    cursorOverlay.highlightArea(screenId, x, y, w, h, label);
    return { success: true };
  });

  secureHandle('cursor:hide', (_event, screenId?: number) => {
    if (screenId !== undefined) {
      cursorOverlay.hideCursor(screenId);
    } else {
      cursorOverlay.hideAll();
    }
    return { success: true };
  });

  // Voice
  secureHandle('voice:start', () => {
    voiceSystem.startListening();
    return { success: true };
  });

  secureHandle('voice:stop', () => {
    voiceSystem.stopListening();
    return { success: true };
  });

  secureHandle('voice:speak', (async (_event, text: string, voice?: string) => {
    return voiceSystem.speak(text, voice);
  }));

  secureHandle('voice:setVolume', (_event, direction: 'up' | 'down' | 'mute') => {
    voiceSystem.setSystemVolume(direction);
    return { success: true };
  });

  // System control
  secureHandle('system:openApp', (async (_event, appName: string) => {
    return systemControl.openApp(appName);
  }));

  secureHandle('system:openUrl', (async (_event, url: string) => {
    return systemControl.openUrl(url);
  }));

  secureHandle('system:lockScreen', (async () => {
    return systemControl.lockScreen();
  }));

  secureHandle('system:getInfo', async () => {
    return systemControl.getSystemInfo();
  });

  secureHandle('system:getVolume', async () => {
    return systemControl.getVolume();
  });

  secureHandle('system:setVolume', async (_event, level: number) => {
    return systemControl.setVolume(level);
  });

  secureHandle('system:volumeUp', async () => {
    return systemControl.volumeUp();
  });

  secureHandle('system:volumeDown', async () => {
    return systemControl.volumeDown();
  });

  secureHandle('system:processes', async () => {
    return systemControl.listRunningProcesses();
  });

  secureHandle('system:killProcess', (async (_event, name: string) => {
    return systemControl.killProcess(name);
  }));

  // Config
  secureHandle('config:get', () => config);

  secureHandle('config:set', (_event, updates: Partial<JarvisConfig>) => {
    config = { ...config, ...updates };
    return config;
  });

  // Window control
  secureHandle('window:minimize', () => mainWindow?.minimize());
  secureHandle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  secureHandle('window:close', () => {
    if (!mainWindow) return;
    isExplicitWindowClose = true;
    mainWindow?.close();
  });
  secureHandle('window:hide', () => mainWindow?.hide());
  secureHandle('window:show', () => mainWindow?.show());

  // Tray updates
  secureHandle('tray:updateStatus', (_event, status: string, model?: string) => {
    trayManager?.updateContextMenu(status, model);
    return { success: true };
  });

  // ── Auto-Start ────────────────────────────────────────────────────────────
  secureHandle('auto-start:enable', () => enableAutoStart());
  secureHandle('auto-start:disable', () => disableAutoStart());
  secureHandle('auto-start:status', () => isAutoStartEnabled());

  // ── YouTube ───────────────────────────────────────────────────────────────
  secureHandle('youtube:search', (_event, query: string) => searchAndPlay(query));
  secureHandle('youtube:transcript', (_event, url: string) => getTranscript(url));
  secureHandle('youtube:info', (_event, url: string) => getVideoInfo(url));
  secureHandle('youtube:trending', (_event, region: string) => getTrending(region));
  secureHandle('youtube:summarize', (_event, url: string) => summarizeVideo(url));

  // ── Game Updater ──────────────────────────────────────────────────────────
  secureHandle('games:list', () => listAllGames());
  secureHandle('games:scan-steam', () => scanSteamGames());
  secureHandle('games:scan-epic', () => scanEpicGames());
  secureHandle('games:check-update', (_event, name: string) => checkForUpdates(name));
  secureHandle('games:update', (_event, name: string) => updateGame(name));

  // ── Clipboard Intelligence ────────────────────────────────────────────────
  secureHandle('clipboard:start-watcher', (_event, interval: number) => {
    startClipboardWatcher(interval);
    return { success: true };
  });
  secureHandle('clipboard:stop-watcher', () => {
    stopClipboardWatcher();
    return { success: true };
  });
  secureHandle('clipboard:analyze', (_event, text: string, action?: string) =>
    analyzeClipboard(text, (action as any) || 'explain')
  );
  secureHandle('clipboard:history', () => getClipboardHistory());
  secureHandle('clipboard:smart-paste', (_event, action: string) =>
    smartPaste(action as any)
  );

  // ── Setup Wizard ──────────────────────────────────────────────────────────
  secureHandle('setup:status', () => getSetupStatus());
  secureHandle('setup:steps', () => getSetupSteps());
  secureHandle('setup:complete-step', (_event, stepId: string, config: Record<string, unknown>) =>
    completeStep(stepId, config)
  );
  secureHandle('setup:is-first-run', () => isFirstRun());

  // ── System Control (new methods) ──────────────────────────────────────────
  secureHandle('system:set-brightness', (_event, level: number) =>
    systemControl.setBrightness(level)
  );
  secureHandle('system:get-brightness', () => systemControl.getBrightness());
  secureHandle('system:toggle-wifi', () => systemControl.toggleWifi());
  secureHandle('system:wifi-status', () => systemControl.getWifiStatus());
  secureHandle('system:toggle-bluetooth', () => systemControl.toggleBluetooth());
  secureHandle('system:sleep', () => systemControl.sleepComputer());
  secureHandle('system:restart', () => systemControl.restartComputer());
  secureHandle('system:shutdown', () => systemControl.shutdownComputer());
  secureHandle('system:battery', () => systemControl.getBatteryStatus());
  secureHandle('system:screenshot', () => systemControl.takeScreenshot());

  // ── Browser Automation ────────────────────────────────────────────────────
  secureHandle('browser:open', (_event, url: string) => browserOpen(url));
  secureHandle('browser:search', (_event, query: string) => searchWeb(query));
  secureHandle('browser:navigate', (_event, url: string) => navigateTab(url));
  secureHandle('browser:click', (_event, selector: string) => clickElement(selector));
  secureHandle('browser:type', (_event, text: string) => typeText(text));
  secureHandle('browser:back', () => goBack());
  secureHandle('browser:forward', () => goForward());
  secureHandle('browser:scroll', (_event, dir: string) =>
    scrollPage(dir as 'up' | 'down' | 'left' | 'right')
  );
  secureHandle('browser:screenshot', (_event, filePath?: string) =>
    browserScreenshot(filePath)
  );
  secureHandle('browser:get-text', () => getPageText());

  // ── File Processor ────────────────────────────────────────────────────────
  secureHandle('file:read', (async (_event, filePath: string) => extractText(filePath)));
  secureHandle('file:summarize', (async (_event, filePath: string) =>
    readAndSummarize(filePath)
  ));
  secureHandle('file:ask', (async (_event, filePath: string, question: string) =>
    askQuestionAboutFile(filePath, question)
  ));
  secureHandle('file:convert', (async (_event, inputPath: string, format: string) =>
    convertFormat(inputPath, format as 'txt' | 'md' | 'json' | 'csv' | 'html')
  ));

  // ── Hardware Monitor ──────────────────────────────────────────────────────
  secureHandle('hardware:cpu', () => getCpuStats());
  secureHandle('hardware:ram', () => getRamStats());
  secureHandle('hardware:disk', () => getDiskStats());
  secureHandle('hardware:gpu', () => getGpuStats());
  secureHandle('hardware:fan', () => getFanSpeed());
  secureHandle('hardware:full-report', () => getFullSystemReport());

  // ── Combined System Info (for JARVIS / dashboard quick-poll) ────────────
  secureHandle('jarvis:get-system-info', async () => {
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
  secureHandle('jarvis:connect', async (_event, serverUrl?: string) => {
    return jarvisConnection.connect(serverUrl);
  });

  secureHandle('jarvis:connect-ws', async (_event, serverUrl?: string) => {
    return jarvisConnection.connectWebSocket(serverUrl);
  });

  secureHandle('jarvis:disconnect', () => {
    jarvisConnection.disconnect();
    return { success: true };
  });

  secureHandle('jarvis:discover-servers', async () => {
    return jarvisConnection.discoverServers();
  });

  secureHandle('jarvis:get-state', () => {
    return jarvisConnection.getState();
  });

  secureHandle('jarvis:send-command', async (_event, command: string, payload?: Record<string, unknown>) => {
    return jarvisConnection.sendCommand(command, payload);
  });

  secureHandle('jarvis:send-ws-message', (_event, message: Record<string, unknown>) => {
    jarvisConnection.sendWsMessage(message);
    return { success: true };
  });

  secureHandle('jarvis:is-connected', () => {
    return jarvisConnection.isConnected();
  });

  // ── Connection Toggle / OmniRoute ─────────────────────────────────────────
  secureHandle('connection:get-mode', () => {
    return connectionToggle.getConnectionMode();
  });

  secureHandle('connection:set-mode', async (_event, mode: 'server' | 'omniroute') => {
    return connectionToggle.setConnectionMode(mode);
  });

  secureHandle('connection:get-status', async () => {
    return connectionToggle.getStatus();
  });

  secureHandle('connection:get-server-status', async () => {
    return connectionToggle.getServerStatus();
  });

  secureHandle('connection:get-servers', async () => {
    return connectionToggle.getAvailableServers();
  });

  secureHandle('connection:process', async (_event, text: string) => {
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
  secureHandle('jarvis:bridge-start', async () => {
    await bridgeManager.startBridge();
    return { success: true, status: bridgeManager.getBridgeStatus() };
  });

  secureHandle('jarvis:bridge-stop', async () => {
    await bridgeManager.stopBridge();
    return { success: true, status: bridgeManager.getBridgeStatus() };
  });

  secureHandle('jarvis:bridge-restart', async () => {
    await bridgeManager.restartBridge();
    return { success: true, status: bridgeManager.getBridgeStatus() };
  });

  secureHandle('jarvis:bridge-status', () => {
    return {
      status: bridgeManager.getBridgeStatus(),
      url: bridgeManager.getBridgeUrl(),
    };
  });

  secureHandle('jarvis:bridge-logs', () => {
    return { logs: bridgeManager.getBridgeLogs() };
  });

  secureHandle('jarvis:bridge-auto-start', (_event, enabled?: boolean) => {
    if (enabled !== undefined) {
      bridgeManager.setAutoStart(enabled);
    }
    return { autoStart: bridgeManager.isAutoStartEnabled() };
  });

  bridgeManager.on('status', (status) => {
    mainWindow?.webContents.send('jarvis:bridge-status', status);
  });

  // ── Gemini Live Voice ────────────────────────────────────────────────────────
  secureHandle('jarvis:voice-connect', async () => {
    return geminiLiveVoice.connect();
  });

  secureHandle('jarvis:voice-disconnect', async () => {
    await geminiLiveVoice.disconnect();
    return { success: true };
  });

  secureHandle('jarvis:voice-start', async () => {
    return geminiLiveVoice.startListening();
  });

  secureHandle('jarvis:voice-stop', async () => {
    await geminiLiveVoice.stopListening();
    return { success: true };
  });

  secureHandle('jarvis:voice-status', () => {
    return geminiLiveVoice.getSessionInfo();
  });

  secureHandle('jarvis:voice-send-text', async (_event, text: string) => {
    await geminiLiveVoice.sendText(text);
    return { success: true };
  });

  secureHandle('jarvis:voice-settings-save', (_event, settings: Record<string, unknown>) => {
    geminiLiveVoice.updateSettings(settings as Partial<import('./gemini-live').GeminiLiveSettings>);
    return { success: true };
  });

  secureHandle('jarvis:voice-settings-load', () => {
    return geminiLiveVoice.getConfig();
  });

  // Audio chunk relay: renderer captures mic → sends base64 → main forwards to Gemini WS
  secureHandle('jarvis:voice-audio-chunk', (_event, base64Audio: string) => {
    geminiLiveVoice.sendAudioChunkFromRenderer(base64Audio);
    return { success: true };
  });

  // ── n8n Workflows ─────────────────────────────────────────────────────────
  secureHandle('jarvis:n8n-status', async () => {
    const connected = await n8nIntegration.isConnected();
    const status = n8nIntegration.getStatus();
    return { ...status, connected };
  });

  secureHandle('jarvis:n8n-connect', async (_event, url?: string, apiKey?: string) => {
    if (url) n8nIntegration.updateConfig({ baseUrl: url });
    if (apiKey) n8nIntegration.updateConfig({ apiKey });
    const connected = await n8nIntegration.isConnected();
    if (connected) {
      await n8nIntegration.listWorkflows();
    }
    const status = n8nIntegration.getStatus();
    return { ...status, connected };
  });

  secureHandle('jarvis:n8n-workflows', async () => {
    return n8nIntegration.listWorkflows();
  });

  secureHandle('jarvis:n8n-workflow-get', async (_event, id: string) => {
    return n8nIntegration.getWorkflow(id);
  });

  secureHandle('jarvis:n8n-workflow-create', async (_event, workflow: { name: string; nodes: unknown[]; connections: Record<string, unknown> }) => {
    return n8nIntegration.createWorkflow(workflow);
  });

  secureHandle('jarvis:n8n-workflow-activate', async (_event, id: string) => {
    return n8nIntegration.activateWorkflow(id);
  });

  secureHandle('jarvis:n8n-workflow-deactivate', async (_event, id: string) => {
    return n8nIntegration.deactivateWorkflow(id);
  });

  secureHandle('jarvis:n8n-trigger', async (_event, workflowId: string, data: Record<string, unknown>) => {
    return n8nIntegration.triggerWebhook(workflowId, data);
  });

  secureHandle('jarvis:n8n-trigger-by-name', async (_event, name: string, data: Record<string, unknown>) => {
    return n8nIntegration.triggerByName(name, data);
  });

  secureHandle('jarvis:n8n-deploy', async (_event, action: 'test' | 'build' | 'deploy', project: string, branch?: string) => {
    return n8nIntegration.deployWorkflow(action, project, branch);
  });

  secureHandle('jarvis:n8n-notify', async (_event, channel: string, message: string, priority?: 'low' | 'medium' | 'high') => {
    return n8nIntegration.notifyWorkflow(channel, message, priority);
  });

  secureHandle('jarvis:n8n-pr', async (_event, action: 'review' | 'merge' | 'comment', prNumber: number, repo: string, comment?: string) => {
    return n8nIntegration.prWorkflow(action, prNumber, repo, comment);
  });

  secureHandle('jarvis:n8n-workflows-import', async () => {
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
  secureHandle('email:list', async (_event, params: EmailSearchParams & { accountId?: string }) => {
    return emailList(params);
  });

  secureHandle('email:read', async (_event, messageId: string, accountId?: string) => {
    return readEmail(messageId, accountId);
  });

  secureHandle('email:send', async (_event, params: EmailSendParams & { accountId?: string }) => {
    return emailSend(params);
  });

  secureHandle('email:reply', async (_event, messageId: string, body: string, bodyHtml?: string, accountId?: string) => {
    return replyToEmail(messageId, body, bodyHtml, accountId);
  });

  secureHandle('email:mark-read', async (_event, messageId: string, accountId?: string) => {
    return markAsRead(messageId, accountId);
  });

  secureHandle('email:mark-unread', async (_event, messageId: string, accountId?: string) => {
    return markAsUnread(messageId, accountId);
  });

  secureHandle('email:star', async (_event, messageId: string, accountId?: string) => {
    return starEmail(messageId, accountId);
  });

  secureHandle('email:unstar', async (_event, messageId: string, accountId?: string) => {
    return unstarEmail(messageId, accountId);
  });

  secureHandle('email:delete', async (_event, messageId: string, accountId?: string) => {
    return deleteEmail(messageId, accountId);
  });

  secureHandle('email:unread-count', async (_event, accountId?: string) => {
    return getUnreadCount(accountId);
  });

  secureHandle('email:recent', async (_event, count?: number, accountId?: string) => {
    return getRecentEmails(count, accountId);
  });

  secureHandle('email:search', async (_event, query: string, accountId?: string) => {
    return searchEmails(query, accountId);
  });

  secureHandle('email:accounts', () => {
    return getEmailAccounts();
  });

  secureHandle('email:remove-account', (_event, accountId: string) => {
    return removeEmailAccount(accountId);
  });

  secureHandle('email:add-imap', (_event, config: Parameters<typeof addImapAccount>[0]) => {
    return addImapAccount(config);
  });

  secureHandle('email:oauth-start', (_event, provider: unknown) => {
    assertOAuthProvider('email', provider);
    return startGmailOAuth();
  });

  secureHandle('email:oauth-callback', async (_event, code: string, provider: unknown) => {
    assertOAuthProvider('email', provider);
    return handleOAuthCallback(code, provider);
  });

  // ── Google AI Studio ────────────────────────────────────────────────────
  secureHandle('ai-studio:set-key', (_event, apiKey: string) => {
    return setAIStudioKey(apiKey);
  });

  secureHandle('ai-studio:key-status', () => {
    return getAIStudioKeyStatus();
  });

  secureHandle('ai-studio:list-models', async () => {
    return listTunedModels();
  });

  secureHandle('ai-studio:get-model', async (_event, modelId: string) => {
    return getTunedModel(modelId);
  });

  secureHandle('ai-studio:generate', async (_event, model: string, prompt: string, options?: Record<string, unknown>) => {
    return generateContent(model, prompt, options as Parameters<typeof generateContent>[2]);
  });

  secureHandle('ai-studio:update-model', async (_event, modelId: string, updates: { displayName?: string; description?: string }) => {
    return updateTunedModel(modelId, updates);
  });

  secureHandle('ai-studio:base-models', async () => {
    return listModels();
  });

  secureHandle('ai-studio:model-info', async (_event, modelName: string) => {
    return getModelInfo(modelName);
  });

  secureHandle('ai-studio:compare', async (_event, prompt: string, modelA: string, modelB: string, options?: Record<string, unknown>) => {
    return compareModels(prompt, modelA, modelB, options as Parameters<typeof compareModels>[3]);
  });

  secureHandle('ai-studio:test', async (_event, model: string, prompt: string, options?: Record<string, unknown>) => {
    return aiStudioTest(model, prompt, options as Parameters<typeof aiStudioTest>[2]);
  });

  secureHandle('ai-studio:export-config', async (_event, modelId: string) => {
    return exportModelConfig(modelId);
  });

  secureHandle('ai-studio:import-config', async (_event, config: Record<string, unknown>) => {
    return importModelConfig(config as Parameters<typeof importModelConfig>[0]);
  });

  // ── Calendar Integration ────────────────────────────────────────────────
  secureHandle('calendar:today', async (_event, accountId?: string) => {
    return listTodayEvents(accountId);
  });

  secureHandle('calendar:upcoming', async (_event, days?: number, accountId?: string) => {
    return listUpcomingEvents(days, accountId);
  });

  secureHandle('calendar:create', async (_event, params: CreateEventParams & { accountId?: string }) => {
    return createEvent(params);
  });

  secureHandle('calendar:update', async (_event, eventId: string, updates: Partial<CreateEventParams> & { accountId?: string }) => {
    return updateEvent(eventId, updates);
  });

  secureHandle('calendar:delete', async (_event, eventId: string, accountId?: string) => {
    return deleteEvent(eventId, accountId);
  });

  secureHandle('calendar:free-busy', async (_event, timeMin: string, timeMax: string, accountId?: string) => {
    return checkAvailability(timeMin, timeMax, accountId);
  });

  secureHandle('calendar:free-slots', async (_event, date: string, accountId?: string) => {
    return getFreeSlots(date, accountId);
  });

  secureHandle('calendar:accounts', () => {
    return getCalendarAccounts();
  });

  secureHandle('calendar:remove-account', (_event, accountId: string) => {
    return removeCalendarAccount(accountId);
  });

  secureHandle('calendar:oauth-start', (_event, provider: unknown) => {
    assertOAuthProvider('calendar', provider);
    return startGoogleCalendarOAuth();
  });

  secureHandle('calendar:oauth-callback', async (_event, code: string, provider: unknown) => {
    assertOAuthProvider('calendar', provider);
    return handleCalendarOAuthCallback(code, provider);
  });

  secureHandle('calendar:add-caldav', (_event, config: Parameters<typeof addCaldavAccount>[0]) => {
    return addCaldavAccount(config);
  });

  // ── Contacts Integration ────────────────────────────────────────────────
  secureHandle('contacts:search', async (_event, query: string, accountId?: string) => {
    return searchContacts(query, accountId);
  });

  secureHandle('contacts:get', async (_event, contactId: string, accountId?: string) => {
    return getContact(contactId, accountId);
  });

  secureHandle('contacts:create', async (_event, contact: Record<string, unknown> & { accountId?: string }) => {
    return createContact(contact as Parameters<typeof createContact>[0]);
  });

  secureHandle('contacts:delete', async (_event, contactId: string, accountId?: string) => {
    return deleteContact(contactId, accountId);
  });

  secureHandle('contacts:by-phone', async (_event, phone: string, accountId?: string) => {
    return getContactsByPhone(phone, accountId);
  });

  secureHandle('contacts:recent', async (_event, count?: number) => {
    return getRecentContacts(count);
  });

  secureHandle('contacts:accounts', () => {
    return getContactAccounts();
  });

  secureHandle('contacts:remove-account', (_event, accountId: string) => {
    return removeContactAccount(accountId);
  });

  secureHandle('contacts:oauth-start', (_event, provider: unknown) => {
    assertOAuthProvider('contacts', provider);
    return startGoogleContactsOAuth();
  });

  secureHandle('contacts:oauth-callback', async (_event, code: string, provider: unknown) => {
    assertOAuthProvider('contacts', provider);
    return handleContactsOAuthCallback(code, provider);
  });

  // ── Voicebox Integration ───────────────────────────────────────────────────
  secureHandle('voicebox:status', async () => {
    return voiceboxIntegration.checkConnection();
  });

  secureHandle('voicebox:generate', async (
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

  secureHandle('voicebox:speak', async (
    _event,
    text: string,
    options?: { profile?: string; personality?: boolean; clientId?: string }
  ) => {
    await voiceboxIntegration.speak(text, options || {});
    return { success: true };
  });

  secureHandle('voicebox:transcribe', async (
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

  secureHandle('voicebox:profiles', async () => {
    return voiceboxIntegration.listProfiles();
  });

  secureHandle('voicebox:clone', async (
    _event,
    name: string,
    referenceAudioBase64: string,
    description?: string
  ) => {
    const buffer = Buffer.from(referenceAudioBase64, 'base64');
    return voiceboxIntegration.cloneVoice({ name, referenceAudio: buffer.buffer as ArrayBuffer, description });
  });

  secureHandle('voicebox:engines', async () => {
    return voiceboxIntegration.getEngines();
  });

  secureHandle('voicebox:languages', async () => {
    return voiceboxIntegration.getLanguages();
  });

  secureHandle('voicebox:set-config', async (
    _event,
    updates: Partial<import('./voicebox-integration').VoiceboxConfig>
  ) => {
    voiceboxIntegration.updateConfig(updates);
    return voiceboxIntegration.getConfig();
  });

  secureHandle('voicebox:get-config', () => {
    return voiceboxIntegration.getConfig();
  });

  secureHandle('voicebox:create-profile', async (
    _event,
    options: { name: string; description?: string; language?: string }
  ) => {
    return voiceboxIntegration.createProfile(options);
  });

  secureHandle('voicebox:delete-profile', async (_event, id: string) => {
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
