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
  jarvisConnection: {
    connect: (serverUrl?: string) => Promise<{
      status: string; type: string; serverUrl: string | null;
      latency: number; lastConnected: number | null; reconnectAttempts: number;
    }>;
    connectWs: (serverUrl?: string) => Promise<{
      status: string; type: string; serverUrl: string | null;
      latency: number; lastConnected: number | null; reconnectAttempts: number;
    }>;
    disconnect: () => Promise<{ success: boolean }>;
    discoverServers: () => Promise<Array<{
      url: string; name: string; version?: string;
      discoveredAt: number; lastSeen: number; responseTime: number;
    }>>;
    getState: () => Promise<{
      status: string; type: string; serverUrl: string | null;
      latency: number; lastConnected: number | null; reconnectAttempts: number;
    }>;
    sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
    sendWsMessage: (message: Record<string, unknown>) => Promise<{ success: boolean }>;
    isConnected: () => Promise<boolean>;
    onStatus: (callback: (state: Record<string, unknown>) => void) => void;
    onConnected: (callback: (info: Record<string, unknown>) => void) => void;
    onDisconnected: (callback: () => void) => void;
    onMessage: (callback: (msg: Record<string, unknown>) => void) => void;
    onReconnecting: (callback: (info: Record<string, unknown>) => void) => void;
    onFallback: (callback: (info: Record<string, unknown>) => void) => void;
  };
  connectionToggle: {
    getMode: () => Promise<string>;
    setMode: (mode: 'server' | 'omniroute') => Promise<{
      mode: string; serverState: Record<string, unknown> | null;
      ollamaAvailable: boolean; pythonBridgeAvailable: boolean; activeModel: string | null;
    }>;
    getStatus: () => Promise<{
      mode: string; serverState: Record<string, unknown> | null;
      ollamaAvailable: boolean; pythonBridgeAvailable: boolean; activeModel: string | null;
    }>;
    getServerStatus: () => Promise<{
      status: string; type: string; serverUrl: string | null;
      latency: number; lastConnected: number | null; reconnectAttempts: number;
    }>;
    getServers: () => Promise<Array<{
      url: string; name: string; version?: string;
      discoveredAt: number; lastSeen: number; responseTime: number;
    }>>;
    process: (text: string) => Promise<{ text: string; source: string; model?: string }>;
    onModeChanged: (callback: (status: Record<string, unknown>) => void) => void;
    onServerOffline: (callback: (state: Record<string, unknown>) => void) => void;
    onFallback: (callback: (info: Record<string, unknown>) => void) => void;
  };
  bridgeManager: {
    start: () => Promise<{ success: boolean; status: string }>;
    stop: () => Promise<{ success: boolean; status: string }>;
    restart: () => Promise<{ success: boolean; status: string }>;
    getStatus: () => Promise<{ status: string; url: string }>;
    getLogs: () => Promise<{ logs: string[] }>;
    setAutoStart: (enabled?: boolean) => Promise<{ autoStart: boolean }>;
    onStatusChange: (callback: (status: string) => void) => void;
  };
  geminiLive: {
    connect: () => Promise<boolean>;
    disconnect: () => Promise<void>;
    startListening: () => Promise<boolean>;
    stopListening: () => Promise<void>;
    getStatus: () => Promise<{
      active: boolean; duration: number; sessionId: string | null; connectionState: string;
    }>;
    sendText: (text: string) => Promise<void>;
    sendAudioChunk: (base64Audio: string) => Promise<{ success: boolean }>;
    saveSettings: (settings: Record<string, unknown>) => Promise<void>;
    loadSettings: () => Promise<Record<string, unknown> | null>;
    onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => void;
    onAudioData: (callback: (data: Buffer) => void) => void;
    onError: (callback: (error: string) => void) => void;
    onConnectionChange: (callback: (state: string) => void) => void;
    onListeningStarted: (callback: () => void) => void;
    onListeningStopped: (callback: () => void) => void;
    onPlaybackStarted: (callback: () => void) => void;
    onPlaybackEnded: (callback: () => void) => void;
    onReconnecting: (callback: (info: { attempt: number; maxAttempts: number }) => void) => void;
  };
  n8n: {
    getStatus: () => Promise<{ connected: boolean; url: string; workflowCount: number; activeWorkflows: number }>;
    connect: (url?: string, apiKey?: string) => Promise<{ connected: boolean; url: string; workflowCount: number; activeWorkflows: number }>;
    listWorkflows: () => Promise<Array<{ id: string; name: string; webhookUrl: string; active: boolean; trigger: string }>>;
    getWorkflow: (id: string) => Promise<unknown>;
    createWorkflow: (workflow: { name: string; nodes: unknown[]; connections: Record<string, unknown> }) => Promise<{ id: string; name: string; webhookUrl: string; active: boolean; trigger: string } | null>;
    activateWorkflow: (id: string) => Promise<boolean>;
    deactivateWorkflow: (id: string) => Promise<boolean>;
    trigger: (workflowId: string, data: Record<string, unknown>) => Promise<unknown>;
    triggerByName: (name: string, data: Record<string, unknown>) => Promise<unknown>;
    deploy: (action: 'test' | 'build' | 'deploy', project: string, branch?: string) => Promise<unknown>;
    notify: (channel: string, message: string, priority?: 'low' | 'medium' | 'high') => Promise<unknown>;
    pr: (action: 'review' | 'merge' | 'comment', prNumber: number, repo: string, comment?: string) => Promise<unknown>;
    importWorkflows: () => Promise<{ imported: string[]; count: number }>;
    onStatusChange: (callback: (status: { connected: boolean; url: string; workflowCount: number; activeWorkflows: number }) => void) => void;
  };
  autonomousAgent: {
    start: (config?: Record<string, unknown>) => Promise<{ success: boolean; status: string }>;
    stop: () => Promise<{ success: boolean; status: string }>;
    pause: () => Promise<{ success: boolean; status: string }>;
    resume: () => Promise<{ success: boolean; status: string }>;
    getStatus: () => Promise<{
      status: string; uptime: number; issueCount: number; currentTask: string;
      stats: { totalProcessed: number; successRate: number; avgTimePerIssue: number;
        linesGenerated: number; testsWritten: number; prsCreated: number; prsMerged: number };
    }>;
    getConfig: () => Promise<{
      repoUrl: string; githubToken: string; ollamaUrl: string; model: string;
      pollInterval: number; autoMerge: boolean; testRequired: boolean;
      labelsToMonitor: string[]; branchPrefix: string; maxConcurrentIssues: number; dryRun: boolean;
    }>;
    setConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>;
    getIssues: () => Promise<Array<{
      number: number; title: string; labels: Array<{ name: string; color: string }>;
      status: string; assignedAgent: string | null; timeElapsed: number;
      subtasksCompleted: number; subtasksTotal: number; priority: number;
    }>>;
    processIssue: (number: number) => Promise<{ success: boolean; status: string }>;
    onStateChange: (callback: (state: { status: string; uptime: number; issueCount: number }) => void) => void;
    onProgress: (callback: (progress: { currentTask: string; issueNumber: number; percent: number }) => void) => void;
    onIssueUpdate: (callback: (update: { number: number; status: string; count: number }) => void) => void;
    onTestResults: (callback: (results: { issueNumber: number; passed: number; failed: number; details: string[] }) => void) => void;
    onPRCreated: (callback: (pr: { issueNumber: number; prUrl: string; prNumber: number }) => void) => void;
  };
  jarvisDaemon: {
    start: () => Promise<{
      state: string; uptime: number; startedAt: number | null; lastHealthCheck: number;
      voiceActive: boolean; commandsProcessed: number; restartCount: number; pid: number | null; platform: string;
    }>;
    stop: () => Promise<{
      state: string; uptime: number; startedAt: number | null; lastHealthCheck: number;
      voiceActive: boolean; commandsProcessed: number; restartCount: number; pid: number | null; platform: string;
    }>;
    status: () => Promise<{
      state: string; uptime: number; startedAt: number | null; lastHealthCheck: number;
      voiceActive: boolean; commandsProcessed: number; restartCount: number; pid: number | null; platform: string;
    }>;
    getSettings: () => Promise<Record<string, unknown>>;
    setSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
    startVoice: () => Promise<{ success: boolean }>;
    stopVoice: () => Promise<{ success: boolean }>;
    processCommand: (transcript: string) => Promise<string>;
    showWindow: () => Promise<{ success: boolean }>;
    hideWindow: () => Promise<{ success: boolean }>;
    getLogs: (lines?: number) => Promise<string[]>;
    clearLogs: () => Promise<{ success: boolean }>;
    onStateChange: (callback: (state: { from: string; to: string; timestamp: number }) => void) => void;
    onStarted: (callback: (status: Record<string, unknown>) => void) => void;
    onStopped: (callback: (status: Record<string, unknown>) => void) => void;
    onVoiceStarted: (callback: () => void) => void;
    onVoiceStopped: (callback: () => void) => void;
    onCommandReceived: (callback: (data: { transcript: string; timestamp: number }) => void) => void;
    onCommandProcessed: (callback: (data: { transcript: string; response: string; source: string; timestamp: number }) => void) => void;
    onHealthCheck: (callback: (data: Record<string, unknown>) => void) => void;
    onError: (callback: (error: string) => void) => void;
  };
  selfUpdater: {
    check: () => Promise<{
      currentVersion: string; remoteVersion: string; hasUpdate: boolean;
      currentCommit: string; remoteCommit: string; changelog: string;
      filesChanged: string[]; behind: number; timestamp: number;
    }>;
    update: (userConfirm?: boolean) => Promise<boolean>;
    startAutoCheck: (intervalMs?: number) => Promise<{ success: boolean }>;
    stopAutoCheck: () => Promise<{ success: boolean }>;
    selfModify: (filePath: string, content: string, options?: Record<string, unknown>) => Promise<boolean>;
    analyzeProject: () => Promise<{
      structure: string[]; totalFiles: number; totalSize: string;
      languages: Record<string, number>;
    }>;
    readFile: (filePath: string) => Promise<{ content?: string; path?: string; error?: string }>;
    version: () => Promise<{ version: string; commit: string }>;
    onPhase: (callback: (data: { phase: string; message: string; percent: number }) => void) => void;
    onLog: (callback: (data: { message: string; timestamp: string }) => void) => void;
  };
  codeModifier: {
    readFile: (filePath: string) => Promise<{ content: string; path: string; size: number; modified: number }>;
    editFile: (filePath: string, oldContent: string, newContent: string, options?: Record<string, unknown>) => Promise<{
      filePath: string; action: string; timestamp: number; success: boolean; error?: string;
    }>;
    createFile: (filePath: string, content: string, options?: Record<string, unknown>) => Promise<{
      filePath: string; action: string; timestamp: number; success: boolean; error?: string;
    }>;
    deleteFile: (filePath: string, options?: Record<string, unknown>) => Promise<{
      filePath: string; action: string; timestamp: number; success: boolean; error?: string;
    }>;
    search: (pattern: string, directory?: string) => Promise<Array<{ path: string; matches: number }>>;
    structure: () => Promise<{
      root: string; files: Array<{ path: string; size: number; modified: number }>;
      directories: string[]; languages: Record<string, number>;
      totalFiles: number; totalSizeBytes: number;
    }>;
    rollback: () => Promise<boolean>;
    history: () => Promise<Array<{
      filePath: string; action: string; timestamp: number; success: boolean; error?: string;
    }>>;
    runInstall: () => Promise<{ success: boolean; output: string }>;
    runBuild: () => Promise<{ success: boolean; output: string }>;
    restartApp: () => Promise<{ success: boolean }>;
    onFileEdited: (callback: (data: { filePath: string; success: boolean; timestamp: number }) => void) => void;
    onFileCreated: (callback: (data: { filePath: string; success: boolean; timestamp: number }) => void) => void;
    onFileDeleted: (callback: (data: { filePath: string; success: boolean; timestamp: number }) => void) => void;
  };
  email: {
    list: (params: Record<string, unknown>) => Promise<{ messages: Array<Record<string, unknown>>; nextPageToken?: string }>;
    read: (messageId: string, accountId?: string) => Promise<Record<string, unknown>>;
    send: (params: Record<string, unknown>) => Promise<{ id: string; threadId?: string }>;
    reply: (messageId: string, body: string, bodyHtml?: string, accountId?: string) => Promise<{ id: string; threadId?: string }>;
    markRead: (messageId: string, accountId?: string) => Promise<void>;
    markUnread: (messageId: string, accountId?: string) => Promise<void>;
    star: (messageId: string, accountId?: string) => Promise<void>;
    unstar: (messageId: string, accountId?: string) => Promise<void>;
    delete: (messageId: string, accountId?: string) => Promise<void>;
    unreadCount: (accountId?: string) => Promise<number>;
    recent: (count?: number, accountId?: string) => Promise<{ messages: Array<Record<string, unknown>> }>;
    search: (query: string, accountId?: string) => Promise<{ messages: Array<Record<string, unknown>> }>;
    accounts: () => Promise<Array<Record<string, unknown>>>;
    removeAccount: (accountId: string) => Promise<boolean>;
    addImap: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    oauthStart: (provider: 'gmail' | 'outlook') => Promise<{ authUrl: string }>;
    oauthCallback: (code: string, provider: 'gmail' | 'outlook') => Promise<Record<string, unknown>>;
  };
  aiStudio: {
    setKey: (apiKey: string) => Promise<{ success: boolean }>;
    keyStatus: () => Promise<{ configured: boolean; keyPreview: string }>;
    listModels: () => Promise<Array<Record<string, unknown>>>;
    getModel: (modelId: string) => Promise<Record<string, unknown>>;
    generate: (model: string, prompt: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    updateModel: (modelId: string, updates: { displayName?: string; description?: string }) => Promise<Record<string, unknown>>;
    baseModels: () => Promise<Array<Record<string, unknown>>>;
    modelInfo: (modelName: string) => Promise<Record<string, unknown>>;
    compare: (prompt: string, modelA: string, modelB: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    test: (model: string, prompt: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    exportConfig: (modelId: string) => Promise<Record<string, unknown>>;
    importConfig: (config: Record<string, unknown>) => Promise<{ success: boolean; message: string }>;
  };
  calendar: {
    today: (accountId?: string) => Promise<Array<Record<string, unknown>>>;
    upcoming: (days?: number, accountId?: string) => Promise<Array<Record<string, unknown>>>;
    create: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    update: (eventId: string, updates: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (eventId: string, accountId?: string) => Promise<void>;
    freeBusy: (timeMin: string, timeMax: string, accountId?: string) => Promise<Array<Record<string, unknown>>>;
    freeSlots: (date: string, accountId?: string) => Promise<Array<Record<string, unknown>>>;
    accounts: () => Promise<Array<Record<string, unknown>>>;
    removeAccount: (accountId: string) => Promise<boolean>;
    oauthStart: (provider: 'google' | 'outlook') => Promise<{ authUrl: string }>;
    oauthCallback: (code: string, provider: 'google' | 'outlook') => Promise<Record<string, unknown>>;
    addCaldav: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  contacts: {
    search: (query: string, accountId?: string) => Promise<Array<Record<string, unknown>>>;
    get: (contactId: string, accountId?: string) => Promise<Record<string, unknown>>;
    create: (contact: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (contactId: string, accountId?: string) => Promise<void>;
    byPhone: (phone: string, accountId?: string) => Promise<Array<Record<string, unknown>>>;
    recent: (count?: number) => Promise<Array<Record<string, unknown>>>;
    accounts: () => Promise<Array<Record<string, unknown>>>;
    removeAccount: (accountId: string) => Promise<boolean>;
    oauthStart: (provider: 'google' | 'outlook') => Promise<{ authUrl: string }>;
    oauthCallback: (code: string, provider: 'google' | 'outlook') => Promise<Record<string, unknown>>;
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
  jarvisConnection: {
    connect: (serverUrl?: string) => ipcRenderer.invoke('jarvis:connect', serverUrl),
    connectWs: (serverUrl?: string) => ipcRenderer.invoke('jarvis:connect-ws', serverUrl),
    disconnect: () => ipcRenderer.invoke('jarvis:disconnect'),
    discoverServers: () => ipcRenderer.invoke('jarvis:discover-servers'),
    getState: () => ipcRenderer.invoke('jarvis:get-state'),
    sendCommand: (command: string, payload?: Record<string, unknown>) =>
      ipcRenderer.invoke('jarvis:send-command', command, payload),
    sendWsMessage: (message: Record<string, unknown>) =>
      ipcRenderer.invoke('jarvis:send-ws-message', message),
    isConnected: () => ipcRenderer.invoke('jarvis:is-connected'),
    onStatus: (callback: (state: Record<string, unknown>) => void) => {
      ipcRenderer.on('jarvis:status', (_event, state) => callback(state));
    },
    onConnected: (callback: (info: Record<string, unknown>) => void) => {
      ipcRenderer.on('jarvis:connected', (_event, info) => callback(info));
    },
    onDisconnected: (callback: () => void) => {
      ipcRenderer.on('jarvis:disconnected', () => callback());
    },
    onMessage: (callback: (msg: Record<string, unknown>) => void) => {
      ipcRenderer.on('jarvis:message', (_event, msg) => callback(msg));
    },
    onReconnecting: (callback: (info: Record<string, unknown>) => void) => {
      ipcRenderer.on('jarvis:reconnecting', (_event, info) => callback(info));
    },
    onFallback: (callback: (info: Record<string, unknown>) => void) => {
      ipcRenderer.on('jarvis:fallback', (_event, info) => callback(info));
    },
  },
  connectionToggle: {
    getMode: () => ipcRenderer.invoke('connection:get-mode'),
    setMode: (mode: 'server' | 'omniroute') => ipcRenderer.invoke('connection:set-mode', mode),
    getStatus: () => ipcRenderer.invoke('connection:get-status'),
    getServerStatus: () => ipcRenderer.invoke('connection:get-server-status'),
    getServers: () => ipcRenderer.invoke('connection:get-servers'),
    process: (text: string) => ipcRenderer.invoke('connection:process', text),
    onModeChanged: (callback: (status: Record<string, unknown>) => void) => {
      ipcRenderer.on('connection:mode-changed', (_event, status) => callback(status));
    },
    onServerOffline: (callback: (state: Record<string, unknown>) => void) => {
      ipcRenderer.on('connection:server-offline', (_event, state) => callback(state));
    },
    onFallback: (callback: (info: Record<string, unknown>) => void) => {
      ipcRenderer.on('connection:fallback', (_event, info) => callback(info));
    },
  },
  bridgeManager: {
    start: () => ipcRenderer.invoke('jarvis:bridge-start'),
    stop: () => ipcRenderer.invoke('jarvis:bridge-stop'),
    restart: () => ipcRenderer.invoke('jarvis:bridge-restart'),
    getStatus: () => ipcRenderer.invoke('jarvis:bridge-status'),
    getLogs: () => ipcRenderer.invoke('jarvis:bridge-logs'),
    setAutoStart: (enabled?: boolean) => ipcRenderer.invoke('jarvis:bridge-auto-start', enabled),
    onStatusChange: (callback: (status: string) => void) => {
      ipcRenderer.on('jarvis:bridge-status', (_event, status) => callback(status));
    },
  },
  geminiLive: {
    connect: () => ipcRenderer.invoke('jarvis:voice-connect'),
    disconnect: () => ipcRenderer.invoke('jarvis:voice-disconnect'),
    startListening: () => ipcRenderer.invoke('jarvis:voice-start'),
    stopListening: () => ipcRenderer.invoke('jarvis:voice-stop'),
    getStatus: () => ipcRenderer.invoke('jarvis:voice-status'),
    sendText: (text: string) => ipcRenderer.invoke('jarvis:voice-send-text', text),
    sendAudioChunk: (base64Audio: string) => ipcRenderer.invoke('jarvis:voice-audio-chunk', base64Audio),
    saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('jarvis:voice-settings-save', settings),
    loadSettings: () => ipcRenderer.invoke('jarvis:voice-settings-load'),
    onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => {
      ipcRenderer.on('gemini:transcript', (_event, data) => callback(data));
    },
    onAudioData: (callback: (data: Buffer) => void) => {
      ipcRenderer.on('gemini:audio-data', (_event, data) => callback(data));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('gemini:error', (_event, error) => callback(error));
    },
    onConnectionChange: (callback: (state: string) => void) => {
      ipcRenderer.on('gemini:connection-change', (_event, state) => callback(state));
    },
    onListeningStarted: (callback: () => void) => {
      ipcRenderer.on('gemini:listening-started', () => callback());
    },
    onListeningStopped: (callback: () => void) => {
      ipcRenderer.on('gemini:listening-stopped', () => callback());
    },
    onPlaybackStarted: (callback: () => void) => {
      ipcRenderer.on('gemini:playback-started', () => callback());
    },
    onPlaybackEnded: (callback: () => void) => {
      ipcRenderer.on('gemini:playback-ended', () => callback());
    },
    onReconnecting: (callback: (info: { attempt: number; maxAttempts: number }) => void) => {
      ipcRenderer.on('gemini:reconnecting', (_event, info) => callback(info));
    },
  },
  n8n: {
    getStatus: () => ipcRenderer.invoke('jarvis:n8n-status'),
    connect: (url?: string, apiKey?: string) => ipcRenderer.invoke('jarvis:n8n-connect', url, apiKey),
    listWorkflows: () => ipcRenderer.invoke('jarvis:n8n-workflows'),
    getWorkflow: (id: string) => ipcRenderer.invoke('jarvis:n8n-workflow-get', id),
    createWorkflow: (workflow: { name: string; nodes: unknown[]; connections: Record<string, unknown> }) =>
      ipcRenderer.invoke('jarvis:n8n-workflow-create', workflow),
    activateWorkflow: (id: string) => ipcRenderer.invoke('jarvis:n8n-workflow-activate', id),
    deactivateWorkflow: (id: string) => ipcRenderer.invoke('jarvis:n8n-workflow-deactivate', id),
    trigger: (workflowId: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('jarvis:n8n-trigger', workflowId, data),
    triggerByName: (name: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('jarvis:n8n-trigger-by-name', name, data),
    deploy: (action: 'test' | 'build' | 'deploy', project: string, branch?: string) =>
      ipcRenderer.invoke('jarvis:n8n-deploy', action, project, branch),
    notify: (channel: string, message: string, priority?: 'low' | 'medium' | 'high') =>
      ipcRenderer.invoke('jarvis:n8n-notify', channel, message, priority),
    pr: (action: 'review' | 'merge' | 'comment', prNumber: number, repo: string, comment?: string) =>
      ipcRenderer.invoke('jarvis:n8n-pr', action, prNumber, repo, comment),
    importWorkflows: () => ipcRenderer.invoke('jarvis:n8n-workflows-import'),
    onStatusChange: (callback: (status: { connected: boolean; url: string; workflowCount: number; activeWorkflows: number }) => void) => {
      ipcRenderer.on('jarvis:n8n-status-changed', (_event, status) => callback(status));
    },
  },
  autonomousAgent: {
    start: (config?: Record<string, unknown>) => ipcRenderer.invoke('agent:start', config),
    stop: () => ipcRenderer.invoke('agent:stop'),
    pause: () => ipcRenderer.invoke('agent:pause'),
    resume: () => ipcRenderer.invoke('agent:resume'),
    getStatus: () => ipcRenderer.invoke('agent:get-status') as Promise<{
      status: string; uptime: number; issueCount: number; currentTask: string;
      stats: { totalProcessed: number; successRate: number; avgTimePerIssue: number;
        linesGenerated: number; testsWritten: number; prsCreated: number; prsMerged: number };
    }>,
    getConfig: () => ipcRenderer.invoke('agent:get-config') as Promise<{
      repoUrl: string; githubToken: string; ollamaUrl: string; model: string;
      pollInterval: number; autoMerge: boolean; testRequired: boolean;
      labelsToMonitor: string[]; branchPrefix: string; maxConcurrentIssues: number; dryRun: boolean;
    }>,
    setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('agent:set-config', config),
    getIssues: () => ipcRenderer.invoke('agent:get-issues') as Promise<Array<{
      number: number; title: string; labels: Array<{ name: string; color: string }>;
      status: string; assignedAgent: string | null; timeElapsed: number;
      subtasksCompleted: number; subtasksTotal: number; priority: number;
    }>>,
    processIssue: (number: number) => ipcRenderer.invoke('agent:process-issue', number),
    onStateChange: (callback: (state: { status: string; uptime: number; issueCount: number }) => void) => {
      ipcRenderer.on('agent:state-change', (_event, state) => callback(state));
    },
    onProgress: (callback: (progress: { currentTask: string; issueNumber: number; percent: number }) => void) => {
      ipcRenderer.on('agent:progress', (_event, progress) => callback(progress));
    },
    onIssueUpdate: (callback: (update: { number: number; status: string; count: number }) => void) => {
      ipcRenderer.on('agent:issue-update', (_event, update) => callback(update));
    },
    onTestResults: (callback: (results: { issueNumber: number; passed: number; failed: number; details: string[] }) => void) => {
      ipcRenderer.on('agent:test-results', (_event, results) => callback(results));
    },
    onPRCreated: (callback: (pr: { issueNumber: number; prUrl: string; prNumber: number }) => void) => {
      ipcRenderer.on('agent:pr-created', (_event, pr) => callback(pr));
    },
  },
  jarvisDaemon: {
    start: () => ipcRenderer.invoke('daemon:start'),
    stop: () => ipcRenderer.invoke('daemon:stop'),
    status: () => ipcRenderer.invoke('daemon:status'),
    getSettings: () => ipcRenderer.invoke('daemon:get-settings'),
    setSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('daemon:set-settings', settings),
    startVoice: () => ipcRenderer.invoke('daemon:start-voice'),
    stopVoice: () => ipcRenderer.invoke('daemon:stop-voice'),
    processCommand: (transcript: string) => ipcRenderer.invoke('daemon:process-command', transcript),
    showWindow: () => ipcRenderer.invoke('daemon:show-window'),
    hideWindow: () => ipcRenderer.invoke('daemon:hide-window'),
    getLogs: (lines?: number) => ipcRenderer.invoke('daemon:get-logs', lines),
    clearLogs: () => ipcRenderer.invoke('daemon:clear-logs'),
    onStateChange: (callback: (state: { from: string; to: string; timestamp: number }) => void) => {
      ipcRenderer.on('daemon:state-change', (_event, state) => callback(state));
    },
    onStarted: (callback: (status: Record<string, unknown>) => void) => {
      ipcRenderer.on('daemon:started', (_event, status) => callback(status));
    },
    onStopped: (callback: (status: Record<string, unknown>) => void) => {
      ipcRenderer.on('daemon:stopped', (_event, status) => callback(status));
    },
    onVoiceStarted: (callback: () => void) => {
      ipcRenderer.on('daemon:voice-started', () => callback());
    },
    onVoiceStopped: (callback: () => void) => {
      ipcRenderer.on('daemon:voice-stopped', () => callback());
    },
    onCommandReceived: (callback: (data: { transcript: string; timestamp: number }) => void) => {
      ipcRenderer.on('daemon:command-received', (_event, data) => callback(data));
    },
    onCommandProcessed: (callback: (data: { transcript: string; response: string; source: string; timestamp: number }) => void) => {
      ipcRenderer.on('daemon:command-processed', (_event, data) => callback(data));
    },
    onHealthCheck: (callback: (data: Record<string, unknown>) => void) => {
      ipcRenderer.on('daemon:health-check', (_event, data) => callback(data));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('daemon:error', (_event, error) => callback(error));
    },
  },
  selfUpdater: {
    check: () => ipcRenderer.invoke('updater:check'),
    update: (userConfirm?: boolean) => ipcRenderer.invoke('updater:update', userConfirm),
    startAutoCheck: (intervalMs?: number) => ipcRenderer.invoke('updater:start-auto-check', intervalMs),
    stopAutoCheck: () => ipcRenderer.invoke('updater:stop-auto-check'),
    selfModify: (filePath: string, content: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke('updater:self-modify', filePath, content, options),
    analyzeProject: () => ipcRenderer.invoke('updater:analyze-project'),
    readFile: (filePath: string) => ipcRenderer.invoke('updater:read-file', filePath),
    version: () => ipcRenderer.invoke('updater:version'),
    onPhase: (callback: (data: { phase: string; message: string; percent: number }) => void) => {
      ipcRenderer.on('updater:phase', (_event, data) => callback(data));
    },
    onLog: (callback: (data: { message: string; timestamp: string }) => void) => {
      ipcRenderer.on('updater:log', (_event, data) => callback(data));
    },
  },
  codeModifier: {
    readFile: (filePath: string) => ipcRenderer.invoke('code:read-file', filePath),
    editFile: (filePath: string, oldContent: string, newContent: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke('code:edit-file', filePath, oldContent, newContent, options),
    createFile: (filePath: string, content: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke('code:create-file', filePath, content, options),
    deleteFile: (filePath: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke('code:delete-file', filePath, options),
    search: (pattern: string, directory?: string) => ipcRenderer.invoke('code:search', pattern, directory),
    structure: () => ipcRenderer.invoke('code:structure'),
    rollback: () => ipcRenderer.invoke('code:rollback'),
    history: () => ipcRenderer.invoke('code:history'),
    runInstall: () => ipcRenderer.invoke('code:run-install'),
    runBuild: () => ipcRenderer.invoke('code:run-build'),
    restartApp: () => ipcRenderer.invoke('code:restart-app'),
    onFileEdited: (callback: (data: { filePath: string; success: boolean; timestamp: number }) => void) => {
      ipcRenderer.on('code:file-edited', (_event, data) => callback(data));
    },
    onFileCreated: (callback: (data: { filePath: string; success: boolean; timestamp: number }) => void) => {
      ipcRenderer.on('code:file-created', (_event, data) => callback(data));
    },
    onFileDeleted: (callback: (data: { filePath: string; success: boolean; timestamp: number }) => void) => {
      ipcRenderer.on('code:file-deleted', (_event, data) => callback(data));
    },
  },
  email: {
    list: (params) => ipcRenderer.invoke('email:list', params),
    read: (messageId, accountId) => ipcRenderer.invoke('email:read', messageId, accountId),
    send: (params) => ipcRenderer.invoke('email:send', params),
    reply: (messageId, body, bodyHtml, accountId) => ipcRenderer.invoke('email:reply', messageId, body, bodyHtml, accountId),
    markRead: (messageId, accountId) => ipcRenderer.invoke('email:mark-read', messageId, accountId),
    markUnread: (messageId, accountId) => ipcRenderer.invoke('email:mark-unread', messageId, accountId),
    star: (messageId, accountId) => ipcRenderer.invoke('email:star', messageId, accountId),
    unstar: (messageId, accountId) => ipcRenderer.invoke('email:unstar', messageId, accountId),
    delete: (messageId, accountId) => ipcRenderer.invoke('email:delete', messageId, accountId),
    unreadCount: (accountId) => ipcRenderer.invoke('email:unread-count', accountId),
    recent: (count, accountId) => ipcRenderer.invoke('email:recent', count, accountId),
    search: (query, accountId) => ipcRenderer.invoke('email:search', query, accountId),
    accounts: () => ipcRenderer.invoke('email:accounts'),
    removeAccount: (accountId) => ipcRenderer.invoke('email:remove-account', accountId),
    addImap: (config) => ipcRenderer.invoke('email:add-imap', config),
    oauthStart: (provider) => ipcRenderer.invoke('email:oauth-start', provider),
    oauthCallback: (code, provider) => ipcRenderer.invoke('email:oauth-callback', code, provider),
  },
  aiStudio: {
    setKey: (apiKey) => ipcRenderer.invoke('ai-studio:set-key', apiKey),
    keyStatus: () => ipcRenderer.invoke('ai-studio:key-status'),
    listModels: () => ipcRenderer.invoke('ai-studio:list-models'),
    getModel: (modelId) => ipcRenderer.invoke('ai-studio:get-model', modelId),
    generate: (model, prompt, options) => ipcRenderer.invoke('ai-studio:generate', model, prompt, options),
    updateModel: (modelId, updates) => ipcRenderer.invoke('ai-studio:update-model', modelId, updates),
    baseModels: () => ipcRenderer.invoke('ai-studio:base-models'),
    modelInfo: (modelName) => ipcRenderer.invoke('ai-studio:model-info', modelName),
    compare: (prompt, modelA, modelB, options) => ipcRenderer.invoke('ai-studio:compare', prompt, modelA, modelB, options),
    test: (model, prompt, options) => ipcRenderer.invoke('ai-studio:test', model, prompt, options),
    exportConfig: (modelId) => ipcRenderer.invoke('ai-studio:export-config', modelId),
    importConfig: (config) => ipcRenderer.invoke('ai-studio:import-config', config),
  },
  calendar: {
    today: (accountId) => ipcRenderer.invoke('calendar:today', accountId),
    upcoming: (days, accountId) => ipcRenderer.invoke('calendar:upcoming', days, accountId),
    create: (params) => ipcRenderer.invoke('calendar:create', params),
    update: (eventId, updates) => ipcRenderer.invoke('calendar:update', eventId, updates),
    delete: (eventId, accountId) => ipcRenderer.invoke('calendar:delete', eventId, accountId),
    freeBusy: (timeMin, timeMax, accountId) => ipcRenderer.invoke('calendar:free-busy', timeMin, timeMax, accountId),
    freeSlots: (date, accountId) => ipcRenderer.invoke('calendar:free-slots', date, accountId),
    accounts: () => ipcRenderer.invoke('calendar:accounts'),
    removeAccount: (accountId) => ipcRenderer.invoke('calendar:remove-account', accountId),
    oauthStart: (provider) => ipcRenderer.invoke('calendar:oauth-start', provider),
    oauthCallback: (code, provider) => ipcRenderer.invoke('calendar:oauth-callback', code, provider),
    addCaldav: (config) => ipcRenderer.invoke('calendar:add-caldav', config),
  },
  contacts: {
    search: (query, accountId) => ipcRenderer.invoke('contacts:search', query, accountId),
    get: (contactId, accountId) => ipcRenderer.invoke('contacts:get', contactId, accountId),
    create: (contact) => ipcRenderer.invoke('contacts:create', contact),
    delete: (contactId, accountId) => ipcRenderer.invoke('contacts:delete', contactId, accountId),
    byPhone: (phone, accountId) => ipcRenderer.invoke('contacts:by-phone', phone, accountId),
    recent: (count) => ipcRenderer.invoke('contacts:recent', count),
    accounts: () => ipcRenderer.invoke('contacts:accounts'),
    removeAccount: (accountId) => ipcRenderer.invoke('contacts:remove-account', accountId),
    oauthStart: (provider) => ipcRenderer.invoke('contacts:oauth-start', provider),
    oauthCallback: (code, provider) => ipcRenderer.invoke('contacts:oauth-callback', code, provider),
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);
