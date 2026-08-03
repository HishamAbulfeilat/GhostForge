import { EventEmitter } from 'events';
import type { JarvisConfig } from '../shared/types';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type ConnectionType = 'websocket' | 'http' | 'omniroute';

export interface JarvisServer {
  url: string;
  name: string;
  version?: string;
  discoveredAt: number;
  lastSeen: number;
  responseTime: number;
}

export interface ConnectionState {
  status: ConnectionStatus;
  type: ConnectionType;
  serverUrl: string | null;
  latency: number;
  lastConnected: number | null;
  reconnectAttempts: number;
}

const STORE_KEY = 'jarvis-connection';
const DEFAULT_SERVER_URL = 'http://localhost:8765';
const DISCOVERY_PORTS = [8765, 8766, 3000, 5678];
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;
const HEALTH_CHECK_INTERVAL = 15000;

export class JarvisConnection extends EventEmitter {
  private state: ConnectionState = {
    status: 'disconnected',
    type: 'http',
    serverUrl: null,
    latency: 0,
    lastConnected: null,
    reconnectAttempts: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private discoveredServers: JarvisServer[] = [];
  private store: any;
  private config: JarvisConfig;

  constructor(config: JarvisConfig) {
    super();
    this.config = config;
    this.loadState();
  }

  private loadState(): void {
    try {
      const Store = require('electron-store');
      this.store = new Store({ name: STORE_KEY });
      const saved = this.store.get('state') as ConnectionState | undefined;
      if (saved) {
        this.state = { ...this.state, ...saved };
      }
      const servers = this.store.get('discoveredServers') as JarvisServer[] | undefined;
      if (servers) {
        this.discoveredServers = servers;
      }
    } catch {
      this.store = null;
    }
  }

  private saveState(): void {
    if (!this.store) return;
    try {
      this.store.set('state', {
        status: this.state.status,
        type: this.state.type,
        serverUrl: this.state.serverUrl,
        latency: this.state.latency,
        lastConnected: this.state.lastConnected,
        reconnectAttempts: this.state.reconnectAttempts,
      });
      this.store.set('discoveredServers', this.discoveredServers);
    } catch { /* ignore */ }
  }

  async connect(serverUrl?: string): Promise<ConnectionState> {
    const url = serverUrl || this.state.serverUrl || this.config.ollamaUrl || DEFAULT_SERVER_URL;
    this.state.serverUrl = url;
    this.state.status = 'connecting';
    this.emit('status', this.state);

    try {
      const reachable = await this.healthCheck(url);
      if (reachable) {
        this.state.status = 'connected';
        this.state.lastConnected = Date.now();
        this.state.reconnectAttempts = 0;
        this.state.type = 'http';
        this.startHealthCheck();
        this.saveState();
        this.emit('status', this.state);
        this.emit('connected', { url, type: this.state.type });
        return this.state;
      }
    } catch { /* fall through */ }

    this.state.status = 'disconnected';
    this.state.type = 'omniroute';
    this.saveState();
    this.emit('status', this.state);
    return this.state;
  }

  async connectWebSocket(serverUrl?: string): Promise<ConnectionState> {
    const url = serverUrl || this.state.serverUrl || DEFAULT_SERVER_URL;
    const wsUrl = url.replace(/^http/, 'ws');

    this.state.serverUrl = url;
    this.state.status = 'connecting';
    this.emit('status', this.state);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const WS = require('ws') as new (url: string) => {
        on: (event: string, listener: (...args: any[]) => void) => any;
        send: (data: string) => void;
        close: () => void;
      };
      this.ws = new WS(wsUrl);

      return new Promise<ConnectionState>((resolve) => {
        const timeout = setTimeout(() => {
          this.ws?.close();
          this.state.status = 'error';
          this.state.type = 'omniroute';
          this.saveState();
          this.emit('status', this.state);
          resolve(this.state);
        }, 5000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.state.status = 'connected';
          this.state.type = 'websocket';
          this.state.lastConnected = Date.now();
          this.state.reconnectAttempts = 0;
          this.startHealthCheck();
          this.saveState();
          this.emit('status', this.state);
          this.emit('connected', { url, type: 'websocket' });
          resolve(this.state);
        });

        this.ws.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            this.emit('message', msg);
          } catch { /* ignore non-JSON */ }
        });

        this.ws.on('close', () => {
          this.state.status = 'disconnected';
          this.saveState();
          this.emit('status', this.state);
          this.emit('disconnected');
          this.scheduleReconnect();
        });

        this.ws.on('error', () => {
          clearTimeout(timeout);
          this.state.status = 'error';
          this.state.type = 'omniroute';
          this.saveState();
          this.emit('status', this.state);
          resolve(this.state);
        });
      });
    } catch {
      this.state.status = 'error';
      this.state.type = 'omniroute';
      this.saveState();
      this.emit('status', this.state);
      return this.state;
    }
  }

  disconnect(): void {
    this.stopHealthCheck();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state.status = 'disconnected';
    this.state.reconnectAttempts = 0;
    this.saveState();
    this.emit('status', this.state);
  }

  private async healthCheck(url: string): Promise<boolean> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${url}/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      clearTimeout(timeout);
      this.state.latency = Date.now() - start;
      return resp.ok;
    } catch {
      this.state.latency = Date.now() - start;
      return false;
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(async () => {
      if (!this.state.serverUrl) return;
      const alive = await this.healthCheck(this.state.serverUrl);
      if (alive && this.state.status !== 'connected') {
        this.state.status = 'connected';
        this.emit('status', this.state);
      } else if (!alive && this.state.status === 'connected') {
        this.state.status = 'disconnected';
        this.saveState();
        this.emit('status', this.state);
        this.scheduleReconnect();
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.state.type = 'omniroute';
      this.emit('fallback', { reason: 'max-reconnect-attempts' });
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.state.reconnectAttempts),
      30000
    );
    this.state.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.emit('reconnecting', { attempt: this.state.reconnectAttempts });
      await this.connect();
    }, delay);
  }

  async discoverServers(): Promise<JarvisServer[]> {
    const found: JarvisServer[] = [];
    const hostname = 'localhost';

    const checks = DISCOVERY_PORTS.map(async (port) => {
      const url = `http://${hostname}:${port}`;
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const resp = await fetch(`${url}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          found.push({
            url,
            name: (data as any).name || `JARVIS on port ${port}`,
            version: (data as any).version,
            discoveredAt: Date.now(),
            lastSeen: Date.now(),
            responseTime: Date.now() - start,
          });
        }
      } catch { /* not reachable */ }
    });

    await Promise.allSettled(checks);

    this.discoveredServers = found;
    this.saveState();
    this.emit('servers:discovered', found);
    return found;
  }

  async sendCommand(command: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (this.state.status !== 'connected' || !this.state.serverUrl) {
      throw new Error('Not connected to JARVIS server');
    }

    const url = `${this.state.serverUrl}/api/command`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...payload }),
      });
      clearTimeout(timeout);

      if (!resp.ok) throw new Error(`Server responded with ${resp.status}`);
      return resp.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  sendWsMessage(message: Record<string, unknown>): void {
    if (this.ws && this.state.status === 'connected') {
      this.ws.send(JSON.stringify(message));
    }
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  getDiscoveredServers(): JarvisServer[] {
    return [...this.discoveredServers];
  }

  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }
}
