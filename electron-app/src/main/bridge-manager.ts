import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { net } from 'electron';
import { getBridgeAuthHeaders, getHealthEndpoint } from './bridge-auth';

const BRIDGE_PORT = 8765;
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`;
const HEALTH_ENDPOINT = getHealthEndpoint(BRIDGE_URL, 'mark-l');
const MAX_LOG_LINES = 1000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 2000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;
const TERMINATE_TIMEOUT_MS = 1000;

const STORE_KEY = 'jarvis.autoStartBridge';

export type BridgeStatus = 'starting' | 'running' | 'stopped' | 'error';

class BridgeManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: BridgeStatus = 'stopped';
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPromise: Promise<void> | null = null;
  private logs: string[] = [];
  private killed = false;

  private getStore(): any {
    const Store = require('electron-store');
    return new Store({ name: 'ghostforge-settings' });
  }

  private appendLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs = this.logs.slice(-MAX_LOG_LINES);
    }
  }

  private setStatus(s: BridgeStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  getBridgeUrl(): string {
    return BRIDGE_URL;
  }

  getBridgeStatus(): BridgeStatus {
    return this.status;
  }

  getBridgeLogs(): string[] {
    return [...this.logs];
  }

  isAutoStartEnabled(): boolean {
    try {
      return this.getStore().get(STORE_KEY, true) as boolean;
    } catch {
      return true;
    }
  }

  setAutoStart(enabled: boolean): void {
    this.getStore().set(STORE_KEY, enabled);
  }

  async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = net.request({
        url: getHealthEndpoint(`http://localhost:${port}`, 'mark-l'),
        headers: getBridgeAuthHeaders(),
      });
      req.on('response', () => resolve(false));
      req.on('error', () => resolve(true));
      req.on('abort', () => resolve(true));
      req.end();
    });
  }

  async waitForBridge(timeout = 30_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.status === 'error') return false;
      if (this.status === 'running') return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return this.status === 'running';
  }

  async startBridge(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return;

    const portFree = await this.isPortAvailable(BRIDGE_PORT);
    if (!portFree) {
      this.appendLog(`[bridge-manager] Port ${BRIDGE_PORT} already in use — assuming external instance.`);
      this.setStatus('running');
      return;
    }

    this.killed = false;
    this.retryCount = 0;
    this.setStatus('starting');
    this.spawnProcess();
  }

  /** Packaged builds ship the bridge as an extraResource; dev runs use the repo copy */
  private resolveBridgeDir(): string {
    const bundled = join(process.resourcesPath || '', 'mark-l-bridge');
    if (existsSync(join(bundled, 'server.py'))) return bundled;
    return join(__dirname, '..', '..', '..', 'mark-l-bridge');
  }

  private spawnProcess(): void {
    const bridgeDir = this.resolveBridgeDir();
    const isWin = process.platform === 'win32';

    let cmd: string;
    let args: string[];
    const opts = { cwd: bridgeDir, stdio: ['pipe', 'pipe', 'pipe'] as any, windowsHide: true };

    if (isWin) {
      cmd = 'python';
      args = ['server.py'];
    } else {
      // Run through bash so a lost exec bit in the packaged copy doesn't matter
      cmd = 'bash';
      args = [join(bridgeDir, 'start.sh'), '--managed'];
      opts.cwd = bridgeDir;
    }

    this.appendLog(`[bridge-manager] Spawning: ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, opts);
    this.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.appendLog(`[bridge:stdout] ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.appendLog(`[bridge:stderr] ${line}`);
      }
    });

    child.on('error', (err) => {
      this.appendLog(`[bridge-manager] Process error: ${err.message}`);
      if (this.killed) {
        this.setStatus('stopped');
        return;
      }
      this.setStatus('error');
      this.emit('error', err);
      this.scheduleRetry();
    });

    child.on('exit', (code, signal) => {
      this.appendLog(`[bridge-manager] Process exited (code=${code}, signal=${signal})`);
      this.process = null;
      if (this.killed) {
        this.setStatus('stopped');
        return;
      }
      if (code !== 0 && signal !== 'SIGTERM') {
        this.setStatus('error');
        this.scheduleRetry();
      } else {
        this.setStatus('stopped');
      }
    });

    this.pollHealth(30_000);
  }

  private pollHealth(timeout: number): void {
    const start = Date.now();
    const attempt = () => {
      if (Date.now() - start > timeout || this.status === 'error' || this.status === 'stopped') return;
      const req = net.request({
        url: HEALTH_ENDPOINT,
        headers: getBridgeAuthHeaders(),
      });
      req.on('response', (res) => {
        if (res.statusCode === 200) {
          this.appendLog('[bridge-manager] Health check passed — bridge is running.');
          this.setStatus('running');
          this.retryCount = 0;
          this.emit('started');
          return;
        }
        setTimeout(attempt, 1000);
      });
      req.on('error', () => setTimeout(attempt, 1000));
      req.end();
    };
    setTimeout(attempt, 2000);
  }

  private scheduleRetry(): void {
    if (this.retryCount >= MAX_RETRIES) {
      this.appendLog(`[bridge-manager] Max retries (${MAX_RETRIES}) reached.`);
      this.setStatus('error');
      return;
    }
    const delay = BASE_RETRY_DELAY * Math.pow(2, this.retryCount);
    this.retryCount++;
    this.appendLog(`[bridge-manager] Retrying in ${delay}ms (attempt ${this.retryCount}/${MAX_RETRIES})…`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.setStatus('starting');
      this.spawnProcess();
    }, delay);
  }

  async stopBridge(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;

    this.stopPromise = this.stopBridgeProcess();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private async stopBridgeProcess(): Promise<void> {
    this.killed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (!this.process) {
      this.setStatus('stopped');
      return;
    }

    const child = this.process;
    this.appendLog('[bridge-manager] Requesting graceful shutdown…');
    child.stdin?.end('shutdown\n');

    await new Promise<void>((resolve) => {
      let terminateTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        clearTimeout(gracefulTimer);
        if (terminateTimer) clearTimeout(terminateTimer);
        resolve();
      };
      const gracefulTimer = setTimeout(() => {
        if (this.process === child) {
          this.appendLog('[bridge-manager] Graceful shutdown timeout — terminating bridge process');
          child.kill('SIGTERM');
          terminateTimer = setTimeout(() => {
            if (this.process === child) {
              this.appendLog('[bridge-manager] Bridge did not terminate — killing process');
              child.kill('SIGKILL');
            }
            finish();
          }, TERMINATE_TIMEOUT_MS);
          return;
        }
        finish();
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      child.once('exit', finish);
    });

    this.process = null;
    this.setStatus('stopped');
    this.emit('stopped');
  }

  async restartBridge(): Promise<void> {
    await this.stopBridge();
    await new Promise((r) => setTimeout(r, 500));
    await this.startBridge();
  }
}

const bridgeManager = new BridgeManager();
export default bridgeManager;
