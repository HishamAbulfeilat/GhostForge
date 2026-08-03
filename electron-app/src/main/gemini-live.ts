import type { BrowserWindow } from 'electron';
import type { JarvisMemory } from './memory';
import type { VoiceboxIntegration } from './voicebox-integration';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeminiLiveConfig {
  apiKey: string;
  model: string;
  voiceName: string;
  language: string;
  systemPrompt: string;
}

export interface GeminiLiveSettings {
  apiKey: string;
  voiceName: string;
  language: string;
  model: string;
  pushToTalk: boolean;
  volume: number;
}

export type VoiceOutputMode = 'gemini' | 'voicebox' | 'browser' | 'system';

export interface VoiceOutputSettings {
  mode: VoiceOutputMode;
  voiceboxProfile?: string;
  voiceboxEngine?: string;
  voiceboxLanguage?: string;
  voiceboxEffects?: {
    pitchShift?: number;
    reverb?: number;
    delay?: number;
    chorus?: number;
  };
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface GeminiLiveCallbacks {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAudioData?: (audioData: Buffer) => void;
  onError?: (error: string) => void;
  onConnectionChange?: (state: ConnectionState) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ── GeminiLiveVoice ──────────────────────────────────────────────────────────

export class GeminiLiveVoice {
  private config: GeminiLiveConfig;
  private memory: JarvisMemory;
  private mainWindow: BrowserWindow | null = null;
  private ws: InstanceType<typeof globalThis.WebSocket> | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private isListening = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private callbacks: GeminiLiveCallbacks = {};
  private pushToTalkMode = false;
  private voicebox: VoiceboxIntegration | null = null;
  private voiceOutput: VoiceOutputSettings = { mode: 'gemini' };

  constructor(memory: JarvisMemory, config?: Partial<GeminiLiveConfig>) {
    this.memory = memory;
    this.config = {
      apiKey: config?.apiKey || process.env.GEMINI_API_KEY || '',
      model: config?.model || 'models/gemini-2.0-flash-live-001',
      voiceName: config?.voiceName || 'Aoede',
      language: config?.language || 'en-US',
      systemPrompt: config?.systemPrompt || this.buildDefaultSystemPrompt(),
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setCallbacks(callbacks: GeminiLiveCallbacks): void {
    this.callbacks = callbacks;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getIsListening(): boolean {
    return this.isListening;
  }

  getSessionInfo(): { active: boolean; duration: number; sessionId: string | null; connectionState: ConnectionState } {
    return {
      active: this.isListening,
      duration: 0,
      sessionId: this.sessionId,
      connectionState: this.connectionState,
    };
  }

  // ── Connect / Disconnect ───────────────────────────────────────────────────

  async connect(): Promise<boolean> {
    if (!this.config.apiKey) {
      this.emitError('API key not configured');
      return false;
    }

    if (this.ws && this.connectionState === 'connected') {
      return true;
    }

    this.setConnectionState('connecting');

    try {
      await this.createWebSocket();
      return true;
    } catch (err) {
      this.setConnectionState('error');
      this.emitError(`Connection failed: ${(err as Error).message}`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;

    if (this.isListening) {
      this.stopListening();
    }

    if (this.ws) {
      try {
        this.ws.close(1000);
      } catch { /* already closing */ }
      this.ws = null;
    }

    this.sessionId = null;
    this.setConnectionState('disconnected');
  }

  // ── Listening (audio capture happens in renderer, relayed via IPC) ─────────

  startListening(): void {
    if (this.connectionState !== 'connected') return;
    this.isListening = true;
    this.mainWindow?.webContents.send('gemini:listening-started');
  }

  stopListening(): void {
    this.isListening = false;
    this.mainWindow?.webContents.send('gemini:listening-stopped');
  }

  // ── Receive audio chunk from renderer ──────────────────────────────────────

  sendAudioChunkFromRenderer(base64Audio: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isListening) return;

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        ],
      },
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('Failed to send audio chunk:', err);
    }
  }

  // ── Text fallback ──────────────────────────────────────────────────────────

  async sendText(text: string): Promise<void> {
    if (this.connectionState !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const connected = await this.connect();
      if (!connected) return;
    }

    const message = {
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      },
    };

    this.ws!.send(JSON.stringify(message));
  }

  // ── Push-to-talk helpers ───────────────────────────────────────────────────

  setPushToTalk(enabled: boolean): void {
    this.pushToTalkMode = enabled;
  }

  isPushToTalk(): boolean {
    return this.pushToTalkMode;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  updateConfig(updates: Partial<GeminiLiveConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): GeminiLiveConfig {
    return { ...this.config };
  }

  updateSettings(settings: Partial<GeminiLiveSettings>): void {
    if (settings.apiKey !== undefined) this.config.apiKey = settings.apiKey;
    if (settings.voiceName !== undefined) this.config.voiceName = settings.voiceName;
    if (settings.language !== undefined) this.config.language = settings.language;
    if (settings.model !== undefined) this.config.model = settings.model;
    if (settings.pushToTalk !== undefined) this.pushToTalkMode = settings.pushToTalk;
  }

  // ── WebSocket internals ────────────────────────────────────────────────────

  private async createWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // WARNING: the API key stays in the ?key= query parameter because Google's
      // Generative Language Live API only supports query-string auth. It does
      // NOT accept custom headers (standard WebSocket API) or a first-message
      // auth frame — sending { type: 'auth', key } breaks the handshake.
      // Do not move the key into a header or a setup message.
      const url = `${WS_URL}?key=${this.config.apiKey}`;

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      const connectTimeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('Connection timeout'));
      }, 15000);

      this.ws.addEventListener('open', () => {
        clearTimeout(connectTimeout);
        this.sendSetupMessage();
      });

      this.ws.addEventListener('message', (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          const msg = JSON.parse(raw) as Record<string, unknown>;
          this.handleServerMessage(msg);
          if (this.connectionState === 'connecting') {
            clearTimeout(connectTimeout);
            this.reconnectAttempts = 0;
            this.setConnectionState('connected');
            resolve();
          }
        } catch (err) {
          console.error('Failed to parse Gemini Live message:', err);
        }
      });

      this.ws.addEventListener('close', (event) => {
        clearTimeout(connectTimeout);
        const ev = event as unknown as { code: number; reason: string };
        console.log(`Gemini Live WS closed: ${ev.code} ${ev.reason}`);

        if (this.connectionState === 'connecting') {
          reject(new Error(`Connection closed: ${ev.code} ${ev.reason}`));
          return;
        }

        this.setConnectionState('disconnected');

        if (ev.code !== 1000 && ev.code !== 1001) {
          this.scheduleReconnect();
        }
      });

      this.ws.addEventListener('error', (event: Event) => {
        clearTimeout(connectTimeout);
        console.error('Gemini Live WS error:', event);

        if (this.connectionState === 'connecting') {
          reject(new Error('WebSocket error'));
        }

        this.setConnectionState('error');
        this.emitError('WebSocket error');
      });
    });
  }

  private sendSetupMessage(): void {
    const setup = {
      setup: {
        model: this.config.model,
        generationConfig: {
          responseModalities: ['AUDIO', 'TEXT'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voiceName,
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this.config.systemPrompt }],
        },
      },
    };

    this.ws?.send(JSON.stringify(setup));
    this.sessionId = `gemini-live-${Date.now()}`;
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    // Setup complete
    if ('setupComplete' in msg) {
      return;
    }

    // Server content (model response)
    const serverContent = msg.serverContent as Record<string, unknown> | undefined;
    if (serverContent) {
      const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
      const turnComplete = serverContent.turnComplete as boolean | undefined;

      if (modelTurn) {
        const parts = modelTurn.parts as Array<Record<string, unknown>> | undefined;
        if (parts) {
          for (const part of parts) {
            // Text response
            if (part.text) {
              this.callbacks.onTranscript?.(part.text as string, Boolean(turnComplete));
              this.mainWindow?.webContents.send('gemini:transcript', {
                text: part.text,
                isFinal: turnComplete,
              });
            }

            // Audio response — relay base64 to renderer for playback
            if (part.inlineData) {
              const inlineData = part.inlineData as { mimeType: string; data: string };
              if (inlineData.data) {
                const audioBuffer = Buffer.from(inlineData.data, 'base64');
                this.callbacks.onAudioData?.(audioBuffer);
                this.mainWindow?.webContents.send('gemini:audio-data', {
                  data: inlineData.data,
                  mimeType: inlineData.mimeType,
                });
              }
            }
          }
        }
      }
    }

    // Tool call
    const toolCall = msg.toolCall as Record<string, unknown> | undefined;
    if (toolCall) {
      this.mainWindow?.webContents.send('gemini:tool-call', toolCall);
    }

    // Tool call cancellation
    const toolCallCancellation = msg.toolCallCancellation as Record<string, unknown> | undefined;
    if (toolCallCancellation) {
      this.mainWindow?.webContents.send('gemini:tool-call-cancel', toolCallCancellation);
    }
  }

  // ── Reconnection ───────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setConnectionState('error');
      this.emitError('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      if (this.connectionState === 'disconnected') {
        this.mainWindow?.webContents.send('gemini:reconnecting', {
          attempt: this.reconnectAttempts,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
        });
        await this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.callbacks.onConnectionChange?.(state);
    this.mainWindow?.webContents.send('gemini:connection-change', state);
  }

  private emitError(message: string): void {
    this.callbacks.onError?.(message);
    this.mainWindow?.webContents.send('gemini:error', message);
  }

  private buildDefaultSystemPrompt(): string {
    return `You are JARVIS (Just A Rather Very Intelligent System), an advanced AI assistant created by GhostForge.
You are helpful, articulate, and slightly formal in tone — like the AI from Iron Man.
You have access to the user's development environment and can help with coding, system tasks, and general questions.
Keep responses concise and natural for voice interaction.
When speaking, use a calm, confident, and slightly British-influenced tone.
If asked to perform a task, confirm and execute it efficiently.`;
  }

  destroy(): void {
    void this.disconnect();
  }
}
