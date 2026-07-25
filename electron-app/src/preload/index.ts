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
  autoStart: {
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    status: () => Promise<boolean>;
  };
  youtube: {
    search: (query: string) => Promise<string>;
    transcript: (url: string) => Promise<Array<{ text: string; start: number; duration: number }>>;
    info: (url: string) => Promise<{
      url: string; title: string; author: string; duration: string;
      viewCount: number; thumbnail: string; description: string; publishedAt: string;
    }>;
    trending: (region: string) => Promise<Array<{
      url: string; title: string; author: string; viewCount: number;
      thumbnail: string; duration: string;
    }>>;
    summarize: (url: string) => Promise<{
      url: string; title: string; transcriptLength: number;
      summary: string; keyPoints: string[];
    }>;
  };
  games: {
    list: () => Promise<Array<{
      name: string; platform: string; installPath: string; version: string;
      sizeBytes: number; lastPlayed?: number; appId?: string;
    }>>;
    scanSteam: () => Promise<Array<{
      name: string; platform: string; installPath: string; version: string;
      sizeBytes: number; lastPlayed?: number; appId?: string;
    }>>;
    scanEpic: () => Promise<Array<{
      name: string; platform: string; installPath: string; version: string;
      sizeBytes: number; lastPlayed?: number; appId?: string;
    }>>;
    checkUpdate: (name: string) => Promise<{
      game: string; hasUpdate: boolean; currentVersion: string;
      latestVersion: string; updateSizeBytes: number;
    }>;
    update: (name: string) => Promise<string>;
  };
  clipboard: {
    startWatcher: (interval: number) => Promise<{ success: boolean }>;
    stopWatcher: () => Promise<{ success: boolean }>;
    analyze: (text: string, action?: string) => Promise<{
      original: string; action: string; result: string;
      model: string; timestamp: number;
    }>;
    history: () => Promise<Array<{
      text: string; timestamp: number; action?: string; result?: string;
    }>>;
    smartPaste: (action: string) => Promise<{
      original: string; action: string; result: string;
      model: string; timestamp: number;
    }>;
  };
  setup: {
    status: () => Promise<{
      isFirstRun: boolean; totalSteps: number; completedSteps: number;
      allRequiredComplete: boolean;
    }>;
    steps: () => Promise<Array<{
      id: string; title: string; description: string; required: boolean;
      completed: boolean; config: Record<string, unknown> | null;
    }>>;
    completeStep: (stepId: string, config: Record<string, unknown>) => Promise<{
      id: string; title: string; description: string; required: boolean;
      completed: boolean; config: Record<string, unknown> | null;
    } | null>;
    isFirstRun: () => Promise<boolean>;
  };
  browser: {
    open: (url: string) => Promise<string>;
    search: (query: string) => Promise<string>;
    navigate: (url: string) => Promise<string>;
    click: (selector: string) => Promise<string>;
    type: (text: string) => Promise<string>;
    back: () => Promise<string>;
    forward: () => Promise<string>;
    scroll: (dir: string) => Promise<string>;
    screenshot: (filePath?: string) => Promise<{ path: string; width: number; height: number }>;
    getText: () => Promise<string>;
  };
  fileProcessor: {
    read: (filePath: string) => Promise<{ content: string; type: string; charCount: number }>;
    summarize: (filePath: string) => Promise<{
      summary: string; path: string; type: string; charCount: number;
    }>;
    ask: (filePath: string, question: string) => Promise<string>;
    convert: (inputPath: string, format: string) => Promise<string>;
  };
  hardware: {
    cpu: () => Promise<{
      model: string; cores: number; usagePercent: number;
      temperature: number | null; speed: number;
    }>;
    ram: () => Promise<{
      totalGB: number; usedGB: number; freeGB: number;
      percent: number; swapTotalGB: number; swapUsedGB: number;
    }>;
    disk: () => Promise<Array<{
      fs: string; mount: string; type: string; totalGB: number;
      usedGB: number; freeGB: number; percent: number;
    }>>;
    gpu: () => Promise<Array<{
      name: string; usagePercent: number | null;
      memoryTotalMB: number | null; memoryUsedMB: number | null;
    }>>;
    fan: () => Promise<Array<{ label: string; rpm: number }>>;
    fullReport: () => Promise<{
      cpu: { model: string; cores: number; usagePercent: number; temperature: number | null; speed: number };
      ram: { totalGB: number; usedGB: number; freeGB: number; percent: number; swapTotalGB: number; swapUsedGB: number };
      disks: Array<{ fs: string; mount: string; type: string; totalGB: number; usedGB: number; freeGB: number; percent: number }>;
      gpu: Array<{ name: string; usagePercent: number | null; memoryTotalMB: number | null; memoryUsedMB: number | null }>;
      fans: Array<{ label: string; rpm: number }>;
      battery: { percent: number | null; charging: boolean };
      uptime: number; platform: string; hostname: string;
    }>;
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
  autoStart: {
    enable: () => ipcRenderer.invoke('auto-start:enable'),
    disable: () => ipcRenderer.invoke('auto-start:disable'),
    status: () => ipcRenderer.invoke('auto-start:status'),
  },
  youtube: {
    search: (query) => ipcRenderer.invoke('youtube:search', query),
    transcript: (url) => ipcRenderer.invoke('youtube:transcript', url),
    info: (url) => ipcRenderer.invoke('youtube:info', url),
    trending: (region) => ipcRenderer.invoke('youtube:trending', region),
    summarize: (url) => ipcRenderer.invoke('youtube:summarize', url),
  },
  games: {
    list: () => ipcRenderer.invoke('games:list'),
    scanSteam: () => ipcRenderer.invoke('games:scan-steam'),
    scanEpic: () => ipcRenderer.invoke('games:scan-epic'),
    checkUpdate: (name) => ipcRenderer.invoke('games:check-update', name),
    update: (name) => ipcRenderer.invoke('games:update', name),
  },
  clipboard: {
    startWatcher: (interval) => ipcRenderer.invoke('clipboard:start-watcher', interval),
    stopWatcher: () => ipcRenderer.invoke('clipboard:stop-watcher'),
    analyze: (text, action) => ipcRenderer.invoke('clipboard:analyze', text, action),
    history: () => ipcRenderer.invoke('clipboard:history'),
    smartPaste: (action) => ipcRenderer.invoke('clipboard:smart-paste', action),
  },
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    steps: () => ipcRenderer.invoke('setup:steps'),
    completeStep: (stepId, config) => ipcRenderer.invoke('setup:complete-step', stepId, config),
    isFirstRun: () => ipcRenderer.invoke('setup:is-first-run'),
  },
  browser: {
    open: (url) => ipcRenderer.invoke('browser:open', url),
    search: (query) => ipcRenderer.invoke('browser:search', query),
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    click: (selector) => ipcRenderer.invoke('browser:click', selector),
    type: (text) => ipcRenderer.invoke('browser:type', text),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    scroll: (dir) => ipcRenderer.invoke('browser:scroll', dir),
    screenshot: (filePath) => ipcRenderer.invoke('browser:screenshot', filePath),
    getText: () => ipcRenderer.invoke('browser:get-text'),
  },
  fileProcessor: {
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    summarize: (filePath) => ipcRenderer.invoke('file:summarize', filePath),
    ask: (filePath, question) => ipcRenderer.invoke('file:ask', filePath, question),
    convert: (inputPath, format) => ipcRenderer.invoke('file:convert', inputPath, format),
  },
  hardware: {
    cpu: () => ipcRenderer.invoke('hardware:cpu'),
    ram: () => ipcRenderer.invoke('hardware:ram'),
    disk: () => ipcRenderer.invoke('hardware:disk'),
    gpu: () => ipcRenderer.invoke('hardware:gpu'),
    fan: () => ipcRenderer.invoke('hardware:fan'),
    fullReport: () => ipcRenderer.invoke('hardware:full-report'),
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);
