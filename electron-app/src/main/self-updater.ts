import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { exec, spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface UpdateInfo {
  currentVersion: string;
  remoteVersion: string;
  hasUpdate: boolean;
  currentCommit: string;
  remoteCommit: string;
  changelog: string;
  filesChanged: string[];
  behind: number;
  timestamp: number;
}

export interface UpdateProgress {
  phase: 'checking' | 'backing-up' | 'pulling' | 'installing' | 'building' | 'restarting' | 'complete' | 'error';
  message: string;
  percent: number;
  timestamp: number;
}

const DATA_DIR = process.env.GHOSTFORGE_DATA_DIR || join(homedir(), '.ghostforge');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const UPDATE_LOG = join(DATA_DIR, 'update.log');
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

export class SelfUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private isUpdating = false;
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null;
  private autoCheckIntervalMs = 6 * 60 * 60 * 1000;
  private lastCheckTime = 0;

  constructor() {
    super();
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  private log(message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const entry = data
      ? `[${timestamp}] ${message} ${JSON.stringify(data)}`
      : `[${timestamp}] ${message}`;

    try {
      const dir = DATA_DIR;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      require('fs').appendFileSync(UPDATE_LOG, entry + '\n');
    } catch { /* ignore */ }

    this.emit('log', { message, data, timestamp });
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  // ── Auto-update check ────────────────────────────────────────────────────

  startAutoCheck(intervalMs?: number): void {
    this.stopAutoCheck();
    if (intervalMs) this.autoCheckIntervalMs = intervalMs;

    this.autoCheckTimer = setInterval(() => {
      this.checkForUpdates().catch(err => {
        this.log('Auto-check failed', err);
      });
    }, this.autoCheckIntervalMs);

    this.log(`Auto-update check started (interval: ${this.autoCheckIntervalMs / 1000 / 60}min)`);
  }

  stopAutoCheck(): void {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = null;
    }
  }

  // ── Version tracking ─────────────────────────────────────────────────────

  private async getCurrentVersion(): Promise<{ version: string; commit: string }> {
    try {
      const pkgPath = join(PROJECT_ROOT, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
      const { stdout: commit } = await execAsync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT });
      return { version: pkg.version, commit: commit.trim() };
    } catch (err) {
      this.log('Failed to get current version', err);
      return { version: 'unknown', commit: 'unknown' };
    }
  }

  private async getRemoteVersion(): Promise<{ version: string; commit: string; behind: number }> {
    try {
      await execAsync('git fetch origin', { cwd: PROJECT_ROOT, timeout: 30_000 });

      const { stdout: remoteCommit } = await execAsync(
        'git rev-parse --short origin/main',
        { cwd: PROJECT_ROOT }
      );

      const { stdout: behind } = await execAsync(
        'git rev-list HEAD..origin/main --count',
        { cwd: PROJECT_ROOT }
      );

      let remoteVersion = 'unknown';
      try {
        const { stdout: pkgRaw } = await execAsync(
          'git show origin/main:package.json',
          { cwd: PROJECT_ROOT }
        );
        const remotePkg = JSON.parse(pkgRaw) as { version: string };
        remoteVersion = remotePkg.version;
      } catch { /* package.json may not exist on remote */ }

      return {
        version: remoteVersion,
        commit: remoteCommit.trim(),
        behind: parseInt(behind.trim(), 10) || 0,
      };
    } catch (err) {
      this.log('Failed to get remote version', err);
      return { version: 'unknown', commit: 'unknown', behind: 0 };
    }
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    this.log('Checking for updates...');
    this.emit('phase', { phase: 'checking', message: 'Checking for updates...', percent: 0 });

    const [local, remote] = await Promise.all([
      this.getCurrentVersion(),
      this.getRemoteVersion(),
    ]);

    let changelog = '';
    let filesChanged: string[] = [];

    if (remote.behind > 0) {
      try {
        const { stdout } = await execAsync(
          'git log HEAD..origin/main --oneline',
          { cwd: PROJECT_ROOT }
        );
        changelog = stdout.trim();

        const { stdout: files } = await execAsync(
          'git diff HEAD..origin/main --name-only',
          { cwd: PROJECT_ROOT }
        );
        filesChanged = files.trim().split('\n').filter(Boolean);
      } catch { /* ignore */ }
    }

    const info: UpdateInfo = {
      currentVersion: local.version,
      remoteVersion: remote.version,
      hasUpdate: remote.behind > 0,
      currentCommit: local.commit,
      remoteCommit: remote.commit,
      changelog,
      filesChanged,
      behind: remote.behind,
      timestamp: Date.now(),
    };

    this.lastCheckTime = Date.now();
    this.log('Update check complete', info);
    this.emit('update-available', info);

    return info;
  }

  // ── Backup before update ─────────────────────────────────────────────────

  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup-${timestamp}`;
    const backupPath = join(BACKUP_DIR, backupName);

    this.emit('phase', { phase: 'backing-up', message: 'Creating backup...', percent: 20 });
    this.log(`Creating backup: ${backupName}`);

    try {
      mkdirSync(backupPath, { recursive: true });

      await execAsync(
        `git stash push -m "auto-backup-${backupName}"`,
        { cwd: PROJECT_ROOT }
      );

      const { stdout: stashList } = await execAsync(
        'git stash list',
        { cwd: PROJECT_ROOT }
      );
      writeFileSync(join(backupPath, 'stash-info.txt'), stashList);

      this.log(`Backup created: ${backupPath}`);
      return backupPath;
    } catch (err) {
      this.log('Backup creation failed', err);
      throw err;
    }
  }

  // ── Pull updates ─────────────────────────────────────────────────────────

  private async pullUpdates(): Promise<void> {
    this.emit('phase', { phase: 'pulling', message: 'Pulling latest changes...', percent: 40 });
    this.log('Pulling updates from origin/main');

    try {
      const { stdout, stderr } = await execAsync(
        'git pull origin main',
        { cwd: PROJECT_ROOT, timeout: 60_000 }
      );
      this.log('Git pull output', { stdout: stdout.trim(), stderr: stderr.trim() });
    } catch (err) {
      this.log('Git pull failed', err);
      throw err;
    }
  }

  // ── Install dependencies ─────────────────────────────────────────────────

  private async installDependencies(): Promise<void> {
    this.emit('phase', { phase: 'installing', message: 'Installing dependencies...', percent: 60 });
    this.log('Running npm install');

    try {
      const { stdout } = await execAsync('npm install', {
        cwd: PROJECT_ROOT,
        timeout: 120_000,
      });
      this.log('npm install complete', { output: stdout.slice(-200) });
    } catch (err) {
      this.log('npm install failed', err);
      throw err;
    }
  }

  // ── Build ────────────────────────────────────────────────────────────────

  private async build(): Promise<void> {
    this.emit('phase', { phase: 'building', message: 'Building application...', percent: 75 });
    this.log('Building application');

    try {
      const electronAppDir = join(PROJECT_ROOT, 'electron-app');
      if (existsSync(join(electronAppDir, 'package.json'))) {
        await execAsync('npm run build', {
          cwd: electronAppDir,
          timeout: 120_000,
        });
        this.log('Electron app build complete');
      }
    } catch (err) {
      this.log('Build failed', err);
      throw err;
    }
  }

  // ── Rollback on failure ──────────────────────────────────────────────────

  private async rollback(): Promise<void> {
    this.log('Rolling back changes');
    this.emit('phase', { phase: 'error', message: 'Rolling back...', percent: 90 });

    try {
      await execAsync('git checkout .', { cwd: PROJECT_ROOT });

      const { stdout: stashList } = await execAsync(
        'git stash list',
        { cwd: PROJECT_ROOT }
      );

      if (stashList.trim()) {
        await execAsync('git stash pop', { cwd: PROJECT_ROOT });
      }

      this.log('Rollback complete');
    } catch (err) {
      this.log('Rollback failed', err);
    }
  }

  // ── Apply update (full flow) ─────────────────────────────────────────────

  async applyUpdate(userConfirm: boolean = true): Promise<boolean> {
    if (this.isUpdating) {
      this.log('Update already in progress');
      return false;
    }

    const updateInfo = await this.checkForUpdates();
    if (!updateInfo.hasUpdate) {
      this.log('No updates available');
      return false;
    }

    if (userConfirm && this.mainWindow) {
      const response = await dialog.showMessageBox(this.mainWindow, {
        type: 'question',
        buttons: ['Update Now', 'Cancel'],
        defaultId: 0,
        title: 'Update Available',
        message: `Version ${updateInfo.remoteVersion} is available`,
        detail: `Current: ${updateInfo.currentVersion} (${updateInfo.currentCommit})\n` +
                `Remote: ${updateInfo.remoteVersion} (${updateInfo.remoteCommit})\n\n` +
                `Changes:\n${updateInfo.changelog.slice(0, 500)}`,
      });

      if (response.response !== 0) {
        this.log('Update cancelled by user');
        return false;
      }
    }

    this.isUpdating = true;

    try {
      await this.createBackup();
      await this.pullUpdates();
      await this.installDependencies();
      await this.build();

      this.emit('phase', { phase: 'restarting', message: 'Restarting application...', percent: 95 });
      this.log('Update applied successfully, restarting...');

      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 2000);

      return true;
    } catch (err) {
      this.log('Update failed, rolling back', err);
      await this.rollback();
      this.emit('phase', { phase: 'error', message: `Update failed: ${err}`, percent: 0 });
      this.isUpdating = false;
      return false;
    }
  }

  // ── Self-modify: edit own source, rebuild, restart ───────────────────────

  async selfModify(
    filePath: string,
    newContent: string,
    options: { rebuild?: boolean; restart?: boolean; commitMessage?: string } = {}
  ): Promise<boolean> {
    const { rebuild = false, restart = false, commitMessage } = options;

    this.log(`Self-modifying: ${filePath}`);

    const fullPath = join(PROJECT_ROOT, filePath);

    if (!fullPath.startsWith(PROJECT_ROOT)) {
      this.log('Security: path traversal blocked');
      return false;
    }

    const protectedPaths = ['.git', 'node_modules', 'dist', 'release', '.env'];
    if (protectedPaths.some(p => filePath.includes(p))) {
      this.log(`Security: protected path blocked - ${filePath}`);
      return false;
    }

    try {
      const backupContent = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : null;

      const dir = join(fullPath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(fullPath, newContent);
      this.log(`File modified: ${filePath}`);

      if (rebuild) {
        await this.build();
      }

      if (commitMessage) {
        await execFileAsync('git', ['add', filePath], { cwd: PROJECT_ROOT });
        await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: PROJECT_ROOT });
        this.log(`Changes committed: ${commitMessage}`);
      }

      if (restart) {
        this.emit('phase', { phase: 'restarting', message: 'Restarting after self-modification...', percent: 100 });
        setTimeout(() => {
          app.relaunch();
          app.quit();
        }, 1000);
      }

      return true;
    } catch (err) {
      this.log(`Self-modification failed: ${filePath}`, err);
      return false;
    }
  }

  // ── Code analysis ────────────────────────────────────────────────────────

  async analyzeProject(): Promise<{
    structure: string[];
    totalFiles: number;
    totalSize: string;
    languages: Record<string, number>;
  }> {
    try {
      const { stdout: files } = await execAsync(
        `find "${PROJECT_ROOT}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/release/*" | head -500`,
        { cwd: PROJECT_ROOT }
      );

      const fileList = files.trim().split('\n').filter(Boolean);
      const languages: Record<string, number> = {};

      for (const file of fileList) {
        const ext = file.split('.').pop() || 'unknown';
        languages[ext] = (languages[ext] || 0) + 1;
      }

      const { stdout: size } = await execAsync(
        `du -sh "${PROJECT_ROOT}" --exclude=node_modules --exclude=.git --exclude=dist --exclude=release 2>/dev/null || echo "unknown"`,
        { cwd: PROJECT_ROOT }
      );

      const structure = fileList
        .map(f => f.replace(PROJECT_ROOT + '/', ''))
        .slice(0, 100);

      return {
        structure,
        totalFiles: fileList.length,
        totalSize: size.trim().split('\t')[0] || 'unknown',
        languages,
      };
    } catch (err) {
      this.log('Project analysis failed', err);
      return { structure: [], totalFiles: 0, totalSize: 'unknown', languages: {} };
    }
  }

  // ── IPC Registration ─────────────────────────────────────────────────────

  registerIPC(): void {
    ipcMain.handle('updater:check', async () => {
      return this.checkForUpdates();
    });

    ipcMain.handle('updater:update', async (_event, userConfirm?: boolean) => {
      return this.applyUpdate(userConfirm ?? true);
    });

    ipcMain.handle('updater:start-auto-check', (_event, intervalMs?: number) => {
      this.startAutoCheck(intervalMs);
      return { success: true };
    });

    ipcMain.handle('updater:stop-auto-check', () => {
      this.stopAutoCheck();
      return { success: true };
    });

    ipcMain.handle('updater:self-modify', async (
      _event,
      filePath: string,
      newContent: string,
      options?: { rebuild?: boolean; restart?: boolean; commitMessage?: string }
    ) => {
      return this.selfModify(filePath, newContent, options);
    });

    ipcMain.handle('updater:analyze-project', async () => {
      return this.analyzeProject();
    });

    ipcMain.handle('updater:read-file', async (_event, filePath: string) => {
      const fullPath = join(PROJECT_ROOT, filePath);
      if (!fullPath.startsWith(PROJECT_ROOT)) {
        return { error: 'Path traversal blocked' };
      }
      try {
        const content = readFileSync(fullPath, 'utf8');
        return { content, path: filePath };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('updater:version', async () => {
      return this.getCurrentVersion();
    });
  }

  destroy(): void {
    this.stopAutoCheck();
    this.removeAllListeners();
  }
}
