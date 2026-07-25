import { EventEmitter } from 'events';
import { JarvisConnection, type ConnectionState, type JarvisServer } from './jarvis-connection';
import { processCommand, checkOllamaStatus, checkPythonBridgeStatus } from './omniroute';
import type { JarvisConfig } from '../shared/types';

export type ConnectionMode = 'server' | 'omniroute';

export interface ModeStatus {
  mode: ConnectionMode;
  serverState: ConnectionState | null;
  ollamaAvailable: boolean;
  pythonBridgeAvailable: boolean;
  activeModel: string | null;
}

const STORE_KEY = 'connection-mode';

export class ConnectionToggle extends EventEmitter {
  private mode: ConnectionMode = 'server';
  private connection: JarvisConnection;
  private config: JarvisConfig;
  private store: any;

  constructor(connection: JarvisConnection, config: JarvisConfig) {
    super();
    this.connection = connection;
    this.config = config;
    this.loadMode();

    this.connection.on('status', (state: ConnectionState) => {
      if (this.mode === 'server' && state.status === 'disconnected') {
        this.emit('server:offline', state);
      }
      this.emit('status', this.getStatus());
    });

    this.connection.on('fallback', (info: { reason: string }) => {
      this.emit('fallback', info);
    });
  }

  private loadMode(): void {
    try {
      const Store = require('electron-store');
      this.store = new Store({ name: STORE_KEY });
      const saved = this.store.get('mode') as ConnectionMode | undefined;
      if (saved === 'server' || saved === 'omniroute') {
        this.mode = saved;
      }
    } catch {
      this.store = null;
    }
  }

  private saveMode(): void {
    if (!this.store) return;
    try {
      this.store.set('mode', this.mode);
    } catch { /* ignore */ }
  }

  getConnectionMode(): ConnectionMode {
    return this.mode;
  }

  async setConnectionMode(mode: ConnectionMode): Promise<ModeStatus> {
    this.mode = mode;
    this.saveMode();

    if (mode === 'server') {
      await this.connection.connect();
    }

    const status = await this.getStatus();
    this.emit('mode:changed', status);
    return status;
  }

  async getServerStatus(): Promise<ConnectionState> {
    return this.connection.getState();
  }

  async getAvailableServers(): Promise<JarvisServer[]> {
    return this.connection.discoverServers();
  }

  async getStatus(): Promise<ModeStatus> {
    const serverState = this.connection.getState();
    const ollamaStatus = await checkOllamaStatus(this.config.ollamaUrl);
    const pythonBridgeAvailable = await checkPythonBridgeStatus();

    let activeModel: string | null = null;
    if (this.mode === 'server' && serverState.status === 'connected') {
      activeModel = 'jarvis-server';
    } else if (ollamaStatus.available) {
      activeModel = this.config.ollamaModel;
    }

    return {
      mode: this.mode,
      serverState,
      ollamaAvailable: ollamaStatus.available,
      pythonBridgeAvailable,
      activeModel,
    };
  }

  async processWithMode(text: string): Promise<{
    text: string;
    source: string;
    model?: string;
  }> {
    if (this.mode === 'server' && this.connection.isConnected()) {
      try {
        const result = await this.connection.sendCommand('chat', { message: text }) as {
          response?: string;
          text?: string;
        };
        return {
          text: result.response || result.text || '',
          source: 'server',
          model: 'jarvis-server',
        };
      } catch {
        this.emit('server:command-failed', { text });
      }
    }

    const result = await processCommand(text, {
      ollamaUrl: this.config.ollamaUrl,
      ollamaModel: this.config.ollamaModel,
    });
    return {
      text: result.text,
      source: result.source,
      model: result.model,
    };
  }

  destroy(): void {
    this.removeAllListeners();
  }
}
