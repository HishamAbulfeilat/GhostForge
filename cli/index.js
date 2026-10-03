#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

const COMMAND_SPECS = {
  marketplace: {
    kind: 'bash',
    script: path.join(ROOT, 'scripts', 'marketplace.sh'),
    summary: 'Browse and install marketplace items',
  },
  'agent-team': {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'agents', 'team.mjs'),
    summary: 'Manage the agent-team boss, board, messages, and tasks',
  },
  workflows: {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'workflows.mjs'),
    summary: 'Create, list, update, and run workflow definitions',
  },
  worlds: {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'worlds.mjs'),
    summary: 'Manage local GhostForge world applications',
  },
  files: {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'files.mjs'),
    summary: 'List and read project files (read-only, scoped to a root)',
  },
  jobs: {
    kind: 'bash',
    script: path.join(ROOT, 'scripts', 'jobs.sh'),
    summary: 'Run Job Hunter (CV, search, prepare, approve)',
  },
  users: {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'users.mjs'),
    summary: 'List and update authenticated users and permission sets',
  },
  collab: {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'collab.mjs'),
    summary: 'Create, view, and post to collaboration sessions',
  },
  'device-status': {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'device-status.mjs'),
    summary: 'Check device status and push notifications',
  },
  'awesome-llm-apps': {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'awesome-llm-apps.mjs'),
    summary: 'List and search the curated Awesome LLM Apps catalog',
  },
  n8n: {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'n8n.mjs'),
    summary: 'List, inspect, and safely trigger n8n workflows',
  },
  'package-apps': {
    kind: 'node',
    script: path.join(ROOT, 'scripts', 'package-apps.mjs'),
    summary: 'Build packaged desktop or Android apps with bounded commands',
  },
}

function buildHelp() {
  return [
    'GhostForge CLI',
    '',
    'Usage:',
    '  ghostforge <command> [args]',
    '',
    'Commands:',
    '  marketplace        Browse and install marketplace items',
    '  agent-team         Agent-team status, tasks, and communication',
    '  agents             Alias for agent-team controls',
    '  workflows         Workflow list, create, update, run, and step controls',
    '  worlds            Set up, start, stop, and check AI Town / Agent Office',
    '  files              Read-only list/read of files under a project root (default: cwd)',
    '  jobs               Job Hunter: CV, search, prepare, and approval flows',
    '  users              List and update authenticated users and permissions',
    '  collab             Create, view, and post to collaboration sessions',
    '  device-status      Check device status and push notifications',
    '  awesome-llm-apps   List and search the curated Awesome LLM Apps catalog',
    '  n8n                List, inspect, and trigger active n8n webhooks',
    '  package-apps       Build macOS, Windows, Linux, or Android packages',
    '  help               Show this help',
    '',
    'Aliases:',
    '  ghostforge team        -> ghostforge agent-team',
    '  ghostforge agents      -> ghostforge agent-team',
    '  ghostforge workflow    -> ghostforge workflows',
    '',
    'Examples:',
    '  ghostforge marketplace list',
    '  ghostforge agent-team status',
    '  ghostforge workflows list',
    '  ghostforge worlds status ai-town',
    '  ghostforge worlds start agent-office',
    '  ghostforge files list src',
    '  ghostforge files read README.md --max-bytes 4096',
    '  ghostforge jobs search',
    '  ghostforge users list',
    '  ghostforge collab create',
    '  ghostforge awesome-llm-apps list',
    '  ghostforge package-apps linux --dry-run',
    '',
  ].join('\n')
}

function parseArgs(argv = []) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    return { command: 'help', args: [] }
  }

  const raw = argv[0]
  const normalized = raw === 'team'
    ? 'agent-team'
    : raw === 'agents'
      ? 'agent-team'
    : raw === 'workflow' || raw === 'workflows'
      ? 'workflows'
      : raw === 'n8n'
        ? 'n8n'
      : raw === 'agent-team'
        ? 'agent-team'
        : raw

  return { command: normalized, args: argv.slice(1) }
}

function resolveCommand(command) {
  if (!command) return null
  const normalized = command === 'team'
    ? 'agent-team'
    : command === 'agents'
      ? 'agent-team'
    : command === 'workflow'
      ? 'workflows'
      : command

  return COMMAND_SPECS[normalized] || null
}

function runCommand(spec, args, env = process.env) {
  const isWindows = process.platform === 'win32'
  const base = spec.kind === 'node' ? [process.execPath, [spec.script, ...args]] : ['bash', [spec.script, ...args]]
  const result = spawnSync(base[0], base[1], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...env, GF_CALLER_CWD: process.cwd() }, // scripts run from ROOT; tell them where the user was
    shell: !isWindows && spec.kind === 'bash' ? false : false,
  })

  if (result.error) {
    throw result.error
  }

  return typeof result.status === 'number' ? result.status : 1
}

function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const { command, args } = parseArgs(argv)

  if (command === 'help') {
    stdout.write(`${buildHelp()}\n`)
    return 0
  }

  const spec = resolveCommand(command)
  if (!spec) {
    stderr.write(`Unknown command: ${command}\n\n${buildHelp()}\n`)
    return 1
  }

  try {
    return runCommand(spec, args, env)
  } catch (error) {
    stderr.write(`${error && error.message ? error.message : String(error)}\n`)
    return 1
  }
}

module.exports = {
  ROOT,
  COMMAND_SPECS,
  buildHelp,
  parseArgs,
  resolveCommand,
  main,
}

if (require.main === module) {
  process.exit(main())
}
