'use strict'

// Resolves a bash that can run the repo's shell launchers. On Windows the
// System32 / WindowsApps bash.exe is the WSL launcher: without a distro it
// fails ("execvpe(/bin/bash) failed") and it cannot read Windows paths, so
// skip it and prefer Git Bash. Returns null when no usable bash exists.

const fs = require('node:fs')
const path = require('node:path')

function findBash(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return 'bash'

  const isWslLauncher = file => {
    const lower = file.toLowerCase()
    return lower.includes('\\windows\\system32\\') || lower.includes('\\windowsapps\\')
  }

  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  const dirs = (pathKey ? env[pathKey] : '').split(';').filter(Boolean)
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean)
  for (const base of programFiles) {
    dirs.push(path.join(base, 'Git', 'bin'), path.join(base, 'Git', 'usr', 'bin'))
  }

  for (const dir of dirs) {
    const candidate = path.join(dir, 'bash.exe')
    if (isWslLauncher(candidate)) continue
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

module.exports = { findBash }
