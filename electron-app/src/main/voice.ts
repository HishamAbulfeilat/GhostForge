import { globalShortcut, ipcMain, BrowserWindow } from 'electron';
import { exec, execFile } from 'child_process';
import type { VoiceCommand } from '../shared/types';
import { VOICE, PLATFORM_COMMANDS } from '../shared/constants';

export class VoiceSystem {
  private isListening = false;
  private isPushingToTalk = false;
  private mainWindow: BrowserWindow | null = null;
  private onTranscript: ((command: VoiceCommand) => void) | null = null;
  private currentSpeech: import('child_process').ChildProcess | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  registerPushToTalk(): void {
    const modifiers = VOICE.pushToTalkModifiers;
    const key = VOICE.pushToTalkKey;

    // Register Ctrl+Alt+V as push-to-talk
    const ret = globalShortcut.register('CommandOrControl+Alt+V', () => {
      // This is handled via keydown/keyup in the renderer
    });

    if (!ret) {
      console.warn('Failed to register push-to-talk shortcut');
    }
  }

  unregisterAll(): void {
    globalShortcut.unregister('CommandOrControl+Alt+V');
    this.stopCurrentSpeech();
  }
  private stopCurrentSpeech(): void {
    if (this.currentSpeech) {
      try { this.currentSpeech.kill(); } catch {}
      this.currentSpeech = null;
    }
  }

  startListening(): void {
    if (this.isListening) return;
    this.isListening = true;
    this.mainWindow?.webContents.send('voice:started');
  }

  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    this.mainWindow?.webContents.send('voice:stopped');
  }

  handleTranscript(transcript: string, confidence: number = 0.9): void {
    if (!transcript.trim()) return;

    const command: VoiceCommand = {
      transcript: transcript.trim(),
      confidence,
      timestamp: Date.now(),
    };

    this.onTranscript?.(command);
    this.mainWindow?.webContents.send('voice:transcript', command);
  }

  onVoiceCommand(callback: (command: VoiceCommand) => void): void {
    this.onTranscript = callback;
  }

  async speak(text: string, voice?: string): Promise<void> {
    this.stopCurrentSpeech();
    return new Promise((resolve, reject) => {
      const platform = process.platform;
      const onDone = (error: Error | null) => {
        this.currentSpeech = null;
        if (error) reject(error);
        else resolve();
      };
      if (platform === 'darwin') {
        const args = voice ? ['-v', voice, text] : [text];
        this.currentSpeech = execFile('say', args, onDone as any) as any;
      } else if (platform === 'win32') {
        const psScript = `
          Add-Type -AssemblyName System.Speech
          $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
          $synth.Speak($args[0])
        `;
        this.currentSpeech = execFile('powershell', ['-NoProfile', '-Command', psScript, text], onDone as any) as any;
      } else {
        const args = voice ? ['-v', voice, text] : [text];
        this.currentSpeech = execFile('espeak', args, onDone as any) as any;
      }
    });
  }

  setSystemVolume(direction: 'up' | 'down' | 'mute'): void {
    const platform = process.platform as keyof typeof PLATFORM_COMMANDS;
    const commands = PLATFORM_COMMANDS[platform];
    if (!commands) return;

    const cmd = direction === 'up' ? commands.volumeUp
      : direction === 'down' ? commands.volumeDown
      : commands.mute;

    exec(cmd, (error) => {
      if (error) console.warn('Volume control failed:', error.message);
    });
  }
}
