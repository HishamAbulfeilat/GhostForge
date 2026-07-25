import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, nativeTheme } from 'electron';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { processCommand } from './omniroute';

const execAsync = promisify(exec);

export type DaemonState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'PROCESSING' | 'SHUTTING_DOWN';

export interface DaemonStatus {
  state: DaemonState;
  uptime: number;
  startedAt: number | null;
  lastHealthCheck: number;
  voiceActive: boolean;
  commandsProcessed: number;
  restartCount: number;
  pid: number | null;
  platform: string;
}

export interface DaemonSettings {
  autoStartVoice: boolean;
  healthCheckIntervalMs: number;
  maxRestartAttempts: number;
  restartBackoffMs: number;
  voiceLanguage: string;
  voiceSensitivity: number;
  keepAliveOnClose: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_DAEMON_SETTINGS: DaemonSettings = {
  autoStartVoice: true,
  healthCheckIntervalMs: 30_000,
  maxRestartAttempts: 5,
  restartBackoffMs: 5_000,
  voiceLanguage: 'en-US',
  voiceSensitivity: 0.5,
  keepAliveOnClose: true,
  logLevel: 'info',
};

const STATE_FILE = join(homedir(), '.ghostforge', 'daemon-state.json');
const LOG_FILE = join(homedir(), '.ghostforge', 'daemon.log');

export class JarvisDaemon extends EventEmitter {
  private state: DaemonState = 'STOPPED';
  private startedAt: number | null = null;
  private lastHealthCheck = 0;
  private voiceActive = false;
  private commandsProcessed = 0;
  private restartCount = 0;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private voiceListeningTimer: ReturnType<typeof setInterval> | null = null;
  private settings: DaemonSettings = { ...DEFAULT_DAEMON_SETTINGS };
  private mainWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private speechRecognitionProcess: ChildProcess | null = null;
  private isQuitting = false;

  constructor() {
    super();
    this.ensureDirectories();
    this.loadSettings();
    this.loadState();
  }

  private ensureDirectories(): void {
    const dir = join(homedir(), '.ghostforge');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private log(level: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const entry = data
      ? `[${timestamp}] [${level.toUpperCase()}] ${message} ${JSON.stringify(data)}`
      : `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    const levelPriority: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levelPriority[level] >= levelPriority[this.settings.logLevel]) {
      appendFileSync(LOG_FILE, entry + '\n');
    }

    this.emit('log', { level, message, data, timestamp });
  }

  private loadSettings(): void {
    try {
      const settingsPath = join(homedir(), '.ghostforge', 'daemon-settings.json');
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, 'utf8');
        this.settings = { ...DEFAULT_DAEMON_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      this.log('warn', 'Could not load daemon settings, using defaults');
    }
  }

  private saveSettings(): void {
    try {
      const settingsPath = join(homedir(), '.ghostforge', 'daemon-settings.json');
      writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      this.log('error', 'Failed to save daemon settings', err);
    }
  }

  private loadState(): void {
    try {
      if (existsSync(STATE_FILE)) {
        const raw = readFileSync(STATE_FILE, 'utf8');
        const saved = JSON.parse(raw) as { restartCount?: number; lastSessionAt?: number };
        if (saved.restartCount !== undefined) {
          this.restartCount = saved.restartCount;
        }
      }
    } catch { /* ignore */ }
  }

  private saveState(): void {
    try {
      writeFileSync(STATE_FILE, JSON.stringify({
        restartCount: this.restartCount,
        lastSessionAt: Date.now(),
        lastState: this.state,
      }, null, 2));
    } catch { /* ignore */ }
  }

  private setState(newState: DaemonState): void {
    const prev = this.state;
    this.state = newState;
    this.log('info', `State transition: ${prev} → ${newState}`);
    this.emit('state-change', { from: prev, to: newState, timestamp: Date.now() });
    this.updateTrayMenu();
  }

  async start(mainWindow?: BrowserWindow | null): Promise<DaemonStatus> {
    if (this.state === 'RUNNING' || this.state === 'STARTING') {
      this.log('warn', 'Daemon already running or starting');
      return this.getStatus();
    }

    this.mainWindow = mainWindow ?? this.mainWindow;
    this.setState('STARTING');
    this.startedAt = Date.now();

    try {
      this.createTray();
      this.startHealthCheck();
      this.applyKeepAliveBehavior();

      if (this.settings.autoStartVoice) {
        this.startVoiceListening();
      }

      this.setState('RUNNING');
      this.log('info', 'JARVIS daemon started', {
        pid: process.pid,
        platform: process.platform,
        settings: this.settings,
      });

      this.saveState();
      this.emit('started', this.getStatus());
    } catch (err) {
      this.log('error', 'Failed to start daemon', err);
      this.setState('STOPPED');
      this.emit('error', err);
    }

    return this.getStatus();
  }

  async stop(): Promise<DaemonStatus> {
    if (this.state === 'STOPPED' || this.state === 'SHUTTING_DOWN') {
      return this.getStatus();
    }

    this.setState('SHUTTING_DOWN');
    this.log('info', 'Stopping JARVIS daemon');

    this.stopHealthCheck();
    this.stopVoiceListening();
    this.destroyTray();

    this.saveState();
    this.setState('STOPPED');
    this.emit('stopped', this.getStatus());

    return this.getStatus();
  }

  private applyKeepAliveBehavior(): void {
    if (!this.settings.keepAliveOnClose) return;

    if (process.platform === 'darwin') {
      app.dock?.hide();
      this.log('info', 'macOS: dock icon hidden, daemon persists in background');
    }
    // On Windows/Linux, the tray keeps the process alive
  }

  showWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();

      if (process.platform === 'darwin') {
        app.dock?.show();
      }
    }
  }

  hideWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.hide();

      if (this.settings.keepAliveOnClose && process.platform === 'darwin') {
        app.dock?.hide();
      }
    }
  }

  // ── System Tray ──────────────────────────────────────────────────────────

  private createTray(): void {
    if (this.tray) return;

    const icon = this.createDaemonIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip('GhostForge JARVIS Daemon');
    this.tray.on('click', () => {
      if (this.mainWindow?.isVisible()) {
        this.hideWindow();
      } else {
        this.showWindow();
      }
    });

    this.updateTrayMenu();
  }

  private updateTrayMenu(): void {
    if (!this.tray) return;

    const stateLabel: Record<DaemonState, string> = {
      STOPPED: 'Stopped',
      STARTING: 'Starting...',
      RUNNING: 'Running',
      PROCESSING: 'Processing Command',
      SHUTTING_DOWN: 'Shutting Down...',
    };

    const menu = Menu.buildFromTemplate([
      {
        label: `JARVIS Daemon: ${stateLabel[this.state]}`,
        enabled: false,
      },
      {
        label: `Uptime: ${this.formatUptime()}`,
        enabled: false,
      },
      {
        label: `Commands: ${this.commandsProcessed}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => this.showWindow(),
      },
      {
        label: this.state === 'RUNNING' ? 'Stop JARVIS' : 'Start JARVIS',
        click: () => {
          if (this.state === 'RUNNING') {
            this.stop();
          } else {
            this.start(this.mainWindow);
          }
        },
      },
      {
        label: this.voiceActive ? 'Voice: Active' : 'Voice: Inactive',
        enabled: false,
      },
      {
        label: this.voiceActive ? 'Stop Voice' : 'Start Voice',
        click: () => {
          if (this.voiceActive) {
            this.stopVoiceListening();
          } else {
            this.startVoiceListening();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          this.showWindow();
          this.mainWindow?.webContents.send('navigate', '/settings');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit JARVIS',
        click: () => {
          this.isQuitting = true;
          this.stop().then(() => app.quit());
        },
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  private createDaemonIcon(): Electron.NativeImage {
    const size = 22;
    const canvas = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = size / 2 - 1;

        if (dist < radius - 1) {
          const isActive = this.state === 'RUNNING' || this.state === 'PROCESSING';
          canvas[idx] = isActive ? 34 : 107;
          canvas[idx + 1] = isActive ? 197 : 114;
          canvas[idx + 2] = isActive ? 94 : 125;
          canvas[idx + 3] = 255;
        } else if (dist < radius) {
          canvas[idx] = 22;
          canvas[idx + 1] = 163;
          canvas[idx + 2] = 74;
          canvas[idx + 3] = 255;
        } else {
          canvas[idx] = 0;
          canvas[idx + 1] = 0;
          canvas[idx + 2] = 0;
          canvas[idx + 3] = 0;
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  private destroyTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  // ── Health Check ─────────────────────────────────────────────────────────

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.settings.healthCheckIntervalMs);

    this.log('debug', `Health check started (interval: ${this.settings.healthCheckIntervalMs}ms)`);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async performHealthCheck(): Promise<void> {
    this.lastHealthCheck = Date.now();

    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      this.log('debug', 'Health check', {
        heapUsedMB,
        state: this.state,
        voiceActive: this.voiceActive,
        commandsProcessed: this.commandsProcessed,
      });

      if (heapUsedMB > 512) {
        this.log('warn', `High memory usage: ${heapUsedMB}MB`);
        if (global.gc) {
          global.gc();
          this.log('info', 'Garbage collection triggered');
        }
      }

      this.emit('health-check', {
        timestamp: this.lastHealthCheck,
        heapUsedMB,
        state: this.state,
      });
    } catch (err) {
      this.log('error', 'Health check failed', err);
    }
  }

  // ── Background Voice Listening ────────────────────────────────────────────

  startVoiceListening(): void {
    if (this.voiceActive) return;

    this.voiceActive = true;
    this.log('info', 'Background voice listening activated');
    this.emit('voice:started');
    this.updateTrayMenu();

    this.voiceListeningTimer = setInterval(() => {
      if (this.state === 'RUNNING') {
        this.emit('voice:tick');
      }
    }, 1000);
  }

  stopVoiceListening(): void {
    if (!this.voiceActive) return;

    this.voiceActive = false;
    if (this.voiceListeningTimer) {
      clearInterval(this.voiceListeningTimer);
      this.voiceListeningTimer = null;
    }

    this.log('info', 'Background voice listening deactivated');
    this.emit('voice:stopped');
    this.updateTrayMenu();
  }

  async processVoiceCommand(transcript: string): Promise<string> {
    if (!transcript.trim()) return '';

    this.setState('PROCESSING');
    this.log('info', `Processing voice command: "${transcript}"`);
    this.emit('command:received', { transcript, timestamp: Date.now() });

    try {
      const response = await processCommand(transcript, {
        ollamaUrl: (app as any).getConfig?.()?.ollamaUrl,
        ollamaModel: (app as any).getConfig?.()?.ollamaModel,
      });

      this.commandsProcessed++;
      this.setState('RUNNING');

      this.emit('command:processed', {
        transcript,
        response: response.text,
        source: response.source,
        timestamp: Date.now(),
      });

      this.log('info', `Command processed via ${response.source}`, {
        transcript,
        responseLength: response.text.length,
      });

      return response.text;
    } catch (err) {
      this.log('error', 'Command processing failed', err);
      this.setState('RUNNING');
      return 'Sorry, I encountered an error processing that command.';
    }
  }

  // ── Auto-restart on crash ────────────────────────────────────────────────

  async handleCrash(error: Error): Promise<void> {
    this.log('error', 'Main process crash detected', {
      message: error.message,
      stack: error.stack,
      restartCount: this.restartCount,
    });

    if (this.restartCount >= this.settings.maxRestartAttempts) {
      this.log('error', `Max restart attempts (${this.settings.maxRestartAttempts}) reached. Giving up.`);
      this.emit('restart:failed', { restartCount: this.restartCount });
      return;
    }

    this.restartCount++;
    const backoff = this.settings.restartBackoffMs * Math.pow(2, this.restartCount - 1);
    this.log('info', `Auto-restarting in ${backoff}ms (attempt ${this.restartCount})`);
    this.emit('restart:attempt', { attempt: this.restartCount, backoff });

    setTimeout(async () => {
      try {
        await this.stop();
        await this.start(this.mainWindow);
        this.emit('restart:success', { attempt: this.restartCount });
      } catch (err) {
        this.log('error', 'Restart failed', err);
        this.emit('restart:failed', { attempt: this.restartCount, error: err });
      }
    }, backoff);
  }

  // ── Graceful Shutdown ────────────────────────────────────────────────────

  async gracefulShutdown(): Promise<void> {
    this.log('info', 'Initiating graceful shutdown');

    this.isQuitting = true;

    try {
      await this.stop();
      this.log('info', 'Graceful shutdown complete');
    } catch (err) {
      this.log('error', 'Error during graceful shutdown', err);
    }
  }

  // ── IPC Registration ─────────────────────────────────────────────────────

  registerIPC(): void {
    ipcMain.handle('daemon:start', async () => {
      return this.start(this.mainWindow);
    });

    ipcMain.handle('daemon:stop', async () => {
      return this.stop();
    });

    ipcMain.handle('daemon:status', () => {
      return this.getStatus();
    });

    ipcMain.handle('daemon:get-settings', () => {
      return this.settings;
    });

    ipcMain.handle('daemon:set-settings', (_event, updates: Partial<DaemonSettings>) => {
      this.settings = { ...this.settings, ...updates };
      this.saveSettings();
      this.log('info', 'Daemon settings updated', updates);
      return this.settings;
    });

    ipcMain.handle('daemon:start-voice', () => {
      this.startVoiceListening();
      return { success: true };
    });

    ipcMain.handle('daemon:stop-voice', () => {
      this.stopVoiceListening();
      return { success: true };
    });

    ipcMain.handle('daemon:process-command', async (_event, transcript: string) => {
      return this.processVoiceCommand(transcript);
    });

    ipcMain.handle('daemon:show-window', () => {
      this.showWindow();
      return { success: true };
    });

    ipcMain.handle('daemon:hide-window', () => {
      this.hideWindow();
      return { success: true };
    });

    ipcMain.handle('daemon:get-logs', (_event, lines?: number) => {
      return this.getLogs(lines ?? 100);
    });

    ipcMain.handle('daemon:clear-logs', () => {
      try {
        writeFileSync(LOG_FILE, '');
        return { success: true };
      } catch {
        return { success: false };
      }
    });
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private formatUptime(): string {
    if (!this.startedAt) return '0s';
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  private getLogs(lines: number): string[] {
    try {
      if (!existsSync(LOG_FILE)) return [];
      const content = readFileSync(LOG_FILE, 'utf8');
      const allLines = content.split('\n').filter(Boolean);
      return allLines.slice(-lines);
    } catch {
      return [];
    }
  }

  getStatus(): DaemonStatus {
    return {
      state: this.state,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      startedAt: this.startedAt,
      lastHealthCheck: this.lastHealthCheck,
      voiceActive: this.voiceActive,
      commandsProcessed: this.commandsProcessed,
      restartCount: this.restartCount,
      pid: process.pid,
      platform: process.platform,
    };
  }

  getState(): DaemonState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state === 'RUNNING' || this.state === 'PROCESSING';
  }

  isVoiceActive(): boolean {
    return this.voiceActive;
  }

  destroy(): void {
    this.isQuitting = true;
    this.stopHealthCheck();
    this.stopVoiceListening();
    this.destroyTray();
    this.removeAllListeners();
  }
}

let daemonInstance: JarvisDaemon | null = null;

export function getDaemon(): JarvisDaemon {
  if (!daemonInstance) {
    daemonInstance = new JarvisDaemon();
  }
  return daemonInstance;
}
