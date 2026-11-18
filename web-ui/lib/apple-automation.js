const fs = require('fs')
const os = require('os')
const path = require('path')

function escapeAppleScript(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * A complete AppleScript string literal for `value`: backslash and quote are
 * escaped, line breaks and tabs become \n / \r / \t escapes, and any other
 * control character is dropped, so the literal is always one line and can
 * never end early.
 */
function appleScriptString(value) {
  const body = String(value ?? '')
    // AppleScript also accepts curly double quotes as string delimiters, and
    // «…» are raw event codes; neither may appear in a script (see
    // validateAppleScript), so turn them into plain characters first.
    .replace(/[“”]/g, '"')
    .replace(/«/g, '<<')
    .replace(/»/g, '>>')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u007f]/g, '')
  return `"${body}"`
}

/** Inverse of appleScriptString for a literal's inner text. */
function unescapeAppleScriptString(inner) {
  return String(inner).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c))
}

// The only scripts allowed to reach `do shell script`. They are compared
// verbatim (after line-ending normalisation), never by pattern, so no
// AI-generated variation of a shell call can slip through.
const SHELL_SCRIPT_TEMPLATES = Object.freeze({
  screenshot: [
    'set outputDir to (POSIX path of (path to home folder)) & "GhostForge/screenshots"',
    'set outputFile to outputDir & "/screenshot-" & (do shell script "date +%Y%m%d-%H%M%S") & ".png"',
    'do shell script "mkdir -p " & quoted form of outputDir & " && screencapture -x " & quoted form of outputFile',
    'return outputFile',
  ].join('\n'),
  batteryStatus: 'do shell script "pmset -g batt | grep -o \'[0-9]*%\'"',
})

const SHELL_EXEC_PATTERN = /do\s+shell\s+script/i

function normalizeScript(script) {
  return String(script || '').replace(/\r\n?/g, '\n').trim()
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
  media: {
    name: 'media playback',
    matcher: script => /^tell application "(?:Spotify|Music)" to (?:play|pause|next track|previous track)$/.test(String(script || '').trim()),
  },
})

// ── Parameterised templates ─────────────────────────────────────────────────
// Scripts for the actions Mac Control advertises beyond the one-liners above.
// Each is fixed text in which the only variable parts are complete string
// literals ({S}); the validator accepts a script only if it is one of these
// shapes, line for line (indentation ignored). Builders fill them from
// structured parameters with appleScriptString, so a value can never become
// code.
const S = '{S}'
const PARAM_TEMPLATES = Object.freeze({
  notify: [`display notification ${S} with title "GhostForge"`],
  notifyWithSubtitle: [`display notification ${S} with title "GhostForge" subtitle ${S}`],
  imessage: [
    'tell application "Messages"',
    'try',
    'set targetService to 1st service whose service type = iMessage',
    `set targetBuddy to buddy ${S} of targetService`,
    `send ${S} to targetBuddy`,
    'on error errMsg',
    'display notification errMsg with title "GhostForge"',
    'end try',
    'end tell',
  ],
  // UI scripting types into the frontmost app, so the script refuses to type
  // (and press Return) unless Teams really is in front.
  teams: [
    'tell application "Microsoft Teams" to activate',
    'delay 1.5',
    'tell application "System Events"',
    'tell process "Microsoft Teams"',
    'try',
    'if not frontmost then error "Microsoft Teams is not the frontmost app"',
    'keystroke "k" using command down',
    'delay 0.8',
    `keystroke ${S}`,
    'delay 1.5',
    'if not frontmost then error "Microsoft Teams is not the frontmost app"',
    'key code 36',
    'delay 0.8',
    'if not frontmost then error "Microsoft Teams is not the frontmost app"',
    `keystroke ${S}`,
    'delay 0.3',
    'if not frontmost then error "Microsoft Teams is not the frontmost app"',
    'key code 36',
    'on error errMsg',
    'display notification errMsg with title "GhostForge"',
    'end try',
    'end tell',
    'end tell',
  ],
  mail: [
    'tell application "Mail"',
    `set newMsg to make new outgoing message with properties {subject:${S}, content:${S}, visible:true}`,
    'tell newMsg',
    `make new to recipient at end of to recipients with properties {address:${S}}`,
    'end tell',
    'send newMsg',
    'end tell',
  ],
  finder: [
    'tell application "Finder"',
    'activate',
    `open POSIX file ${S}`,
    'end tell',
  ],
})

const STRING_LITERAL = '"((?:[^"\\\\\\n]|\\\\.)*)"'

function templateRegex(lines) {
  const body = lines
    .map(line => line.split(S).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(STRING_LITERAL))
    .join('\n')
  return new RegExp(`^${body}$`)
}

const PARAM_TEMPLATE_REGEX = Object.freeze(
  Object.fromEntries(Object.entries(PARAM_TEMPLATES).map(([name, lines]) => [name, templateRegex(lines)])),
)

function fillTemplate(name, values) {
  let i = 0
  return PARAM_TEMPLATES[name].map(line => line.split(S).reduce((acc, part, idx) => (idx === 0 ? part : acc + appleScriptString(values[i++]) + part), '')).join('\n')
}

/** Lines trimmed, blank lines dropped: indentation is not significant. */
function canonicalLines(script) {
  return normalizeScript(script).split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}

/** The template a script matches, with its decoded string values, or null. */
function matchParamTemplate(script) {
  const value = canonicalLines(script)
  for (const [name, regex] of Object.entries(PARAM_TEMPLATE_REGEX)) {
    const m = value.match(regex)
    if (m) return { name, values: m.slice(1).map(unescapeAppleScriptString) }
  }
  return null
}

const EMAIL_RE = /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;]+$/

/**
 * Finder may only open an existing folder: opening a file (a .command, a
 * script, a downloaded installer...) would run it. An .app bundle is a folder,
 * and opening it is the same as "open app", which is already allowed.
 */
function finderTargetProblem(target) {
  if (!path.isAbsolute(target)) return 'Finder path must be absolute'
  if (target.split(/[\\/]/).includes('..')) return 'Finder path must not contain ..'
  try {
    if (!fs.statSync(target).isDirectory()) return 'Finder can only open folders'
  } catch {
    return 'Folder not found'
  }
  return null
}

function paramTemplateProblem(match) {
  const nonEmpty = match.values.every(v => v.trim().length > 0)
  if (!nonEmpty) return 'AppleScript has an empty value'
  if (match.name === 'mail' && !EMAIL_RE.test(match.values[2])) return 'Mail recipient is not a valid email address'
  if (match.name === 'finder') return finderTargetProblem(match.values[0])
  return null
}

const SUPPORTED_ACTIONS = Object.freeze([
  'open_app', 'open_url', 'volume', 'mute', 'unmute', 'lock', 'show_desktop', 'screenshot', 'battery',
  'notify', 'imessage', 'teams', 'mail', 'finder', 'media',
])

function expandHome(p) {
  const value = String(p || '').trim()
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

/**
 * Build a script from a structured intent ({ action, ...params }), e.g. what
 * the model returns for a natural-language command. Returns { ok, script } or
 * { ok: false, reason }. Every result still goes through validateAppleScript.
 * @param {Record<string, unknown> | null | undefined} intent
 * @returns {{ ok: true, script: string } | { ok: false, reason: string, script?: undefined }}
 */
function buildAppleScript(intent) {
  /** @param {string} reason @returns {{ ok: false, reason: string }} */
  const fail = reason => ({ ok: false, reason })
  if (!intent || typeof intent !== 'object') return fail('No action given')
  const str = key => (typeof intent[key] === 'string' ? intent[key].trim() : '')
  switch (intent.action) {
    case 'open_app': {
      const app = str('app')
      if (!app || /["\\\n]/.test(app)) return fail('App name is missing or invalid')
      return { ok: true, script: `tell application "${app}" to activate` }
    }
    case 'open_url': {
      const url = str('url')
      if (!/^https?:\/\/[^"\s\\]+$/i.test(url)) return fail('URL must start with http:// or https://')
      return { ok: true, script: `open location "${url}"` }
    }
    case 'volume': {
      const level = Number(intent.level)
      if (!Number.isFinite(level)) return fail('Volume level must be a number')
      return { ok: true, script: `set volume output volume ${Math.max(0, Math.min(100, Math.round(level)))}` }
    }
    case 'mute': return { ok: true, script: 'set volume with output muted' }
    case 'unmute': return { ok: true, script: 'set volume without output muted' }
    case 'lock': return { ok: true, script: 'tell application "System Events" to keystroke "q" using {command down, control down}' }
    case 'show_desktop': return { ok: true, script: 'tell application "System Events" to key code 103' }
    case 'screenshot': return { ok: true, script: SHELL_SCRIPT_TEMPLATES.screenshot }
    case 'battery': return { ok: true, script: SHELL_SCRIPT_TEMPLATES.batteryStatus }
    case 'notify': {
      const message = str('message')
      if (!message) return fail('Notification text is missing')
      const subtitle = str('subtitle')
      return { ok: true, script: subtitle ? fillTemplate('notifyWithSubtitle', [message, subtitle]) : fillTemplate('notify', [message]) }
    }
    case 'imessage':
    case 'teams': {
      const contact = str('contact')
      const message = str('message')
      if (!contact || !message) return fail('Both a contact and a message are needed')
      return { ok: true, script: fillTemplate(intent.action, [contact, message]) }
    }
    case 'mail': {
      const to = str('to')
      if (!EMAIL_RE.test(to)) return fail('Mail recipient is not a valid email address')
      const subject = str('subject')
      const body = str('body')
      if (!subject && !body) return fail('Mail needs a subject or a body')
      return { ok: true, script: fillTemplate('mail', [subject || '(no subject)', body || ' ', to]) }
    }
    case 'finder': {
      const target = path.resolve(expandHome(str('path')) || os.homedir())
      const problem = finderTargetProblem(target)
      if (problem) return fail(problem)
      return { ok: true, script: fillTemplate('finder', [target]) }
    }
    case 'media': {
      const app = /^music$/i.test(str('app')) ? 'Music' : 'Spotify'
      const verbs = { play: 'play', pause: 'pause', next: 'next track', previous: 'previous track' }
      const verb = verbs[str('command').toLowerCase() || 'play']
      if (!verb) return fail('Media command must be play, pause, next or previous')
      return { ok: true, script: `tell application "${app}" to ${verb}` }
    }
    default:
      return fail(`Unsupported action. Mac Control can: ${SUPPORTED_ACTIONS.join(', ')}`)
  }
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

  const imessage = input.match(/^send (?:an? )?imessage to (.+?) saying (.+)$/i)
  if (imessage) return buildAppleScript({ action: 'imessage', contact: unquote(imessage[1]), message: unquote(imessage[2]) }).script || null

  const teams = input.match(/^(?:open teams and )?message (.+?)(?: on teams)?:\s*(.+)$/i)
  if (teams) return buildAppleScript({ action: 'teams', contact: unquote(teams[1]), message: unquote(teams[2]) }).script || null

  const notify = input.match(/^(?:show|display|send) (?:me )?(?:a )?notification(?: saying| that says|:)\s*(.+)$/i)
  if (notify) return buildAppleScript({ action: 'notify', message: unquote(notify[1]) }).script || null

  const mail = input.match(/^send (?:an? )?e-?mail to (\S+@\S+) with subject "([^"]*)" and body "([^"]*)"$/i)
  if (mail) return buildAppleScript({ action: 'mail', to: mail[1], subject: mail[2], body: mail[3] }).script || null

  const finder = input.match(/^open (?:a )?finder(?: window)? (?:at|in|to|on) (?:my |the )?(.+?)(?: folder)?$/i)
  if (finder) {
    const raw = unquote(finder[1])
    const known = raw.match(/^(downloads|documents|desktop|pictures|music|movies|home)$/i)
    const target = known
      ? (known[1].toLowerCase() === 'home' ? '~' : `~/${known[1][0].toUpperCase()}${known[1].slice(1).toLowerCase()}`)
      : raw
    if (known || /^[/~]/.test(raw)) {
      const built = buildAppleScript({ action: 'finder', path: target })
      if (built.ok) return built.script
    }
  }

  const media = input.match(/^(play|pause|next|previous)(?: (?:music|track|song))?(?: (?:in|on) (spotify|music))?$/i)
  if (media) return buildAppleScript({ action: 'media', command: media[1].toLowerCase(), app: media[2] || 'Spotify' }).script || null

  // Only a plain app name: "open Teams and message X" or "open Finder at
  // Downloads" are not app names and go to the model instead.
  const openApp = input.match(/^(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?(.+)$/i)
  if (openApp && !/^https?:\/\//i.test(openApp[1])) {
    const app = openApp[1].trim()
    if (/^[\w .&+'-]{1,40}$/.test(app) && !/\b(?:and|at|with|to|saying|in|for|on|message)\b/i.test(app)) {
      return `tell application "${escapeAppleScript(app)}" to activate`
    }
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
    return SHELL_SCRIPT_TEMPLATES.screenshot
  }
  if (/battery (?:status|level|percentage)|how much battery/.test(lower)) {
    return SHELL_SCRIPT_TEMPLATES.batteryStatus
  }
  if (/show (?:the )?desktop/.test(lower)) {
    return 'tell application "System Events" to key code 103'
  }
  return null
}

function unquote(value) {
  const v = String(value || '').trim()
  const m = v.match(/^["'“‘](.*)["'”’]$/)
  return m ? m[1] : v
}

function validateAppleScript(script) {
  const value = normalizeScript(script)
  if (!value) return { ok: false, reason: 'AppleScript is empty' }
  if (value.length > 20_000) return { ok: false, reason: 'AppleScript is too large' }
  // AppleScript treats “ ” like " as string delimiters, so a curly quote inside
  // what looks like one string literal can end it and start code. «…» are raw
  // Apple event codes. Neither is needed by any supported action.
  if (/[“”«»]/.test(value)) {
    return { ok: false, reason: 'Curly quotes and «» are not allowed in AppleScript here; use straight quotes' }
  }

  if (SHELL_EXEC_PATTERN.test(value)) {
    const exact = Object.values(SHELL_SCRIPT_TEMPLATES).includes(value)
    return exact
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'Shell execution is only allowed through the fixed screenshot and battery status templates' }
  }

  const approved = Object.values(APPLE_SCRIPT_ALLOWLIST).some(({ matcher }) => matcher(value))
  if (approved) return { ok: true, reason: '' }

  const templated = matchParamTemplate(value)
  if (templated) {
    const problem = paramTemplateProblem(templated)
    return problem ? { ok: false, reason: problem } : { ok: true, reason: '' }
  }

  return { ok: false, reason: 'Script is not in the approved allowlist for supported macOS actions' }
}

module.exports = {
  SHELL_SCRIPT_TEMPLATES,
  SUPPORTED_ACTIONS,
  appleScriptString,
  buildAppleScript,
  escapeAppleScript,
  knownAppleScript,
  validateAppleScript,
}
