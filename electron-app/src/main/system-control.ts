import { exec, execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PLATFORM_COMMANDS } from '../shared/constants';

export class SystemControl {
  private platform: string;

  constructor() {
    this.platform = process.platform;
  }

  async openApp(appName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const commands = PLATFORM_COMMANDS[this.platform];
      if (!commands) {
        reject(new Error(`Unsupported platform: ${this.platform}`));
        return;
      }

      const cmd = `${commands.openApp} "${appName}"`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) reject(new Error(`Failed to open ${appName}: ${error.message}`));
        else resolve(`Opened ${appName}`);
      });
    });
  }

  async openUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const platform = this.platform;
      let cmd: string;

      if (platform === 'darwin') {
        cmd = `open "${url}"`;
      } else if (platform === 'win32') {
        cmd = `start "" "${url}"`;
      } else {
        cmd = `xdg-open "${url}"`;
      }

      exec(cmd, (error) => {
        if (error) reject(new Error(`Failed to open URL: ${error.message}`));
        else resolve(`Opened ${url}`);
      });
    });
  }

  async lockScreen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const commands = PLATFORM_COMMANDS[this.platform];
      if (!commands) {
        reject(new Error(`Unsupported platform: ${this.platform}`));
        return;
      }

      exec(commands.lockScreen, (error) => {
        if (error) reject(new Error(`Failed to lock screen: ${error.message}`));
        else resolve('Screen locked');
      });
    });
  }

  async getSystemInfo(): Promise<{
    platform: string;
    hostname: string;
    uptime: number;
    memory: { total: number; free: number; used: number };
    cpu: string;
  }> {
    const os = require('os');
    return {
      platform: this.platform,
      hostname: os.hostname(),
      uptime: os.uptime(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      },
      cpu: os.cpus()[0]?.model || 'Unknown',
    };
  }

  async getVolume(): Promise<number> {
    return new Promise((resolve) => {
      if (this.platform === 'darwin') {
        exec('osascript -o l -e "output volume of (get volume settings)"', (error, stdout) => {
          resolve(error ? 50 : parseInt(stdout.trim(), 10) || 50);
        });
      } else if (this.platform === 'linux') {
        exec('amixer get Master | grep -oP "\\d+%" | head -1', (error, stdout) => {
          resolve(error ? 50 : parseInt(stdout.replace('%', ''), 10) || 50);
        });
      } else {
        resolve(50); // Windows volume detection is more complex
      }
    });
  }

  async setVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, level));
    return new Promise((resolve, reject) => {
      if (this.platform === 'darwin') {
        exec(`osascript -e "set volume output volume ${clamped}"`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } else if (this.platform === 'linux') {
        exec(`amixer set Master ${clamped}%`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } else {
        resolve(); // Windows requires nircmd or similar
      }
    });
  }

  async listRunningProcesses(): Promise<string[]> {
    return new Promise((resolve) => {
      const cmd = this.platform === 'win32'
        ? 'tasklist /FO CSV /NH'
        : 'ps aux';

      exec(cmd, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const lines = stdout.split('\n').filter(Boolean);
        const processes = lines.slice(0, 50).map(line => line.trim());
        resolve(processes);
      });
    });
  }

  async killProcess(name: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const cmd = this.platform === 'win32'
        ? `taskkill /IM "${name}" /F`
        : `pkill -f "${name}"`;

      exec(cmd, (error) => {
        if (error) reject(new Error(`Failed to kill ${name}: ${error.message}`));
        else resolve(`Killed ${name}`);
      });
    });
  }
}
