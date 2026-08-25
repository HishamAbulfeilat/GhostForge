// tui/lib/platform-utils.js
const { spawn } = require('child_process');

/**
 * Cross-platform clipboard utility
 * @param {string} text - Text to copy to clipboard
 * @returns {boolean} - Success status
 */
function crossPlatformCopy(text) {
  try {
    if (process.platform === 'darwin') {
      // macOS
      const pbcopy = spawn('pbcopy', {});
      pbcopy.stdin.write(text);
      pbcopy.stdin.end();
      return pbcopy.status === 0 || pbcopy.status === null;
    } else if (process.platform === 'win32') {
      // Windows
      const clip = spawn('clip', {}, { shell: true });
      clip.stdin.write(text);
      clip.stdin.end();
      return clip.status === 0 || clip.status === null;
    } else {
      // Linux and other Unix-like
      const xclip = spawn('xclip', ['-selection', 'clipboard']);
      xclip.stdin.write(text);
      xclip.stdin.end();
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
      const open = spawn('open', [url]);
      return open.status === 0 || open.status === null;
    } else if (process.platform === 'win32') {
      // Windows
      const start = spawn('cmd', ['/c', 'start', '', url], { shell: true });
      return start.status === 0 || start.status === null;
    } else {
      // Linux and other Unix-like
      const xdgOpen = spawn('xdg-open', [url]);
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
      // macOS AppleScript
      const applescript = `display notification "${message}" with title "${title}"`;
      const osascript = spawn('osascript', ['-e', applescript]);
      return osascript.status === 0 || osascript.status === null;
    } else if (process.platform === 'win32') {
      // Windows - simple message box via PowerShell
      const escapedMessage = message.replace(/"/g, '""');
      const escapedTitle = title.replace(/"/g, '""');
      const powershell = spawn('powershell', [
        '-Command',
        `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${escapedMessage}', '${escapedTitle}')`
      ]);
      return powershell.status === 0 || powershell.status === null;
    } else {
      // Linux - use zenity or fallback to console
      try {
        const zenity = spawn('zenity', ['--info', '--text=' + message, '--title=' + title]);
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

module.exports = {
  crossPlatformCopy,
  crossPlatformOpen,
  crossPlatformAlert
};