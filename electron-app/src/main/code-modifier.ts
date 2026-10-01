import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'fs';
import { join, relative, dirname } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

const PROJECT_ROOT = join(__dirname, '..', '..', '..');

const PROTECTED_PATHS = [
  '.git',
  'node_modules',
  'dist',
  'release',
  '.env',
  '.env.local',
  'package-lock.json',
];

const CRITICAL_FILES = [
  'package.json',
  'tsconfig.json',
  'electron-builder.yml',
  'src/main/index.ts',
  'src/preload/index.ts',
];

export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  content: string;
}

export interface CodeChange {
  filePath: string;
  action: 'create' | 'edit' | 'delete';
  oldContent?: string;
  newContent?: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

export interface ProjectAnalysis {
  root: string;
  files: Array<{ path: string; size: number; modified: number }>;
  directories: string[];
  languages: Record<string, number>;
  totalFiles: number;
  totalSizeBytes: number;
}

export class CodeModifier extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private changeHistory: CodeChange[] = [];
  private requireConfirmation = true;

  constructor() {
    super();
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  private log(message: string, data?: unknown): void {
    this.emit('log', { message, data, timestamp: new Date().toISOString() });
  }

  private isProtectedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return PROTECTED_PATHS.some(p => normalized.startsWith(p) || normalized.includes(`/${p}/`));
  }

  private isCriticalFile(filePath: string): boolean {
    return CRITICAL_FILES.some(f => filePath.endsWith(f));
  }

  private resolvePath(filePath: string): string {
    const resolved = join(PROJECT_ROOT, filePath);
    const normalized = resolved.replace(/\\/g, '/');
    const root = PROJECT_ROOT.replace(/\\/g, '/');

    if (!normalized.startsWith(root)) {
      throw new Error('Path traversal detected');
    }

    return resolved;
  }

  // ── Read any file in the project ─────────────────────────────────────────

  async readFile(filePath: string): Promise<{ content: string; path: string; size: number; modified: number }> {
    const fullPath = this.resolvePath(filePath);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileSync(fullPath, 'utf8');
    const stats = statSync(fullPath);

    this.log(`Read file: ${filePath}`);
    return {
      content,
      path: filePath,
      size: stats.size,
      modified: stats.mtimeMs,
    };
  }

  // ── Edit files with diff-based changes ───────────────────────────────────

  async editFile(
    filePath: string,
    oldContent: string,
    newContent: string,
    options: { confirm?: boolean; commitMessage?: string } = {}
  ): Promise<CodeChange> {
    const fullPath = this.resolvePath(filePath);

    if (this.isProtectedPath(filePath)) {
      const change: CodeChange = {
        filePath,
        action: 'edit',
        oldContent,
        newContent,
        timestamp: Date.now(),
        success: false,
        error: 'Protected path: cannot modify',
      };
      return change;
    }

    if (options.confirm !== false && this.isCriticalFile(filePath)) {
      const confirmed = await this.askConfirmation(
        `Modify critical file: ${filePath}`,
        'This is a critical system file. Are you sure you want to modify it?'
      );
      if (!confirmed) {
        return {
          filePath,
          action: 'edit',
          timestamp: Date.now(),
          success: false,
          error: 'Cancelled by user',
        };
      }
    }

    try {
      if (!existsSync(fullPath)) {
        return {
          filePath,
          action: 'edit',
          oldContent,
          newContent,
          timestamp: Date.now(),
          success: false,
          error: 'File does not exist. Use create instead.',
        };
      }

      const currentContent = readFileSync(fullPath, 'utf8');
      if (oldContent && !currentContent.includes(oldContent)) {
        return {
          filePath,
          action: 'edit',
          oldContent,
          newContent,
          timestamp: Date.now(),
          success: false,
          error: 'Old content not found in file',
        };
      }

      let finalContent: string;
      if (oldContent) {
        finalContent = currentContent.replace(oldContent, newContent);
      } else {
        finalContent = newContent;
      }

      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      copyFileSync(fullPath, fullPath + '.bak');
      writeFileSync(fullPath, finalContent);

      if (options.commitMessage) {
        await this.gitCommit(filePath, options.commitMessage);
      }

      const change: CodeChange = {
        filePath,
        action: 'edit',
        oldContent: currentContent,
        newContent: finalContent,
        timestamp: Date.now(),
        success: true,
      };
      this.changeHistory.push(change);
      this.emit('file-edited', change);
      this.log(`File edited: ${filePath}`);

      return change;
    } catch (err) {
      const change: CodeChange = {
        filePath,
        action: 'edit',
        oldContent,
        newContent,
        timestamp: Date.now(),
        success: false,
        error: (err as Error).message,
      };
      this.changeHistory.push(change);
      this.log(`File edit failed: ${filePath}`, err);
      return change;
    }
  }

  // ── Create new files ─────────────────────────────────────────────────────

  async createFile(
    filePath: string,
    content: string,
    options: { commitMessage?: string } = {}
  ): Promise<CodeChange> {
    const fullPath = this.resolvePath(filePath);

    if (this.isProtectedPath(filePath)) {
      return {
        filePath,
        action: 'create',
        newContent: content,
        timestamp: Date.now(),
        success: false,
        error: 'Protected path: cannot create',
      };
    }

    try {
      if (existsSync(fullPath)) {
        return {
          filePath,
          action: 'create',
          newContent: content,
          timestamp: Date.now(),
          success: false,
          error: 'File already exists. Use edit instead.',
        };
      }

      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(fullPath, content);

      if (options.commitMessage) {
        await this.gitCommit(filePath, options.commitMessage);
      }

      const change: CodeChange = {
        filePath,
        action: 'create',
        newContent: content,
        timestamp: Date.now(),
        success: true,
      };
      this.changeHistory.push(change);
      this.emit('file-created', change);
      this.log(`File created: ${filePath}`);

      return change;
    } catch (err) {
      return {
        filePath,
        action: 'create',
        newContent: content,
        timestamp: Date.now(),
        success: false,
        error: (err as Error).message,
      };
    }
  }

  // ── Delete files ─────────────────────────────────────────────────────────

  async deleteFile(
    filePath: string,
    options: { confirm?: boolean; commitMessage?: string } = {}
  ): Promise<CodeChange> {
    const fullPath = this.resolvePath(filePath);

    if (this.isProtectedPath(filePath)) {
      return {
        filePath,
        action: 'delete',
        timestamp: Date.now(),
        success: false,
        error: 'Protected path: cannot delete',
      };
    }

    if (options.confirm !== false && this.isCriticalFile(filePath)) {
      const confirmed = await this.askConfirmation(
        `Delete critical file: ${filePath}`,
        'This is a critical system file. Are you sure you want to delete it?'
      );
      if (!confirmed) {
        return {
          filePath,
          action: 'delete',
          timestamp: Date.now(),
          success: false,
          error: 'Cancelled by user',
        };
      }
    }

    try {
      if (!existsSync(fullPath)) {
        return {
          filePath,
          action: 'delete',
          timestamp: Date.now(),
          success: false,
          error: 'File does not exist',
        };
      }

      const content = readFileSync(fullPath, 'utf8');
      unlinkSync(fullPath);

      if (options.commitMessage) {
        await this.gitCommit(filePath, options.commitMessage);
      }

      const change: CodeChange = {
        filePath,
        action: 'delete',
        oldContent: content,
        timestamp: Date.now(),
        success: true,
      };
      this.changeHistory.push(change);
      this.emit('file-deleted', change);
      this.log(`File deleted: ${filePath}`);

      return change;
    } catch (err) {
      return {
        filePath,
        action: 'delete',
        timestamp: Date.now(),
        success: false,
        error: (err as Error).message,
      };
    }
  }

  // ── Run npm install after package.json changes ───────────────────────────

  async runNpmInstall(): Promise<{ success: boolean; output: string }> {
    try {
      this.log('Running npm install');
      const { stdout } = await execAsync('npm install', {
        cwd: PROJECT_ROOT,
        timeout: 120_000,
      });
      this.log('npm install complete');
      return { success: true, output: stdout };
    } catch (err) {
      this.log('npm install failed', err);
      return { success: false, output: (err as Error).message };
    }
  }

  // ── Run build after code changes ─────────────────────────────────────────

  async runBuild(): Promise<{ success: boolean; output: string }> {
    try {
      this.log('Running build');
      const electronAppDir = join(PROJECT_ROOT, 'electron-app');
      const { stdout } = await execAsync('npm run build', {
        cwd: existsSync(join(electronAppDir, 'package.json')) ? electronAppDir : PROJECT_ROOT,
        timeout: 120_000,
      });
      this.log('Build complete');
      return { success: true, output: stdout };
    } catch (err) {
      this.log('Build failed', err);
      return { success: false, output: (err as Error).message };
    }
  }

  // ── Restart app after critical changes ───────────────────────────────────

  async restartApp(): Promise<void> {
    this.log('Restarting application');
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 1000);
  }

  // ── Git commit changes ───────────────────────────────────────────────────

  private async gitCommit(filePath: string, message: string): Promise<void> {
    try {
      await execAsync(`git add "${filePath}"`, { cwd: PROJECT_ROOT });
      await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: PROJECT_ROOT });
      this.log(`Committed: ${message}`);
    } catch (err) {
      this.log('Git commit failed', err);
    }
  }

  // ── Rollback changes ─────────────────────────────────────────────────────

  async rollbackLastChange(): Promise<boolean> {
    const lastChange = this.changeHistory[this.changeHistory.length - 1];
    if (!lastChange) return false;

    const fullPath = this.resolvePath(lastChange.filePath);

    try {
      if (lastChange.action === 'edit' && existsSync(fullPath + '.bak')) {
        copyFileSync(fullPath + '.bak', fullPath);
        this.log(`Rolled back edit: ${lastChange.filePath}`);
        return true;
      }

      if (lastChange.action === 'create' && existsSync(fullPath)) {
        unlinkSync(fullPath);
        this.log(`Rolled back create: ${lastChange.filePath}`);
        return true;
      }

      if (lastChange.action === 'delete' && lastChange.oldContent) {
        const dir = dirname(fullPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, lastChange.oldContent);
        this.log(`Rolled back delete: ${lastChange.filePath}`);
        return true;
      }

      return false;
    } catch (err) {
      this.log('Rollback failed', err);
      return false;
    }
  }

  // ── Code analysis ────────────────────────────────────────────────────────

  async searchFiles(pattern: string, directory?: string): Promise<Array<{ path: string; matches: number }>> {
    const searchDir = directory ? this.resolvePath(directory) : PROJECT_ROOT;

    try {
      const { stdout } = await execAsync(
        `grep -rl "${pattern.replace(/"/g, '\\"')}" "${searchDir}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" 2>/dev/null | head -100`,
        { cwd: PROJECT_ROOT }
      );

      const files = stdout.trim().split('\n').filter(Boolean);
      const results: Array<{ path: string; matches: number }> = [];

      for (const file of files) {
        const relPath = relative(PROJECT_ROOT, file);
        const { stdout: countOut } = await execAsync(
          `grep -c "${pattern.replace(/"/g, '\\"')}" "${file}" 2>/dev/null || echo 0`
        );
        results.push({
          path: relPath,
          matches: parseInt(countOut.trim(), 10) || 0,
        });
      }

      return results;
    } catch {
      return [];
    }
  }

  async getProjectStructure(): Promise<ProjectAnalysis> {
    try {
      const { stdout: filesOutput } = await execAsync(
        `find "${PROJECT_ROOT}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/release/*" -not -path "*/.aider*/*" 2>/dev/null | head -500`,
        { cwd: PROJECT_ROOT }
      );

      const fileList = filesOutput.trim().split('\n').filter(Boolean);
      const languages: Record<string, number> = {};
      let totalSize = 0;

      const files = fileList.map(f => {
        const relPath = relative(PROJECT_ROOT, f);
        try {
          const stats = statSync(f);
          const ext = relPath.split('.').pop() || 'unknown';
          languages[ext] = (languages[ext] || 0) + 1;
          totalSize += stats.size;
          return { path: relPath, size: stats.size, modified: stats.mtimeMs };
        } catch {
          return { path: relPath, size: 0, modified: 0 };
        }
      });

      const { stdout: dirsOutput } = await execAsync(
        `find "${PROJECT_ROOT}" -type d -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/release/*" 2>/dev/null | head -100`,
        { cwd: PROJECT_ROOT }
      );
      const directories = dirsOutput.trim().split('\n').filter(Boolean).map(d => relative(PROJECT_ROOT, d));

      return {
        root: PROJECT_ROOT,
        files,
        directories,
        languages,
        totalFiles: files.length,
        totalSizeBytes: totalSize,
      };
    } catch (err) {
      this.log('Project structure analysis failed', err);
      return {
        root: PROJECT_ROOT,
        files: [],
        directories: [],
        languages: {},
        totalFiles: 0,
        totalSizeBytes: 0,
      };
    }
  }

  // ── User confirmation ────────────────────────────────────────────────────

  private async askConfirmation(title: string, message: string): Promise<boolean> {
    if (!this.mainWindow) return false;

    const response = await dialog.showMessageBox(this.mainWindow, {
      type: 'warning',
      buttons: ['Confirm', 'Cancel'],
      defaultId: 1,
      title,
      message,
    });

    return response.response === 0;
  }

  // ── Change history ───────────────────────────────────────────────────────

  getChangeHistory(): CodeChange[] {
    return [...this.changeHistory];
  }

  clearChangeHistory(): void {
    this.changeHistory = [];
  }

  // ── IPC Registration ─────────────────────────────────────────────────────

  registerIPC(): void {
    ipcMain.handle('code:read-file', async (_event, filePath: string) => {
      return this.readFile(filePath);
    });

    ipcMain.handle('code:edit-file', async (
      _event,
      filePath: string,
      oldContent: string,
      newContent: string,
      options?: { confirm?: boolean; commitMessage?: string }
    ) => {
      return this.editFile(filePath, oldContent, newContent, options);
    });

    ipcMain.handle('code:create-file', async (
      _event,
      filePath: string,
      content: string,
      options?: { commitMessage?: string }
    ) => {
      return this.createFile(filePath, content, options);
    });

    ipcMain.handle('code:delete-file', async (
      _event,
      filePath: string,
      options?: { confirm?: boolean; commitMessage?: string }
    ) => {
      return this.deleteFile(filePath, options);
    });

    ipcMain.handle('code:search', async (_event, pattern: string, directory?: string) => {
      return this.searchFiles(pattern, directory);
    });

    ipcMain.handle('code:structure', async () => {
      return this.getProjectStructure();
    });

    ipcMain.handle('code:rollback', async () => {
      return this.rollbackLastChange();
    });

    ipcMain.handle('code:history', () => {
      return this.getChangeHistory();
    });

    ipcMain.handle('code:run-install', async () => {
      return this.runNpmInstall();
    });

    ipcMain.handle('code:run-build', async () => {
      return this.runBuild();
    });

    ipcMain.handle('code:restart-app', async () => {
      await this.restartApp();
      return { success: true };
    });
  }

  destroy(): void {
    this.removeAllListeners();
  }
}
