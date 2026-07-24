function escapeAppleScript(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function knownAppleScript(command) {
  const input = String(command || '').trim()
  const lower = input.toLowerCase()

  if (/^open (?:the )?ghostforge dashboard$/i.test(input)) {
    return 'open location "http://localhost:3001/dashboard"'
  }

  const openUrl = input.match(/^(?:open|browse|go to)\s+(https?:\/\/\S+)$/i)
  if (openUrl) {
    return `open location "${escapeAppleScript(openUrl[1])}"`
  }

  const openApp = input.match(/^(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?(.+)$/i)
  if (openApp && !/^https?:\/\//i.test(openApp[1])) {
    return `tell application "${escapeAppleScript(openApp[1].trim())}" to activate`
  }

  const volume = lower.match(/(?:set\s+)?volume(?:\s+to)?\s+(\d{1,3})/)
  if (volume) {
    const level = Math.max(0, Math.min(100, Number(volume[1])))
    return `set volume output volume ${level}`
  }

  if (/\bunmute\b/.test(lower)) return 'set volume without output muted'
  if (/\bmute\b/.test(lower)) return 'set volume with output muted'
  if (/lock (?:the )?(?:mac|screen)|lock computer/.test(lower)) {
    return 'tell application "System Events" to keystroke "q" using {command down, control down}'
  }
  if (/take (?:a )?screenshot|capture (?:the )?screen/.test(lower)) {
    return [
      'set outputDir to (POSIX path of (path to home folder)) & "GhostForge/screenshots"',
      'set outputFile to outputDir & "/screenshot-" & (do shell script "date +%Y%m%d-%H%M%S") & ".png"',
      'do shell script "mkdir -p " & quoted form of outputDir & " && screencapture -x " & quoted form of outputFile',
      'return outputFile',
    ].join('\n')
  }
  if (/show (?:the )?desktop/.test(lower)) {
    return 'tell application "System Events" to key code 103'
  }
  return null
}

function validateAppleScript(script) {
  const value = String(script || '').trim()
  if (!value) return { ok: false, reason: 'AppleScript is empty' }
  if (value.length > 20_000) return { ok: false, reason: 'AppleScript is too large' }

  const blocked = [
    /do shell script[\s\S]*(?:rm\s+-rf|sudo\s+|shutdown|reboot|mkfs|diskutil\s+erase|dd\s+if=|csrutil\s+disable)/i,
    /do shell script[\s\S]*(?:curl|wget)[\s\S]*\|\s*(?:sh|bash|zsh)/i,
    /tell application "System Events"[\s\S]*delete every/i,
  ]
  if (blocked.some(pattern => pattern.test(value))) {
    return { ok: false, reason: 'Blocked destructive AppleScript pattern' }
  }
  return { ok: true, reason: '' }
}

module.exports = { escapeAppleScript, knownAppleScript, validateAppleScript }
