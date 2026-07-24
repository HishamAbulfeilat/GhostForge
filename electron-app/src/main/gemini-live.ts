import type { BrowserWindow } from 'electron';
import type { JarvisMemory } from './memory';

interface GeminiLiveConfig {
  apiKey: string;
  model: string;
  voiceName: string;
  language: string;
}

interface GeminiSession {
  id: string;
  startedAt: number;
}

export class GeminiLiveVoice {
  private config: GeminiLiveConfig;
  private memory: JarvisMemory;
  private mainWindow: BrowserWindow | null = null;
  private session: GeminiSession | null = null;
  private isListening = false;
  private onTranscript: ((text: string, isFinal: boolean) => void) | null = null;
  private onToolCall: ((tool: string, args: Record<string, unknown>) => void) | null = null;

  constructor(memory: JarvisMemory, config?: Partial<GeminiLiveConfig>) {
    this.memory = memory;
    this.config = {
      apiKey: config?.apiKey || process.env.GEMINI_API_KEY || '',
      model: config?.model || 'gemini-2.0-flash-live-001',
      voiceName: config?.voiceName || 'Puck',
      language: config?.language || 'en-US',
    };
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async startSession(): Promise<boolean> {
    if (!this.config.apiKey) {
      console.warn('Gemini Live API key not configured');
      return false;
    }

    try {
      this.session = {
        id: `live-${Date.now()}`,
        startedAt: Date.now(),
      };

      this.isListening = true;
      this.mainWindow?.webContents.send('gemini:session-started', this.session.id);

      // Start streaming audio to Gemini Live API
      await this.streamAudio();

      return true;
    } catch (error: any) {
      console.error('Failed to start Gemini Live session:', error);
      this.mainWindow?.webContents.send('gemini:error', error.message);
      return false;
    }
  }

  async endSession(): Promise<void> {
    if (!this.session) return;

    this.isListening = false;

    const sessionId = this.session.id;
    this.session = null;

    this.mainWindow?.webContents.send('gemini:session-ended', sessionId);
  }

  private async streamAudio(): Promise<void> {
    if (!this.session || !this.config.apiKey) return;

    // Gemini Live API uses WebSocket for bidirectional audio streaming
    // The actual implementation would use the official Gemini SDK
    // For now, we provide the integration point

    console.log('Gemini Live session active:', this.session.id);
  }

  async sendAudioChunk(audioData: ArrayBuffer): Promise<void> {
    if (!this.session || !this.isListening) return;

    // Convert to base64 for API transmission
    const base64 = Buffer.from(audioData).toString('base64');

    // Send to Gemini Live API via WebSocket
    // In production: ws.send(JSON.stringify({ audio: { data: base64 } }))
  }

  handleModelResponse(response: {
    text?: string;
    audio?: ArrayBuffer;
    toolCall?: { name: string; args: Record<string, unknown> };
  }): void {
    if (response.text) {
      this.onTranscript?.(response.text, true);
      this.mainWindow?.webContents.send('gemini:text', response.text);
    }

    if (response.audio) {
      this.mainWindow?.webContents.send('gemini:audio', response.audio);
    }

    if (response.toolCall) {
      this.onToolCall?.(response.toolCall.name, response.toolCall.args);
      this.mainWindow?.webContents.send('gemini:tool-call', response.toolCall);
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  onTranscriptEvent(callback: (text: string, isFinal: boolean) => void): void {
    this.onTranscript = callback;
  }

  onToolCallEvent(callback: (tool: string, args: Record<string, unknown>) => void): void {
    this.onToolCall = callback;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  updateConfig(updates: Partial<GeminiLiveConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): GeminiLiveConfig {
    return { ...this.config };
  }

  getSessionInfo(): { active: boolean; duration: number; sessionId: string | null } {
    return {
      active: this.isListening,
      duration: this.session ? Date.now() - this.session.startedAt : 0,
      sessionId: this.session?.id || null,
    };
  }
}
