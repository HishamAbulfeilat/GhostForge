import { exec, execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PLATFORM_COMMANDS } from '../shared/constants';

/** Battery status information */
export interface BatteryStatus {
  percent: number | null;
  charging: boolean;
  timeRemaining: number | null;
  present: boolean;
}

export class SystemControl {
  private platform: string;

  constructor() {
    this.platform = process.platform;
  }

  private run(cmd: string, timeout = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      });
    });
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

  /** Set screen brightness (0-100). macOS: `brightness` CLI or `displayplacer`, Linux: `xbacklight`/`brightnessctl`. */
  async setBrightness(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const fraction = clamped / 100;

    if (this.platform === 'darwin') {
      try {
        await this.run(`brightness ${fraction}`);
      } catch {
        // fallback: displayplacer if installed
        try {
          await this.run(
            `displayplacer "brightness=${fraction}"`,
          );
        } catch {
          // last resort: AppleScript brightness (0-16 scale)
          const appleLevel = Math.round(fraction * 16);
          await this.run(
            `osascript -e "tell application \\"System Events\\" to tell appearance preferences to set brightness to ${appleLevel}"`,
          );
        }
      }
    } else if (this.platform === 'linux') {
      try {
        await this.run(`brightnessctl set ${clamped}%`);
      } catch {
        await this.run(`xbacklight -set ${clamped}`);
      }
    } else {
      throw new Error('Brightness control not supported on this platform');
    }
  }

  /** Get current screen brightness as a percentage (0-100). */
  async getBrightness(): Promise<number> {
    if (this.platform === 'darwin') {
      try {
        const out = await this.run('brightness -l 2>/dev/null | grep "display0" | awk \'{print $2}\'');
        return Math.round(parseFloat(out) * 100) || 50;
      } catch {
        try {
          const out = await this.run(
            'osascript -e "tell application \\"System Events\\" to tell appearance preferences to get brightness"',
          );
          return Math.round((parseInt(out, 10) / 16) * 100) || 50;
        } catch {
          return 50;
        }
      }
    } else if (this.platform === 'linux') {
      try {
        const out = await this.run('brightnessctl -m | cut -d, -f4 | tr -d %');
        return parseInt(out, 10) || 50;
      } catch {
        try {
          const out = await this.run('xbacklight -get');
          return Math.round(parseFloat(out)) || 50;
        } catch {
          return 50;
        }
      }
    }
    return 50;
  }

  /** Toggle WiFi on/off. macOS: `networksetup`, Linux: `nmcli`. */
  async toggleWifi(): Promise<string> {
    if (this.platform === 'darwin') {
      const current = await this.getWifiStatus();
      const state = current ? 'off' : 'on';
      await this.run(`networksetup -setairportpower en0 ${state}`);
      return `WiFi turned ${state}`;
    } else if (this.platform === 'linux') {
      const current = await this.getWifiStatus();
      const state = current ? 'off' : 'on';
      await this.run(`nmcli radio wifi ${state}`);
      return `WiFi turned ${state}`;
    }
    throw new Error('WiFi toggle not supported on this platform');
  }

  /** Get WiFi status (true = on, false = off). */
  async getWifiStatus(): Promise<boolean> {
    if (this.platform === 'darwin') {
      try {
        const out = await this.run('networksetup -getairportpower en0');
        return out.toLowerCase().includes('on');
      } catch {
        return false;
      }
    } else if (this.platform === 'linux') {
      try {
        const out = await this.run('nmcli radio wifi');
        return out.toLowerCase().includes('enabled');
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Toggle Bluetooth on/off. macOS: `blueutil`. */
  async toggleBluetooth(): Promise<string> {
    if (this.platform === 'darwin') {
      try {
        const out = await this.run('blueutil --power');
        const currentPower = parseInt(out, 10);
        const newState = currentPower ? 0 : 1;
        await this.run(`blueutil --power ${newState}`);
        return `Bluetooth turned ${newState ? 'on' : 'off'}`;
      } catch {
        throw new Error('blueutil not installed. Install with: brew install blueutil');
      }
    }
    throw new Error('Bluetooth toggle not supported on this platform');
  }

  /** Put the computer to sleep. */
  async sleepComputer(): Promise<string> {
    if (this.platform === 'darwin') {
      await this.run('pmset sleepnow');
    } else if (this.platform === 'win32') {
      await this.run('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    } else {
      await this.run('systemctl suspend');
    }
    return 'Computer going to sleep';
  }

  /** Restart the computer. */
  async restartComputer(): Promise<string> {
    if (this.platform === 'win32') {
      await this.run('shutdown /r /t 0');
    } else {
      await this.run('sudo shutdown -r now');
    }
    return 'Computer restarting';
  }

  /** Shut down the computer. */
  async shutdownComputer(): Promise<string> {
    if (this.platform === 'win32') {
      await this.run('shutdown /s /t 0');
    } else {
      await this.run('sudo shutdown -h now');
    }
    return 'Computer shutting down';
  }

  /** Get battery status including percent, charging state, and time remaining. */
  async getBatteryStatus(): Promise<BatteryStatus> {
    if (this.platform === 'darwin') {
      try {
        const out = await this.run('pmset -g batt');
        const pctMatch = out.match(/(\d+)%/);
        const charging = out.includes('charging') || out.includes('AC Power');
        const timeMatch = out.match(/(\d+):(\d+) remaining/);
        return {
          percent: pctMatch ? parseInt(pctMatch[1], 10) : null,
          charging,
          timeRemaining: timeMatch
            ? parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)
            : null,
          present: Boolean(pctMatch),
        };
      } catch {
        return { percent: null, charging: false, timeRemaining: null, present: false };
      }
    } else if (this.platform === 'linux') {
      try {
        const out = await this.run('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo ""');
        const chargingOut = await this.run('cat /sys/class/power_supply/BAT0/status 2>/dev/null || echo "Unknown"');
        return {
          percent: out ? parseInt(out, 10) : null,
          charging: chargingOut.toLowerCase().includes('charging'),
          timeRemaining: null,
          present: Boolean(out),
        };
      } catch {
        return { percent: null, charging: false, timeRemaining: null, present: false };
      }
    } else if (this.platform === 'win32') {
      try {
        const out = await this.run('wmic path Win32_Battery get EstimatedChargeRemaining,BatteryStatus /format:csv');
        const lines = out.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const parts = lines[1].split(',');
          return {
            percent: parseInt(parts[1], 10) || null,
            charging: parts[2]?.trim() === '2',
            timeRemaining: null,
            present: true,
          };
        }
      } catch { /* fall through */ }
      return { percent: null, charging: false, timeRemaining: null, present: false };
    }
    return { percent: null, charging: false, timeRemaining: null, present: false };
  }

  /** Take a screenshot and return the path to the saved file. */
  async takeScreenshot(): Promise<string> {
    const filename = `screenshot-${Date.now()}.png`;
    const outPath = join(homedir(), 'Desktop', filename);

    if (this.platform === 'darwin') {
      await this.run(`screencapture -x "${outPath}"`);
    } else if (this.platform === 'win32') {
      await this.run(`nircmd.exe savescreenshot "${outPath}"`);
    } else {
      await this.run(`gnome-screenshot -f "${outPath}"`);
    }
    return outPath;
  }
}
