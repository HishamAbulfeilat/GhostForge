import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ScreenCaptureOptions, ScreenCaptureResult } from '../shared/types';

const CAPTURE_DIR = join(homedir(), '.ghostforge', 'screenshots');

export class ScreenCapture {
  private captureDir: string;

  constructor() {
    this.captureDir = CAPTURE_DIR;
    if (!existsSync(this.captureDir)) {
      mkdirSync(this.captureDir, { recursive: true });
    }
  }

  async capture(options: ScreenCaptureOptions = {}): Promise<ScreenCaptureResult> {
    const allowedFormats = new Set(['jpeg', 'png', 'jpg']);
    const rawFormat = String(options.format || 'jpeg').toLowerCase();
    const format = allowedFormats.has(rawFormat) ? (rawFormat === 'jpg' ? 'jpeg' : rawFormat) : 'jpeg';
    const quality = Math.max(0, Math.min(100, Math.floor(Number(options.quality) || 70)));
    const captureAll = Boolean(options.captureAll);
    const platform = process.platform;
    const filename = `capture-${randomUUID().slice(0, 8)}.${format}`;
    const filepath = join(this.captureDir, filename);

    try {
      if (platform === 'darwin') {
        this.captureMacOS(filepath, format, quality, captureAll);
      } else if (platform === 'win32') {
        this.captureWindows(filepath);
      } else {
        this.captureLinux(filepath);
      }

      if (!existsSync(filepath)) {
        throw new Error('Screen capture produced no output file');
      }

      const imageBuffer = readFileSync(filepath);
      const base64 = imageBuffer.toString('base64');

      // Get image dimensions
      let width = 1920;
      let height = 1080;
      try {
        if (format === 'png') {
          // PNG header contains dimensions at bytes 16-23
          if (imageBuffer.length > 24) {
            width = imageBuffer.readUInt32BE(16);
            height = imageBuffer.readUInt32BE(20);
          }
        }
      } catch {}

      // Cleanup
      try { unlinkSync(filepath); } catch {}

      return {
        success: true,
        image: base64,
        format,
        size: imageBuffer.length,
        timestamp: Date.now(),
        width,
        height,
      };
    } catch (error: any) {
      // Cleanup on error
      try { if (existsSync(filepath)) unlinkSync(filepath); } catch {}
      throw new Error(`Screen capture failed: ${error.message}`);
    }
  }

  private captureMacOS(filepath: string, format: string, quality: number, captureAll: boolean): void {
    try {
      // Use execFile to avoid shell interpolation; fallback without -Q on failure
      try {
        execFileSync('screencapture', ['-x', '-t', format, '-Q', String(quality), filepath], { timeout: 5000 });
      } catch {
        execFileSync('screencapture', ['-x', '-t', format, filepath], { timeout: 5000 });
      }
    } catch {
      throw new Error('Screen capture failed — grant Screen Recording permission in System Settings > Privacy & Security');
    }
  }

  private captureWindows(filepath: string): void {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
      $bitmap.Save($args[0])
      $graphics.Dispose()
      $bitmap.Dispose()
    `;
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript, filepath], { timeout: 10000 });
    } catch {
      throw new Error('Screen capture failed on Windows');
    }
  }

  private captureLinux(filepath: string): void {
    const toolArgs: Array<[string, string[]]> = [
      ['gnome-screenshot', ['-f', filepath]],
      ['scrot', [filepath]],
      ['import', ['-window', 'root', filepath]],
      ['maim', [filepath]],
    ];
    for (const [cmd, args] of toolArgs) {
      try {
        execFileSync(cmd, args, { timeout: 5000 });
        if (existsSync(filepath)) return;
      } catch {
        continue;
      }
    }
    throw new Error('No screenshot tool found. Install gnome-screenshot, scrot, imagemagick, or maim.');
  }

  async captureRegion(
    x: number, y: number, width: number, height: number,
    options: ScreenCaptureOptions = {}
  ): Promise<ScreenCaptureResult> {
    const allowedFormats = new Set(['jpeg', 'png', 'jpg']);
    const rawFormat = String(options.format || 'jpeg').toLowerCase();
    const format = allowedFormats.has(rawFormat) ? (rawFormat === 'jpg' ? 'jpeg' : rawFormat) : 'jpeg';
    const quality = Math.max(0, Math.min(100, Math.floor(Number(options.quality) || 70)));
    const platform = process.platform;
    const filename = `region-${randomUUID().slice(0, 8)}.${format}`;
    const filepath = join(this.captureDir, filename);
    const rx = Math.max(0, Math.floor(Number(x) || 0));
    const ry = Math.max(0, Math.floor(Number(y) || 0));
    const rw = Math.max(0, Math.floor(Number(width) || 0));
    const rh = Math.max(0, Math.floor(Number(height) || 0));

    try {
      if (platform === 'darwin') {
        execFileSync('screencapture', ['-R' + `${rx},${ry},${rw},${rh}`, '-t', format, '-Q', String(quality), filepath], { timeout: 5000 });
      } else if (platform === 'win32') {
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          $bitmap = New-Object System.Drawing.Bitmap([int]$args[1], [int]$args[2])
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen([int]$args[3], [int]$args[4], 0, 0, [System.Drawing.Size]::new([int]$args[1], [int]$args[2]))
          $bitmap.Save($args[0])
          $graphics.Dispose()
          $bitmap.Dispose()
        `;
        execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript, filepath, String(rw), String(rh), String(rx), String(ry)], { timeout: 10000 });
      } else {
        execFileSync('import', ['-window', 'root', '-crop', `${rw}x${rh}+${rx}+${ry}`, filepath], { timeout: 5000 });
      }

      if (!existsSync(filepath)) {
        throw new Error('Region capture produced no output');
      }

      const imageBuffer = readFileSync(filepath);
      const base64 = imageBuffer.toString('base64');
      try { unlinkSync(filepath); } catch {}

      return {
        success: true,
        image: base64,
        format,
        size: imageBuffer.length,
        timestamp: Date.now(),
        width,
        height,
      };
    } catch (error: any) {
      try { if (existsSync(filepath)) unlinkSync(filepath); } catch {}
      throw new Error(`Region capture failed: ${error.message}`);
    }
  }

  cleanup(maxAge: number = 3600000): void {
    try {
      const { readdirSync, statSync } = require('fs');
      const files = readdirSync(this.captureDir);
      const now = Date.now();
      for (const file of files) {
        const filepath = join(this.captureDir, file);
        const stat = statSync(filepath);
        if (now - stat.mtimeMs > maxAge) {
          unlinkSync(filepath);
        }
      }
    } catch {}
  }
}
