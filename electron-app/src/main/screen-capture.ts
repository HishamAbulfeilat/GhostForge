import { execSync, exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { PLATFORM_COMMANDS } from '../shared/constants';
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
    const { format = 'jpeg', quality = 70, captureAll = false } = options;
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
    const flags = captureAll ? '-x' : '-x';
    try {
      execSync(
        `screencapture ${flags} -t ${format} -Q ${quality} "${filepath}" 2>/dev/null || screencapture -x -t ${format} "${filepath}"`,
        { timeout: 5000, encoding: 'utf-8' }
      );
    } catch {
      throw new Error('Screen capture failed — grant Screen Recording permission in System Settings > Privacy & Security');
    }
  }

  private captureWindows(filepath: string): void {
    // Use PowerShell to capture screen on Windows
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
      $bitmap.Save('${filepath.replace(/\\/g, '\\\\')}')
      $graphics.Dispose()
      $bitmap.Dispose()
    `;
    try {
      execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, {
        timeout: 10000,
        encoding: 'utf-8',
      });
    } catch {
      throw new Error('Screen capture failed on Windows');
    }
  }

  private captureLinux(filepath: string): void {
    // Try multiple Linux screenshot tools
    const tools = [
      `gnome-screenshot -f "${filepath}"`,
      `scrot "${filepath}"`,
      `import -window root "${filepath}"`,
      `maim "${filepath}"`,
    ];

    for (const cmd of tools) {
      try {
        execSync(cmd, { timeout: 5000, encoding: 'utf-8' });
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
    const { format = 'jpeg', quality = 70 } = options;
    const platform = process.platform;
    const filename = `region-${randomUUID().slice(0, 8)}.${format}`;
    const filepath = join(this.captureDir, filename);

    // Coerce to non-negative integers before interpolation into shell commands
    const rx = Math.max(0, Math.floor(Number(x) || 0));
    const ry = Math.max(0, Math.floor(Number(y) || 0));
    const rw = Math.max(0, Math.floor(Number(width) || 0));
    const rh = Math.max(0, Math.floor(Number(height) || 0));

    try {
      if (platform === 'darwin') {
        execSync(
          `screencapture -R${rx},${ry},${rw},${rh} -t ${format} -Q ${quality} "${filepath}"`,
          { timeout: 5000, encoding: 'utf-8' }
        );
      } else if (platform === 'win32') {
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          $bitmap = New-Object System.Drawing.Bitmap(${rw}, ${rh})
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen(${rx}, ${ry}, 0, 0, [System.Drawing.Size]::new(${rw}, ${rh}))
          $bitmap.Save('${filepath.replace(/\\/g, '\\\\')}')
          $graphics.Dispose()
          $bitmap.Dispose()
        `;
        execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, {
          timeout: 10000,
          encoding: 'utf-8',
        });
      } else {
        execSync(
          `import -window root -crop ${rw}x${rh}+${rx}+${ry} "${filepath}"`,
          { timeout: 5000, encoding: 'utf-8' }
        );
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
