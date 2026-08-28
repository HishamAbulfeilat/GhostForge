// tui/lib/platform-utils.js
import { spawn, spawnSync } from 'node:child_process';

/**
 * Get local IP address for PWA setup
 * @returns {string} - Local IP address or localhost if detection fails
 */
function getLocalIP() {
  try {
    if (process.platform === 'win32') {
      // Windows
      const result = spawnSync('ipconfig', [], { shell: true, encoding: 'utf8' });
      const output = result.stdout || '';
      const match = output.match(/IPv4 Address.*?:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
      if (match) return match[1];
    } else if (process.platform === 'darwin') {
      // macOS
      const result = spawnSync('ipconfig', ['getifaddr', 'en0'], { encoding: 'utf8' });
      if (result.stdout && result.stdout.trim()) return result.stdout.trim();
      const result2 = spawnSync('ipconfig', ['getifaddr', 'en1'], { encoding: 'utf8' });
      if (result2.stdout && result2.stdout.trim()) return result2.stdout.trim();
    } else {
      // Linux and other Unix-like
      const result = spawnSync('hostname', ['-I'], { encoding: 'utf8' });
      const out = result.stdout || '';
      const ips = out.trim().split(/\s+/).filter(Boolean);
      if (ips.length > 0) return ips[0];
    }
  } catch (error) {
    console.warn('Local IP detection failed:', error.message);
  }
  // Fallback
  return 'localhost';
}

/**
 * Cross-platform clipboard utility
 * @param {string} text - Text to copy to clipboard
 * @returns {boolean} - Success status
 */
function crossPlatformCopy(text) {
  try {
    if (process.platform === 'darwin') {
      // macOS
      const pbcopy = spawnSync('pbcopy', {}, { input: text, encoding: 'utf8' });
      return pbcopy.status === 0 || pbcopy.status === null;
    } else if (process.platform === 'win32') {
      // Windows
      const clip = spawnSync('clip', [], { input: text, shell: true, encoding: 'utf8' });
      return clip.status === 0 || clip.status === null;
    } else {
      // Linux and other Unix-like
      const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf8' });
      return xclip.status === 0 || xclip.status === null;
    }
  } catch (error) {
    console.warn('Clipboard operation failed:', error.message);
    return false;
  }
}

/**
 * Cross-platform URL opener
 * @param {string} url - URL to open
 * @returns {boolean} - Success status
 */
function crossPlatformOpen(url) {
  try {
    if (process.platform === 'darwin') {
      // macOS
      const open = spawnSync('open', [url]);
      return open.status === 0 || open.status === null;
    } else if (process.platform === 'win32') {
      // Windows
      const start = spawnSync('cmd', ['/c', 'start', '', url], { shell: true });
      return start.status === 0 || start.status === null;
    } else {
      // Linux and other Unix-like
      const xdgOpen = spawnSync('xdg-open', [url]);
      return xdgOpen.status === 0 || xdgOpen.status === null;
    }
  } catch (error) {
    console.warn('URL open failed:', error.message);
    return false;
  }
}

/**
 * Cross-platform alert/notification (for AppleScript replacements)
 * @param {string} message - Message to display
 * @param {string} title - Title for the alert
 * @returns {boolean} - Success status
 */
function crossPlatformAlert(message, title = 'Notification') {
  try {
    if (process.platform === 'darwin') {
      // macOS AppleScript - properly escape for AppleScript
      const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const applescript = `display notification "${escapedMessage}" with title "${escapedTitle}"`;
      const osascript = spawnSync('osascript', ['-e', applescript]);
      return osascript.status === 0 || osascript.status === null;
    } else if (process.platform === 'win32') {
      // Windows - use PowerShell with parameters to avoid injection
      const psScript = `
      [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
      [System.Windows.Forms.MessageBox]::Show($args[0], $args[1])
      `;
      const powershell = spawnSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        psScript,
        message,
        title
      ]);
      return powershell.status === 0 || powershell.status === null;
    } else {
      // Linux - use zenity or fallback to console
      try {
        const zenity = spawnSync('zenity', ['--info', '--text=' + message, '--title=' + title]);
        return zenity.status === 0 || zenity.status === null;
      } catch (zenityError) {
        // Fallback to console if zenity not available
        console.log(`${title}: ${message}`);
        return true;
      }
    }
  } catch (error) {
    console.warn('Alert operation failed:', error.message);
    return false;
  }
}

/**
 * Cross-platform system info utility
 * @returns {Object} - Object containing cpu and battery info
 */
function crossPlatformSysInfo() {
  try {
    const result = { cpu: '0', battery: 'Unknown%' };

    if (process.platform === 'darwin') {
      // macOS
      try {
        const cpuResult = spawnSync('top', ['-l', '1', '-s', '0'], { encoding: 'utf8' });
        const cpuMatch = cpuResult.stdout.match(/CPU usage.*?(\d+\.\d+)% user.*?(\d+\.\d+)% sys/);
        if (cpuMatch) {
          const user = parseFloat(cpuMatch[1]);
          const sys = parseFloat(cpuMatch[2]);
          result.cpu = Math.round(user + sys).toString();
        }

        const batResult = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
        const batMatch = batResult.stdout.match(/([0-9]+)%/);
        if (batMatch) {
          result.battery = batMatch[1] + '%';
        }
      } catch (macError) {
        // Fallback to basic info
        result.cpu = 'N/A';
        result.battery = 'N/A';
      }
    } else if (process.platform === 'win32') {
      // Windows
      try {
        // Get CPU usage via WMIC
        const cpuResult = spawnSync('wmic', ['cpu', 'get', 'loadpercentage'], { encoding: 'utf8' });
        const cpuLines = cpuResult.stdout.trim().split('\n');
        if (cpuLines.length > 1) {
          const cpuLoad = cpuLines[1].trim();
          if (cpuLoad && !isNaN(parseInt(cpuLoad))) {
            result.cpu = cpuLoad;
          }
        }

        // Get battery info via WMIC
        const batResult = spawnSync('wmic', ['path', 'Win32_Battery', 'get', 'EstimatedChargeRemaining'], { encoding: 'utf8' });
        const batLines = batResult.stdout.trim().split('\n');
        if (batLines.length > 1) {
          const charge = batLines[1].trim();
          if (charge && !isNaN(parseInt(charge))) {
            result.battery = charge + '%';
          }
        }
      } catch (winError) {
        // Fallback to basic info
        result.cpu = 'N/A';
        result.battery = 'N/A';
      }
    } else {
      // Linux and other Unix-like
      try {
        // Get CPU usage from /proc/stat
        const statResult = spawnSync('cat', ['/proc/stat'], { encoding: 'utf8' });
        const cpuLine = statResult.stdout.match(/^cpu\s+([0-9]+)/);
        if (cpuLine) {
          // This is a simplified approach - in reality we'd need to calculate delta
          result.cpu = 'N/A'; // Placeholder for proper calculation
        }

        // Try to get battery info from upower or acpi
        let batResult;
        try {
          batResult = spawnSync('acpi', ['-b'], { encoding: 'utf8' });
        } catch (e) {
          try {
            batResult = spawnSync('upower', ['-i', '/org/freedesktop/UPower/devices/battery_BAT0'], { encoding: 'utf8' });
          } catch (e2) {
            batResult = { stdout: '' };
          }
        }

        if (batResult.stdout) {
          const batMatch = batResult.stdout.match(/([0-9]+)%/);
          if (batMatch) {
            result.battery = batMatch[1] + '%';
          }
        }
      } catch (nixError) {
        // Fallback to basic info
        result.cpu = 'N/A';
        result.battery = 'N/A';
      }
    }

    return result;
  } catch (error) {
    console.warn('System info operation failed:', error.message);
    return { cpu: 'Error', battery: 'Error' };
  }
}

/**
 * Cross-platform screenshot utility
 * @param {string} filePath - Path where screenshot should be saved
 * @returns {boolean} - Success status
 */
function crossPlatformScreenshot(filePath) {
  try {
    if (process.platform === 'darwin') {
      // macOS
      const screencapture = spawnSync('screencapture', [filePath]);
      return screencapture.status === 0 || screencapture.status === null;
    } else if (process.platform === 'win32') {
      // Windows - use PowerShell to take screenshot
      const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bitmap.Size)
      $bitmap.Save('${filePath.replace(/\\/g, '\\\\')}')
      $graphics.Dispose()
      $bitmap.Dispose()
      `;
      const powershell = spawnSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        psScript
      ]);
      return powershell.status === 0 || powershell.status === null;
    } else {
      // Linux and other Unix-like - try various screenshot tools
      const tools = [
        { cmd: 'gnome-screenshot', args: ['-f', filePath] },
        { cmd: 'spectacle', args: ['-b', '-n', '-o', filePath] },
        { cmd: 'xfce4-screenshooter', args: ['-f', filePath] },
        { cmd: 'scrot', args: [filePath] },
        { cmd: 'import', args: ['-window', 'root', filePath] }
      ];

      for (const tool of tools) {
        try {
          const result = spawnSync(tool.cmd, tool.args);
          if (result.status === 0) {
            return true;
          }
        } catch (toolError) {
          continue;
        }
      }

      // If all tools failed, try a fallback using dirty rectangle approach
      console.warn('No standard screenshot tool available');
      return false;
    }
  } catch (error) {
    console.warn('Screenshot operation failed:', error.message);
    return false;
  }
}

/**
 * Cross-platform temporary file cleanup
 * @param {string} pattern - File pattern to match (default: 'gfai-*')
 * @param {number} maxAgeMinutes - Maximum age in minutes (default: 60)
 * @returns {boolean} - Success status
 */
function crossPlatformCleanupTempFiles(pattern = 'gfai-*', maxAgeMinutes = 60) {
  try {
    let success = false;

    if (process.platform === 'win32') {
      // Windows - use PowerShell to cleanup temp files
      const psScript = `
      $path = "$env:TEMP"
      $pattern = "${pattern}"
      $minutes = ${maxAgeMinutes}
      Get-ChildItem -Path $path -Filter $pattern | Where-Object {
          $_.LastWriteTime -lt (Get-Date).AddMinutes(-$minutes)
      } | Remove-Item -Force -ErrorAction SilentlyContinue
      `;
      const powershell = spawnSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        psScript
      ]);
      success = powershell.status === 0 || powershell.status === null;
    } else {
      // Linux/macOS - use find command (generally available)
      const tmpDir = process.env.TMPDIR || '/tmp';
      const find = spawnSync('find', [tmpDir, '-name', pattern, '-mmin', '+' + maxAgeMinutes.toString(), '-delete']);
      success = find.status === 0 || find.status === null;
    }

    if (!success) {
      console.warn('Temp file cleanup completed with warnings');
    }
    return true; // Always return true to match original behavior (|| true)
  } catch (error) {
    console.warn('Temp file cleanup failed:', error.message);
    return true; // Always return true to match original behavior (|| true)
  }
}

/**
 * Cross-platform DNS cache flush
 * @returns {boolean} - Success status
 */
function crossPlatformFlushDNS() {
  try {
    if (process.platform === 'darwin') {
      // macOS
      const dscacheutil = spawnSync('dscacheutil', ['-flushcache']);
      return dscacheutil.status === 0 || dscacheutil.status === null;
    } else if (process.platform === 'win32') {
      // Windows
      const ipconfig = spawnSync('ipconfig', ['/flushdns']);
      return ipconfig.status === 0 || ipconfig.status === null;
    } else {
      // Linux - try various methods
      const methods = [
        { cmd: 'systemd-resolve', args: ['--flush-caches'] },
        { cmd: 'service', args: ['networking', 'force-reload'] },
        { cmd: '/etc/init.d/dns-clean', args: ['start'] },
        { cmd: 'rndc', args: ['flush'] },
        { cmd: 'systemctl', args: ['restart', 'NetworkManager'] }
      ];

      for (const method of methods) {
        try {
          const result = spawnSync(method.cmd, method.args);
          if (result.status === 0) {
            return true;
          }
        } catch (methodError) {
          // Try next method
          continue;
        }
      }

      // If all methods failed, just return true to avoid breaking flow
      console.warn('DNS flush completed with warnings (no suitable method found)');
      return true;
    }
  } catch (error) {
    console.warn('DNS flush failed:', error.message);
    return true; // Always return true to match original behavior (|| true)
  }
}

/**
 * Cross-platform disk usage utility
 * @param {string} path - Path to check (default: '/')
 * @returns {Object} - Object containing filesystem, size, used, avail, capacity, and mounted info
 */
function crossPlatformDiskUsage(path = '/') {
  try {
    const result = {
      filesystem: '',
      size: '0',
      used: '0',
      avail: '0',
      capacity: '0%',
      mounted: path
    };

    if (process.platform === 'win32') {
      // Windows
      const fsutil = spawnSync('fsutil', ['volume', 'diskfree', path], { encoding: 'utf8' });
      if (fsutil.status === 0) {
        const lines = fsutil.stdout.trim().split('\n');
        const values = {};
        lines.forEach(line => {
          const [key, value] = line.split(':').map(s => s.trim());
          if (key && value) {
            values[key.toLowerCase().replace(' ', '_')] = value;
          }
        });

        if (values['total'] && values['free']) {
          const totalBytes = parseInt(values['total']);
          const freeBytes = parseInt(values['free']);
          const usedBytes = totalBytes - freeBytes;
          const percentUsed = ((usedBytes / totalBytes) * 100).toFixed(0);

          result.size = `${Math.round(totalBytes / (1024*1024*1024))}G`;
          result.used = `${Math.round(usedBytes / (1024*1024*1024))}G`;
          result.avail = `${Math.round(freeBytes / (1024*1024*1024))}G`;
          result.capacity = `${percentUsed}%`;
          result.filesystem = path;
        }
      }
    } else {
      // Linux/macOS
      const df = spawnSync('df', ['-h', path], { encoding: 'utf8' });
      if (df.status === 0) {
        const lines = df.stdout.trim().split('\n');
        if (lines.length >= 2) {
          const headers = lines[0].split(/\s+/);
          const values = lines[1].split(/\s+/);

          const resultObj = {};
          headers.forEach((header, index) => {
            resultObj[header.toLowerCase()] = values[index] || '';
          });

          result.filesystem = resultObj.filesystem || '';
          result.size = resultObj.size || '0';
          result.used = resultObj.used || '0';
          result.avail = resultObj.avail || '0';
          result.capacity = resultObj.capacity || '0%';
          result.mounted = resultObj.mounted || path;
        }
      }
    }

    return result;
  } catch (error) {
    console.warn('Disk usage check failed:', error.message);
    return {
      filesystem: path,
      size: 'Error',
      used: 'Error',
      avail: 'Error',
      capacity: 'Error%',
      mounted: path
    };
  }
}

/**
 * Cross-platform Capacitor opener
 * @param {string} platform - Platform to open (android, ios)
 * @returns {boolean} - Success status
 */
function crossPlatformCapOpen(platform) {
  try {
    if (process.platform === 'darwin') {
      // macOS
      if (platform === 'ios') {
        const open = spawnSync('open', ['ios/App.xcworkspace']);
        return open.status === 0 || open.status === null;
      } else if (platform === 'android') {
        const open = spawnSync('open', ['android']);
        return open.status === 0 || open.status === null;
      }
    } else if (process.platform === 'win32') {
      // Windows
      if (platform === 'ios') {
        console.log('iOS development requires macOS. Please use a Mac for iOS development.');
        return false;
      } else if (platform === 'android') {
        const start = spawnSync('cmd', ['/c', 'start', '', 'android'], { shell: true });
        return start.status === 0 || start.status === null;
      }
    } else {
      // Linux and other Unix-like
      if (platform === 'ios') {
        console.log('iOS development requires macOS. Please use a Mac for iOS development.');
        return false;
      } else if (platform === 'android') {
        const xdgOpen = spawnSync('xdg-open', ['android']);
        return xdgOpen.status === 0 || xdgOpen.status === null;
      }
    }
  } catch (error) {
    console.warn(`Capacitor open failed for ${platform}:`, error.message);
    return false;
  }
}

export {
  crossPlatformCopy,
  crossPlatformOpen,
  crossPlatformAlert,
  getLocalIP,
  crossPlatformSysInfo,
  crossPlatformScreenshot,
  crossPlatformCleanupTempFiles,
  crossPlatformFlushDNS,
  crossPlatformDiskUsage,
  crossPlatformCapOpen
};