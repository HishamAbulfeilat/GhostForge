import { BrowserWindow } from 'electron';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VoiceProfile {
  id: string;
  name: string;
  description?: string;
  language?: string;
  audioSamples?: string[];
  createdAt?: number;
}

export interface Engine {
  id: string;
  name: string;
  description?: string;
}

export interface VoiceboxConfig {
  baseUrl: string;
  defaultProfile?: string;
  defaultEngine?: string;
  defaultLanguage?: string;
  personalityEnabled?: boolean;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
}

interface VoiceboxCallbacks {
  onStatusChange?: (connected: boolean) => void;
  onSpeakComplete?: () => void;
  onSpeakError?: (error: string) => void;
}

// ── VoiceboxIntegration ──────────────────────────────────────────────────────

export class VoiceboxIntegration {
  private baseUrl: string;
  private mainWindow: BrowserWindow | null = null;
  private callbacks: VoiceboxCallbacks = {};
  private connected = false;
  private connectedVersion: string | null = null;
  private config: VoiceboxConfig;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealthCheck = 0;

  constructor(config?: Partial<VoiceboxConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || 'http://127.0.0.1:17493',
      defaultProfile: config?.defaultProfile,
      defaultEngine: config?.defaultEngine || 'kokoro',
      defaultLanguage: config?.defaultLanguage || 'en',
      personalityEnabled: config?.personalityEnabled ?? true,
      autoReconnect: config?.autoReconnect ?? false,
      reconnectIntervalMs: config?.reconnectIntervalMs || 15000,
    };
    this.baseUrl = this.config.baseUrl;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setCallbacks(callbacks: VoiceboxCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Returns cached connection state (sync).
   * Use `checkConnection()` for an actual health check.
   */
  isConnected(): boolean {
    return this.connected;
  }

  getVersion(): string | null {
    return this.connectedVersion;
  }

  getConfig(): VoiceboxConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<VoiceboxConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.baseUrl) this.baseUrl = updates.baseUrl;
    if (updates.autoReconnect !== undefined) {
      if (updates.autoReconnect) this.startAutoReconnect();
      else this.stopAutoReconnect();
    }
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async checkConnection(): Promise<{ connected: boolean; version: string | null }> {
    try {
      const response = await fetch(`${this.baseUrl}/profiles`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        this.connected = true;
        this.connectedVersion = await this.getVersionFromServer();
        this.emitStatus(true);
        return { connected: true, version: this.connectedVersion };
      }
    } catch { /* not available */ }
    this.connected = false;
    this.connectedVersion = null;
    this.emitStatus(false);
    return { connected: false, version: null };
  }

  private async getVersionFromServer(): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json() as { version?: string };
        return data.version || null;
      }
    } catch { /* not available */ }
    return null;
  }

  startAutoReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(async () => {
      if (this.connected) return;
      await this.checkConnection();
    }, this.config.reconnectIntervalMs || 15000);
  }

  stopAutoReconnect(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── TTS - Generate speech ──────────────────────────────────────────────────

  async generateSpeech(
    text: string,
    options: {
      profileId?: string;
      profileName?: string;
      language?: string;
      engine?: string;
      effects?: {
        pitchShift?: number;
        reverb?: number;
        delay?: number;
        chorus?: number;
      };
    } = {}
  ): Promise<{ audio: ArrayBuffer; duration: number }> {
    this.ensureConnected();

    const body: Record<string, unknown> = {
      text,
      engine: options.engine || this.config.defaultEngine,
      language: options.language || this.config.defaultLanguage,
    };

    if (options.profileId) body.profile_id = options.profileId;
    if (options.profileName) body.profile_name = options.profileName;
    if (options.effects) body.effects = options.effects;

    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Voicebox TTS failed (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const duration = estimateAudioDuration(arrayBuffer);

    return { audio: arrayBuffer, duration };
  }

  // ── Agent voice output (for JARVIS responses) ─────────────────────────────

  async speak(
    text: string,
    options: {
      profile?: string;
      personality?: boolean;
      clientId?: string;
    } = {}
  ): Promise<void> {
    this.ensureConnected();

    const body: Record<string, unknown> = {
      text,
      engine: this.config.defaultEngine,
      language: this.config.defaultLanguage,
    };

    if (options.profile) body.profile_id = options.profile;
    if (options.personality !== undefined) body.personality = options.personality;
    if (options.clientId) body.client_id = options.clientId;

    const response = await fetch(`${this.baseUrl}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Voicebox speak failed (${response.status}): ${errText}`);
    }

    this.callbacks.onSpeakComplete?.();
  }

  // ── STT - Transcribe audio ────────────────────────────────────────────────

  async transcribe(
    audioBuffer: ArrayBuffer,
    options: {
      model?: 'base' | 'small' | 'medium' | 'large' | 'turbo';
      language?: string;
    } = {}
  ): Promise<{ text: string; language: string; confidence: number }> {
    this.ensureConnected();

    const body: Record<string, unknown> = {
      audio: Buffer.from(audioBuffer).toString('base64'),
    };

    if (options.model) body.model = options.model;
    if (options.language) body.language = options.language;

    const response = await fetch(`${this.baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Voicebox STT failed (${response.status}): ${errText}`);
    }

    const data = await response.json() as {
      text?: string;
      language?: string;
      confidence?: number;
    };

    return {
      text: data.text || '',
      language: data.language || options.language || 'en',
      confidence: data.confidence ?? 0,
    };
  }

  // ── Voice profiles ────────────────────────────────────────────────────────

  async listProfiles(): Promise<VoiceProfile[]> {
    if (!this.connected) return [];

    try {
      const response = await fetch(`${this.baseUrl}/profiles`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];
      const data = await response.json() as { profiles?: VoiceProfile[] };
      return data.profiles || [];
    } catch {
      return [];
    }
  }

  async getProfile(id: string): Promise<VoiceProfile> {
    this.ensureConnected();

    const response = await fetch(`${this.baseUrl}/profiles/${id}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`Profile not found: ${id}`);
    return (await response.json()) as VoiceProfile;
  }

  async createProfile(options: {
    name: string;
    description?: string;
    audioSamples?: ArrayBuffer[];
    language?: string;
  }): Promise<VoiceProfile> {
    this.ensureConnected();

    const body: Record<string, unknown> = {
      name: options.name,
      language: options.language || 'en',
    };

    if (options.description) body.description = options.description;
    if (options.audioSamples?.length) {
      body.audio_samples = options.audioSamples.map(buf =>
        Buffer.from(buf).toString('base64')
      );
    }

    const response = await fetch(`${this.baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to create profile: ${errText}`);
    }

    return (await response.json()) as VoiceProfile;
  }

  async deleteProfile(id: string): Promise<void> {
    this.ensureConnected();

    const response = await fetch(`${this.baseUrl}/profiles/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to delete profile: ${errText}`);
    }
  }

  async cloneVoice(options: {
    name: string;
    referenceAudio: ArrayBuffer;
    description?: string;
  }): Promise<VoiceProfile> {
    this.ensureConnected();

    const body: Record<string, unknown> = {
      name: options.name,
      reference_audio: Buffer.from(options.referenceAudio).toString('base64'),
    };

    if (options.description) body.description = options.description;

    const response = await fetch(`${this.baseUrl}/profiles/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Voice cloning failed: ${errText}`);
    }

    return (await response.json()) as VoiceProfile;
  }

  // ── Engines ────────────────────────────────────────────────────────────────

  async getEngines(): Promise<Engine[]> {
    if (!this.connected) return [];

    try {
      const response = await fetch(`${this.baseUrl}/engines`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];
      const data = await response.json() as { engines?: Engine[] };
      return data.engines || DEFAULT_ENGINES;
    } catch {
      return DEFAULT_ENGINES;
    }
  }

  // ── Languages ──────────────────────────────────────────────────────────────

  async getLanguages(): Promise<string[]> {
    if (!this.connected) return DEFAULT_LANGUAGES;

    try {
      const response = await fetch(`${this.baseUrl}/languages`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return DEFAULT_LANGUAGES;
      const data = await response.json() as { languages?: string[] };
      return data.languages || DEFAULT_LANGUAGES;
    } catch {
      return DEFAULT_LANGUAGES;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Voicebox is not connected. Start Voicebox and try again.');
    }
  }

  private emitStatus(connected: boolean): void {
    this.callbacks.onStatusChange?.(connected);
    this.mainWindow?.webContents.send('voicebox:status-change', connected);
  }

  destroy(): void {
    this.stopAutoReconnect();
    this.connected = false;
    this.mainWindow = null;
    this.callbacks = {};
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_ENGINES: Engine[] = [
  { id: 'kokoro', name: 'Kokoro', description: 'Fast neural TTS' },
  { id: 'chatterbox', name: 'Chatterbox', description: 'Conversational' },
  { id: 'luxtts', name: 'LuxTTS', description: 'High quality' },
  { id: 'qwen3-tts', name: 'Qwen3-TTS', description: 'Multilingual' },
  { id: 'hume-tada', name: 'HumeAI TADA', description: 'Expressive' },
  { id: 'piper', name: 'Piper', description: 'Lightweight local' },
  { id: 'edge-tts', name: 'Edge TTS', description: 'Microsoft cloud' },
];

export const DEFAULT_LANGUAGES: string[] = [
  'en', 'ar', 'fr', 'de', 'es', 'pt', 'ja', 'ko', 'zh',
  'hi', 'it', 'nl', 'pl', 'ru', 'sv', 'tr', 'uk', 'cs',
  'da', 'fi', 'el', 'he', 'th',
];

export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  hi: 'Hindi',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  sv: 'Swedish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  cs: 'Czech',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  he: 'Hebrew',
  th: 'Thai',
};

// ── Utilities ────────────────────────────────────────────────────────────────

function estimateAudioDuration(buffer: ArrayBuffer): number {
  const bytesPerSecond = 16000 * 2;
  return buffer.byteLength / bytesPerSecond;
}
