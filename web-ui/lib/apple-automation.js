function escapeAppleScript(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const APPLE_SCRIPT_ALLOWLIST = Object.freeze({
  openLocation: {
    name: 'open location',
    matcher: script => {
      const value = String(script || '').trim()
      return /^open location "https?:\/\/[^"\n]+"$/i.test(value) ||
        /^tell application "[^"]+"\s*\n\s*activate\s*\n\s*open location "https?:\/\/[^"\n]+"\s*\n\s*end tell$/is.test(value)
    },
  },
  activateApp: {
    name: 'activate app',
    matcher: script => /^tell application "[^"]+" to activate$/i.test(String(script || '').trim()),
  },
  setVolume: {
    name: 'set volume',
    matcher: script => /^set volume(?: output volume (?:\d{1,2}|100)| (?:with|without) output muted)$/i.test(String(script || '').trim()),
  },
  lockScreen: {
    name: 'lock screen',
    matcher: script => /^tell application "System Events" to keystroke "q" using \{command down, control down\}$/i.test(String(script || '').trim()),
  },
  showDesktop: {
    name: 'show desktop',
    matcher: script => /^tell application "System Events" to key code 103$/i.test(String(script || '').trim()),
  },
  screenshot: {
    name: 'take screenshot',
    matcher: script => {
      const value = String(script || '').trim()
      return /^set outputDir to \(POSIX path of \(path to home folder\)\) & "GhostForge\/screenshots"\s*\n\s*set outputFile to outputDir & "\/screenshot-" & \(do shell script "date \+%Y%m%d-%H%M%S"\) & "\.png"\s*\n\s*do shell script "mkdir -p " & quoted form of outputDir & " && screencapture -x " & quoted form of outputFile\s*\n\s*return outputFile\s*$/is.test(value)
    },
  },
})

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

  const approved = Object.values(APPLE_SCRIPT_ALLOWLIST).some(({ matcher }) => matcher(value))
  if (!approved) {
    return { ok: false, reason: 'Script is not in the approved allowlist for supported macOS actions' }
  }

  return { ok: true, reason: '' }
}

module.exports = { escapeAppleScript, knownAppleScript, validateAppleScript }
