import { globalShortcut, ipcMain, BrowserWindow } from 'electron';
import { exec, execFile } from 'child_process';
import type { VoiceCommand } from '../shared/types';
import { VOICE, PLATFORM_COMMANDS } from '../shared/constants';

export class VoiceSystem {
  private isListening = false;
  private isPushingToTalk = false;
  private mainWindow: BrowserWindow | null = null;
  private onTranscript: ((command: VoiceCommand) => void) | null = null;

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
    globalShortcut.unregisterAll();
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
    return new Promise((resolve, reject) => {
      const platform = process.platform;

      if (platform === 'darwin') {
        // execFile with an argument array — no shell interpolation of text
        const args = voice ? ['-v', voice, text] : [text];
        execFile('say', args, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } else if (platform === 'win32') {
        // Windows: PowerShell speech synthesis — text is passed as an argv
        // element ($args[0]) so no quoting/escaping of the spoken text is needed.
        const psScript = `
          Add-Type -AssemblyName System.Speech
          $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
          $synth.Speak($args[0])
        `;
        execFile('powershell', ['-NoProfile', '-Command', psScript, text], (error) => {
          if (error) reject(error);
          else resolve();
        });
      } else {
        // Linux: espeak
        const args = voice ? ['-v', voice, text] : [text];
        execFile('espeak', args, (error) => {
          if (error) reject(error);
          else resolve();
        });
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
