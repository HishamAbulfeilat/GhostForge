import { sendChunk, sendDone, sendError } from '../utils/sse.js';

const COMMAND_GROUPS = [
  {
    title: '🏗️ Project & Setup',
    rows: [
      ['/setup', 'Interactive project setup wizard'],
      ['/create', 'Scaffold a complete new project'],
      ['/open', 'Open an existing project with GhostForge context'],
      ['/scaffold', 'Generate a focused component, hook, screen, or service'],
      ['/add-feature', 'Add a feature with implementation guidance'],
    ],
  },
  {
    title: '📚 Guidance & Docs',
    rows: [
      ['/health', 'Run the lightweight hosted health checklist'],
      ['/help', 'Show the full GhostForge command reference'],
      ['/docs', 'Generate or improve project documentation'],
      ['/snippet', 'Create reusable code snippets/templates'],
      ['/onboard', 'Generate onboarding guidance for developers'],
    ],
  },
  {
    title: '🔍 Code Quality',
    rows: [
      ['/optimize', 'Suggest performance, bundle, and code-quality improvements'],
      ['/perf', 'Focus on performance profiling and budgets'],
      ['/lint', 'Run linting and formatting checks locally'],
      ['/explain-error', 'Explain an error and propose a fix'],
      ['/diagram', 'Generate architecture, flow, or ERD diagrams'],
    ],
  },
  {
    title: '🔒 Security & QA',
    rows: [
      ['/security', 'Run an OWASP-focused security review'],
      ['/test', 'Auto-detect and run the test strategy locally'],
      ['/qa', 'Generate a QA analysis and report'],
      ['/review', 'Perform a PR review with GhostForge standards'],
    ],
  },
  {
    title: '🎫 Tickets & Delivery',
    rows: [
      ['/tickets', 'Show assigned issues grouped by priority'],
      ['/fix-tickets', 'Plan or execute fixes in priority order'],
      ['/deploy', 'Prepare deployment guidance or trigger rollout steps'],
      ['/release', 'Manage semantic versioning and release flow'],
    ],
  },
  {
    title: '🗄️ Data & Content',
    rows: [
      ['/sql', 'Write queries, reports, schemas, or ETL workflows'],
      ['/mock', 'Generate API mocks, factories, or full mock suites'],
      ['/i18n', 'Set up translations, extraction, and RTL support'],
      ['/storybook', 'Set up Storybook or generate stories'],
    ],
  },
  {
    title: '📝 Git & Workspace',
    rows: [
      ['/commit', 'Generate commit messages and optional push/PR flow'],
      ['/pr-description', 'Draft a pull request description from the diff'],
      ['/upgrade', 'Review and upgrade dependencies'],
      ['/env', 'Validate or sync environment variables'],
    ],
  },
  {
    title: '⚙️ Modes',
    rows: [
      ['/autopilot', 'Toggle hands-off autonomous mode'],
      ['/safe', 'Toggle confirmation-first safe mode'],
    ],
  },
];

function renderGroup(group) {
  const rows = group.rows.map(([command, description]) => `| \`${command}\` | ${description} |`).join('\n');
  return `### ${group.title}\n\n| Command | Description |\n|---------|-------------|\n${rows}\n\n`;
}

export default async function helpHandler(args, context, res) {
  try {
    sendChunk(res, '🤖 **@ghostforge GitHub Copilot Extension**\n\n');
    sendChunk(res, 'Use GhostForge commands in GitHub Copilot Chat across VS Code, GitHub.com, and GitHub Mobile.\n\n');
    sendChunk(res, '**Usage**\n\n- Hosted extension: `@ghostforge /command`\n- Local toolkit: `ghostforge-ai` or the existing scripts in this repo\n\n');
    sendChunk(res, '> The hosted extension keeps the local toolkit independent — you can use either workflow at any time.\n\n');

    for (const group of COMMAND_GROUPS) {
      sendChunk(res, renderGroup(group));
    }

    sendChunk(res, '**Quick start**\n\n1. Mention `@ghostforge` in Copilot Chat.\n2. Run `@ghostforge /help`, `@ghostforge /health`, or `@ghostforge /tickets`.\n3. For repository-aware fixes, switch to the local `ghostforge-ai` toolkit when you need workspace access.\n');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to render help.');
  }
}
