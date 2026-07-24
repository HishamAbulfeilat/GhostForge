import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  screen: {
    capture: (options?: {
      format?: 'jpeg' | 'png';
      quality?: number;
      captureAll?: boolean;
    }) => Promise<{
      success: boolean;
      image: string;
      format: string;
      size: number;
      timestamp: number;
      width: number;
      height: number;
    }>;
    captureRegion: (
      x: number, y: number, w: number, h: number,
      options?: { format?: 'jpeg' | 'png'; quality?: number }
    ) => Promise<{
      success: boolean;
      image: string;
      format: string;
      size: number;
      timestamp: number;
      width: number;
      height: number;
    }>;
    getDisplays: () => Promise<Array<{
      id: number;
      bounds: { x: number; y: number; width: number; height: number };
      size: { width: number; height: number };
      label: string;
      primary: boolean;
    }>>;
    onCaptured: (callback: (result: { image: string; timestamp: number }) => void) => void;
    offCaptured: (callback: (result: { image: string; timestamp: number }) => void) => void;
  };
  cursor: {
    point: (screenId: number, target: {
      x: number;
      y: number;
      label?: string;
      timestamp: number;
    }) => Promise<{ success: boolean }>;
    highlight: (
      screenId: number,
      x: number, y: number, w: number, h: number,
      label?: string
    ) => Promise<{ success: boolean }>;
    hide: (screenId?: number) => Promise<{ success: boolean }>;
    onPoint: (callback: (target: {
      x: number;
      y: number;
      label?: string;
      timestamp: number;
    }) => void) => void;
    offPoint: (callback: (target: {
      x: number;
      y: number;
      label?: string;
      timestamp: number;
    }) => void) => void;
  };
  voice: {
    start: () => Promise<{ success: boolean }>;
    stop: () => Promise<{ success: boolean }>;
    speak: (text: string, voice?: string) => Promise<void>;
    setVolume: (direction: 'up' | 'down' | 'mute') => Promise<{ success: boolean }>;
    onStarted: (callback: () => void) => void;
    onStopped: (callback: () => void) => void;
    onTranscript: (callback: (command: {
      transcript: string;
      confidence: number;
      timestamp: number;
    }) => void) => void;
    onPushToTalk: (callback: (action: 'start' | 'stop') => void) => void;
  };
  system: {
    openApp: (appName: string) => Promise<string>;
    openUrl: (url: string) => Promise<string>;
    lockScreen: () => Promise<string>;
    getInfo: () => Promise<{
      platform: string;
      hostname: string;
      uptime: number;
      memory: { total: number; free: number; used: number };
      cpu: string;
    }>;
    getVolume: () => Promise<number>;
    setVolume: (level: number) => Promise<void>;
    processes: () => Promise<string[]>;
    killProcess: (name: string) => Promise<string>;
  };
  config: {
    get: () => Promise<{
      ollamaUrl: string;
      ollamaModel: string;
      visionModel: string;
      voiceEngine: string;
      wakeWord: string;
      language: string;
      autoStart: boolean;
      minimizeToTray: boolean;
    }>;
    set: (updates: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    hide: () => Promise<void>;
    show: () => Promise<void>;
  };
  tray: {
    updateStatus: (status: string, model?: string) => Promise<{ success: boolean }>;
  };
}

const electronAPI: ElectronAPI = {
  screen: {
    capture: (options) => ipcRenderer.invoke('screen:capture', options),
    captureRegion: (x, y, w, h, options) =>
      ipcRenderer.invoke('screen:captureRegion', x, y, w, h, options),
    getDisplays: () => ipcRenderer.invoke('screen:getDisplays'),
    onCaptured: (callback) => {
      ipcRenderer.on('screen:captured', (_event, result) => callback(result));
    },
    offCaptured: (callback) => {
      ipcRenderer.removeListener('screen:captured', (_event, result) =>
        callback(result as any)
      );
    },
  },
  cursor: {
    point: (screenId, target) => ipcRenderer.invoke('cursor:point', screenId, target),
    highlight: (screenId, x, y, w, h, label) =>
      ipcRenderer.invoke('cursor:highlight', screenId, x, y, w, h, label),
    hide: (screenId) => ipcRenderer.invoke('cursor:hide', screenId),
    onPoint: (callback) => {
      ipcRenderer.on('cursor:point', (_event, target) => callback(target));
    },
    offPoint: (callback) => {
      ipcRenderer.removeListener('cursor:point', (_event, target) =>
        callback(target as any)
      );
    },
  },
  voice: {
    start: () => ipcRenderer.invoke('voice:start'),
    stop: () => ipcRenderer.invoke('voice:stop'),
    speak: (text, voice) => ipcRenderer.invoke('voice:speak', text, voice),
    setVolume: (direction) => ipcRenderer.invoke('voice:setVolume', direction),
    onStarted: (callback) => {
      ipcRenderer.on('voice:started', () => callback());
    },
    onStopped: (callback) => {
      ipcRenderer.on('voice:stopped', () => callback());
    },
    onTranscript: (callback) => {
      ipcRenderer.on('voice:transcript', (_event, command) => callback(command));
    },
    onPushToTalk: (callback) => {
      ipcRenderer.on('voice:push-to-talk:start', () => callback('start'));
      ipcRenderer.on('voice:push-to-talk:stop', () => callback('stop'));
    },
  },
  system: {
    openApp: (appName) => ipcRenderer.invoke('system:openApp', appName),
    openUrl: (url) => ipcRenderer.invoke('system:openUrl', url),
    lockScreen: () => ipcRenderer.invoke('system:lockScreen'),
    getInfo: () => ipcRenderer.invoke('system:getInfo'),
    getVolume: () => ipcRenderer.invoke('system:getVolume'),
    setVolume: (level) => ipcRenderer.invoke('system:setVolume', level),
    processes: () => ipcRenderer.invoke('system:processes'),
    killProcess: (name) => ipcRenderer.invoke('system:killProcess', name),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (updates) => ipcRenderer.invoke('config:set', updates),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    hide: () => ipcRenderer.invoke('window:hide'),
    show: () => ipcRenderer.invoke('window:show'),
  },
  tray: {
    updateStatus: (status, model) => ipcRenderer.invoke('tray:updateStatus', status, model),
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);
