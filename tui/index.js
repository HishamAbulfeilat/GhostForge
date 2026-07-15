#!/usr/bin/env node
/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║          GHOSTFORGE AI DEVELOPER TOOLKIT  —  TUI v2.0          ║
 * ║    Powered by GitHub Copilot  |  Built for GhostForge Devs     ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

import { select, input, confirm, checkbox, search } from '@inquirer/prompts';
import chalk from 'chalk';
import boxen from 'boxen';
import figlet from 'figlet';
import Table from 'cli-table3';
import ora from 'ora';
import { execSync, spawn, spawnSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VERSION = existsSync(resolve(ROOT, 'VERSION'))
  ? readFileSync(resolve(ROOT, 'VERSION'), 'utf8').trim()
  : '2.0.0';
const REGISTERED_PROJECTS_FILE = resolve(ROOT, '.registered-projects');
const SCRIPTS_COUNT = existsSync(resolve(ROOT, 'scripts'))
  ? readdirSync(resolve(ROOT, 'scripts')).filter(file => file.endsWith('.sh')).length
  : 0;
figlet.defaults({ fontPath: resolve(__dirname, 'node_modules/figlet/fonts') });

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  brand:    chalk.hex('#0077C8'),      // GhostForge blue
  accent:   chalk.hex('#00A3E0'),      // lighter blue
  success:  chalk.hex('#22C55E'),
  warning:  chalk.hex('#F59E0B'),
  danger:   chalk.hex('#EF4444'),
  muted:    chalk.hex('#6B7280'),
  white:    chalk.white,
  bold:     chalk.bold,
  dim:      chalk.dim,
};

const divider = (char = '─', len = 60) => T.muted(char.repeat(len));

// ─── Utilities ────────────────────────────────────────────────────────────────
function clear() { process.stdout.write('\x1Bc'); }

function banner() {
  const art = figlet.textSync('GHOSTFORGE', { font: 'Big', horizontalLayout: 'default' });
  console.log(T.brand(art));
  console.log(
    boxen(
      T.accent.bold(` AI Developer Toolkit  v${VERSION} `) + T.muted('  |  ') +
      T.white('GitHub Copilot + Azure DevOps') + '\n' +
      T.muted('  React · React Native · Next.js · TypeScript · Tailwind · Full-Stack'),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderColor: '#0077C8', borderStyle: 'round' }
    )
  );
  console.log();
}

function sectionHeader(title, subtitle = '') {
  clear();
  banner();
  console.log(T.brand.bold(`  ► ${title}`));
  if (subtitle) console.log(T.muted(`    ${subtitle}`));
  console.log(divider());
  console.log();
}

function readFile(relPath) {
  const full = resolve(ROOT, relPath);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function expandHome(targetPath) {
  return targetPath.replace(/^~(?=$|\/)/, process.env.HOME || '~');
}

function ensureRegisteredProjectsFile() {
  if (!existsSync(REGISTERED_PROJECTS_FILE)) writeFileSync(REGISTERED_PROJECTS_FILE, '');
}

function getRegisteredProjects() {
  ensureRegisteredProjectsFile();
  return readFileSync(REGISTERED_PROJECTS_FILE, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function saveRegisteredProjects(projects) {
  const unique = [...new Set(projects.map(p => p.trim()).filter(Boolean))];
  writeFileSync(REGISTERED_PROJECTS_FILE, unique.length ? `${unique.join('\n')}\n` : '');
}

function runScriptSync(scriptPath, args = []) {
  const full = resolve(ROOT, scriptPath);
  if (!existsSync(full)) {
    console.log(T.danger(`\n  ✖  Script not found: ${scriptPath}`));
    return false;
  }
  const result = spawnSync('bash', [full, ...args], { stdio: 'inherit', shell: false });
  return result.status === 0;
}

function runScript(scriptPath, args = []) {
  const full = resolve(ROOT, scriptPath);
  if (!existsSync(full)) { console.log(T.danger(`\n  ✖  Script not found: ${scriptPath}`)); return; }
  try {
    const child = spawn('bash', [full, ...args], { stdio: 'inherit', shell: false });
    child.on('exit', () => pressEnter());
  } catch (e) {
    console.log(T.danger(`\n  ✖  ${e.message}`));
  }
}

async function pressEnter() {
  await input({ message: T.muted('  Press ENTER to go back...') });
}

function showMdPreview(filePath, maxLines = 40) {
  const content = readFile(filePath);
  if (!content) { console.log(T.danger(`  File not found: ${filePath}`)); return; }
  const lines = content.split('\n').slice(0, maxLines);
  lines.forEach(line => {
    if (/^#{1,2}\s/.test(line)) console.log(T.brand.bold(line));
    else if (/^#{3,}\s/.test(line)) console.log(T.accent.bold(line));
    else if (/^[-*]\s/.test(line)) console.log(T.white('  ' + line));
    else if (/^`{3}/.test(line)) console.log(T.muted(line));
    else if (/^\|/.test(line)) console.log(T.dim(line));
    else console.log(line);
  });
  if (content.split('\n').length > maxLines) console.log(T.muted(`\n  ... (${content.split('\n').length - maxLines} more lines — open in editor for full view)`));
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const COMMANDS = [
  // Slash commands — category: Project Setup
  { name: '/setup',         cat: '🏗  Setup',      file: 'commands/setup.md',         desc: 'Interactive project wizard — choose language, framework, tools, init repo' },
  { name: '/create',        cat: '🏗  Setup',      file: 'commands/create.md',         desc: 'Scaffold a new React / React Native / Next.js / NestJS project' },
  { name: '/scaffold',      cat: '🏗  Setup',      file: 'commands/scaffold.md',       desc: 'Generate folder structure, components, screens, and boilerplate' },
  { name: '/onboard',       cat: '🏗  Setup',      file: 'commands/onboard.md',        desc: 'Onboard an existing project: add eslint, prettier, CI/CD, agents' },
  { name: '/open',          cat: '🏗  Setup',      file: 'commands/open.md',          desc: 'Open existing project and wire up all GhostForge AI toolkit files' },
  { name: '/env',           cat: '🏗  Setup',      file: 'commands/env.md',            desc: 'Manage .env files: generate, validate, sync secrets' },
  // Development
  { name: '/add-feature',   cat: '💡 Development', file: 'commands/add-feature.md',    desc: 'Add a new feature with tests, types, and documentation' },
  { name: '/docs',          cat: '💡 Development', file: 'commands/docs.md',            desc: 'Generate README, API docs, component docs, Storybook docs, changelog' },
  { name: '/optimize',      cat: '💡 Development', file: 'commands/optimize.md',       desc: 'Analyze and optimize performance, bundle size, and code quality' },
  { name: '/perf',          cat: '💡 Development', file: 'commands/perf.md',            desc: 'Measure runtime performance with Lighthouse, budgets, and baselines' },
  { name: '/lint',          cat: '💡 Development', file: 'commands/lint.md',           desc: 'Run linters, fix auto-fixable issues, report remaining errors' },
  { name: '/mock',          cat: '💡 Development', file: 'commands/mock.md',           desc: 'Generate mock data, MSW handlers, and test fixtures' },
  { name: '/snippet',       cat: '💡 Development', file: 'commands/snippet.md',        desc: 'Browse, insert, and save reusable snippets from the snippet library' },
  { name: '/storybook',     cat: '💡 Development', file: 'commands/storybook.md',      desc: 'Generate or update Storybook stories for components' },
  { name: '/i18n',          cat: '💡 Development', file: 'commands/i18n.md',           desc: 'Add or manage internationalization (i18n) translations' },
  { name: '/explain-error', cat: '💡 Development', file: 'commands/explain-error.md',  desc: 'Explain an error message and provide a fix' },
  { name: '/diagram',       cat: '💡 Development', file: 'commands/diagram.md',        desc: 'Generate architecture, flow, or ER diagrams (Mermaid)' },
  // Quality & Security
  { name: '/health',        cat: '🔒 Security',    file: 'commands/health.md',         desc: 'Score project health across audit, deps, coverage, bundle, tickets, lint' },
  { name: '/security',      cat: '🔒 Security',    file: 'commands/security.md',       desc: 'Full security audit: OWASP, dependency scan, secrets check' },
  { name: '/test',          cat: '🧪 QA',          file: 'commands/test.md',           desc: 'Auto-detect test framework and run tests with coverage' },
  { name: '/qa',            cat: '🧪 QA',          file: 'commands/qa.md',             desc: 'End-to-end QA: functional, UI, accessibility, performance' },
  // Tickets & Git
  { name: '/tickets',       cat: '🎫 Tickets',     file: 'commands/tickets.md',        desc: 'Show assigned tickets (GitHub Issues / Azure DevOps / Jira)' },
  { name: '/fix-tickets',   cat: '🎫 Tickets',     file: 'commands/fix-tickets.md',    desc: 'Auto-fix bugs by priority: critical → high → medium → low' },
  { name: '/commit',        cat: '🔀 Git',         file: 'commands/commit.md',         desc: 'Stage, generate conventional commit message, and push' },
  { name: '/pr-description',cat: '🔀 Git',         file: 'commands/pr-description.md', desc: 'Generate a detailed, structured PR description from diff' },
  { name: '/review',        cat: '🔀 Git',         file: 'commands/review.md',         desc: 'Review staged diff for blockers, warnings, suggestions, and PR notes' },
  { name: '/release',       cat: '🔀 Git',         file: 'commands/release.md',        desc: 'Cut a release: changelog, version bump, tag, draft PR' },
  // Database & Reporting
  { name: '/sql',           cat: '🗄  Data',        file: 'commands/sql.md',            desc: 'Write, optimize, or explain SQL queries and reports' },
  // Deployment
  { name: '/deploy',        cat: '🚀 Deploy',      file: 'commands/deploy.md',         desc: 'Deploy to Azure / GitHub Pages / Vercel / custom server' },
  // Modes & Misc
  { name: '/autopilot',     cat: '⚙️  Modes',       file: 'commands/autopilot.md',      desc: 'Enable autopilot mode — auto-approve all actions (no prompts)' },
  { name: '/safe',          cat: '⚙️  Modes',       file: 'commands/safe.md',           desc: 'Enable safe mode — confirm every action before execution' },
  { name: '/upgrade',       cat: '⚙️  Modes',       file: 'commands/upgrade.md',        desc: 'Upgrade dependencies with safety checks and migration guide' },
  { name: '/help',          cat: '⚙️  Modes',       file: 'commands/help.md',           desc: 'Show full command reference and quick-start guide' },
];

const AGENTS = [
  { name: 'fullstack',      icon: '🌐', file: 'agents/fullstack.md',       desc: 'Full-stack: React + Node/NestJS, REST/GraphQL, DB design' },
  { name: 'frontend-web',   icon: '💻', file: 'agents/frontend-web.md',    desc: 'React JS, Next.js, Tailwind, TypeScript, performance' },
  { name: 'mobile',         icon: '📱', file: 'agents/mobile.md',          desc: 'React Native, Expo, iOS/Android, deep linking, OTA' },
  { name: 'backend',        icon: '⚙️', file: 'agents/backend.md',         desc: 'Node/NestJS, REST, GraphQL, microservices, API design' },
  { name: 'backend-cms',    icon: '📦', file: 'agents/backend-cms.md',     desc: 'Sitecore + Sitefinity CMS, headless architecture' },
  { name: 'sql-etl',        icon: '🗄', file: 'agents/sql-etl.md',         desc: 'SQL Server, ETL pipelines, SSRS reports, Power BI' },
  { name: 'security',       icon: '🔒', file: 'agents/security.md',        desc: 'OWASP, pen testing mindset, secrets audit, auth review' },
  { name: 'qa',             icon: '🧪', file: 'agents/qa.md',              desc: 'Jest, Playwright, Detox, E2E automation, accessibility' },
  { name: 'devops',         icon: '🚀', file: 'agents/devops.md',          desc: 'GitHub Actions, Azure Pipelines, Docker, CI/CD' },
  { name: 'ui-ux',          icon: '🎨', file: 'agents/ui-ux.md',           desc: 'Figma, design tokens, accessibility, responsive design' },
  { name: 'ticket-checker', icon: '🎫', file: 'agents/ticket-checker.md', desc: 'GitHub Issues, Azure Boards, Jira — priority triage' },
  { name: 'ai-integration', icon: '🤖', file: 'agents/ai-integration.md', desc: 'OpenAI, Azure AI, LangChain, vector DBs integration' },
  { name: 'data-viz',       icon: '📊', file: 'agents/data-viz.md',        desc: 'D3.js, Chart.js, Recharts, Power BI embedded' },
  { name: 'architect',      icon: '🏛', file: 'agents/architect.md',       desc: 'System design, scalability, microservices, ADRs' },
];

const INSTRUCTIONS = [
  { name: 'react-web',        file: 'instructions/react-web.md',        desc: 'React JS patterns, hooks, performance' },
  { name: 'react-native',     file: 'instructions/react-native.md',     desc: 'React Native / Expo best practices' },
  { name: 'nextjs',           file: 'instructions/nextjs.md',           desc: 'Next.js App Router, SSR, ISR, RSC' },
  { name: 'typescript',       file: 'instructions/typescript.md',       desc: 'TypeScript strict mode, generics, utility types' },
  { name: 'tailwind',         file: 'instructions/tailwind.md',         desc: 'Tailwind CSS patterns and custom themes' },
  { name: 'azure',            file: 'instructions/azure.md',            desc: 'Azure DevOps, AKS, App Service, Storage' },
  { name: 'api-design',       file: 'instructions/api-design.md',       desc: 'REST / GraphQL design, versioning, auth' },
  { name: 'docker',           file: 'instructions/docker.md',           desc: 'Dockerfile, docker-compose, multi-stage builds' },
  { name: 'testing-strategy', file: 'instructions/testing-strategy.md', desc: 'Unit, integration, E2E testing strategies' },
  { name: 'state-management', file: 'instructions/state-management.md', desc: 'Zustand, Redux Toolkit, React Query' },
  { name: 'monorepo',         file: 'instructions/monorepo.md',         desc: 'Nx, Turborepo, pnpm workspaces' },
  { name: 'git-workflow',     file: 'instructions/git-workflow.md',     desc: 'Branching, conventional commits, PR process' },
  { name: 'error-handling',   file: 'instructions/error-handling.md',   desc: 'Error boundaries, logging, Sentry' },
  { name: 'sitecore',         file: 'instructions/sitecore.md',         desc: 'Sitecore XM/XP, JSS, headless architecture' },
  { name: 'sitefinity',       file: 'instructions/sitefinity.md',       desc: 'Sitefinity CMS, .NET, widgets' },
  { name: 'sql-reporting',    file: 'instructions/sql-reporting.md',    desc: 'SQL Server, SSRS, ETL, Power BI' },
  { name: 'figma',            file: 'instructions/figma.md',            desc: 'Figma to code, design tokens' },
  { name: 'react-patterns',   file: 'instructions/react-patterns.md',   desc: 'HOC, compound components, render props' },
  { name: 'ghostforge-config',     file: 'instructions/ghostforge-config.md',     desc: 'Per-project GhostForge config for agents, tests, deploy, tickets' },
  { name: 'general-knowledge',file: 'instructions/general-knowledge.md',desc: 'Full-stack knowledge base' },
];

// ─── Screens ─────────────────────────────────────────────────────────────────

async function screenHome() {
  clear();
  banner();

  // Quick stats
  const stats = [
    ['Commands', COMMANDS.length, T.accent],
    ['Agents',   AGENTS.length,   T.success],
    ['Instructions', INSTRUCTIONS.length, T.warning],
    ['Scripts',  SCRIPTS_COUNT,   T.brand],
  ];
  const statsLine = stats.map(([l, v, c]) => c.bold(` ${v} `) + T.muted(l)).join(T.muted('  │  '));
  console.log('  ' + statsLine);
  console.log(divider());
  console.log();

  const choice = await select({
    message: T.white.bold('What would you like to do?'),
    choices: [
      { name: T.brand.bold('🚀  New Project Setup')         + T.muted('   — wizard: choose stack, init repo, scaffold everything'), value: 'setup' },
      { name: T.brand.bold('📂  Open Existing Project')     + T.muted('   — copy AI files into any existing project + open VS Code'), value: 'open' },
      { name: T.brand.bold('🗂  Manage Projects')           + T.muted('        — registry of all your projects'), value: 'projects' },
      { name: T.success.bold('💊  Project Health Check')    + T.muted(' — score /100: deps, tests, security, lint'), value: 'health' },
      { name: T.accent.bold('⚡  Run a Command')             + T.muted('           — browse all slash commands'), value: 'commands' },
      { name: T.success.bold('🤖  Switch Agent / Role')      + T.muted('      — activate a specialized AI agent'), value: 'agents' },
      { name: T.warning.bold('📚  Browse Instructions')      + T.muted('     — view knowledge base / docs'), value: 'instructions' },
      { name: T.white.bold('🎫  Tickets & Issues')          + T.muted('       — view and fix assigned tickets'), value: 'tickets' },
      { name: T.white.bold('🔒  Security Audit')            + T.muted('         — OWASP scan, dep check, secrets'), value: 'security' },
      { name: T.white.bold('🧪  Run Tests')                 + T.muted('              — auto-detect and run test suite'), value: 'test' },
      { name: T.white.bold('🚀  Deploy')                    + T.muted('                 — deploy to Azure / GitHub / Vercel'), value: 'deploy' },
      { name: T.muted('🌅  Daily Digest') + T.muted('              — morning summary: tickets, security, deps, git'), value: 'digest' },
      { name: T.white.bold('📄  README / Docs')             + T.muted('          — view full toolkit documentation'), value: 'readme' },
      { name: T.muted(`🔖  Version: v${VERSION}`)           + T.muted('          — bump version / run updater'), value: 'version' },
      { name: T.muted('❓  Help & Quick Reference')                                                               , value: 'help' },
      { name: T.danger('✖   Exit')                                                                                , value: 'exit' },
    ],
    pageSize: 17,
  });
  return choice;
}

async function screenCommands() {
  sectionHeader('Slash Commands', 'All commands you can use in GitHub Copilot Chat or the terminal');

  // Group by category
  const cats = [...new Set(COMMANDS.map(c => c.cat))];
  const catChoices = cats.map(cat => ({
    name: T.accent.bold(cat) + T.muted(` (${COMMANDS.filter(c => c.cat === cat).length})`),
    value: cat,
  }));
  catChoices.push({ name: T.muted('← Back'), value: '__back__' });

  const cat = await select({ message: 'Choose a category:', choices: catChoices, pageSize: 12 });
  if (cat === '__back__') return;

  const filtered = COMMANDS.filter(c => c.cat === cat);
  const choices = filtered.map(cmd => ({
    name: T.brand.bold(cmd.name.padEnd(20)) + T.muted(cmd.desc),
    value: cmd.name,
  }));
  choices.push({ name: T.muted('← Back'), value: '__back__' });

  const picked = await select({ message: `Select command (${cat}):`, choices, pageSize: 15 });
  if (picked === '__back__') return screenCommands();

  const cmd = COMMANDS.find(c => c.name === picked);
  if (cmd) {
    console.log();
    console.log(boxen(
      T.brand.bold(cmd.name) + '\n' + T.muted(cmd.desc) + '\n\n' +
      T.white('📁 File: ') + T.dim(cmd.file),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round', title: ' Command Details ' }
    ));
    console.log();
    showMdPreview(cmd.file, 50);
    console.log();
    await pressEnter();
  }
}

async function screenAgents() {
  sectionHeader('AI Agents', 'Specialized agents — tell Copilot "act as <agent>" or select below');

  const table = new Table({
    head: [T.brand.bold('Agent'), T.brand.bold('Role'), T.brand.bold('Focus')],
    colWidths: [18, 10, 48],
    style: { border: ['cyan'] },
  });
  AGENTS.forEach(a => table.push([T.accent.bold(a.name), a.icon, T.muted(a.desc)]));
  console.log(table.toString());
  console.log();

  const choices = AGENTS.map(a => ({
    name: `${a.icon}  ${T.accent.bold(a.name.padEnd(18))} ${T.muted(a.desc)}`,
    value: a.name,
  }));
  choices.push({ name: T.muted('← Back'), value: '__back__' });

  const picked = await select({ message: 'View agent instructions:', choices, pageSize: 16 });
  if (picked === '__back__') return;

  const agent = AGENTS.find(a => a.name === picked);
  if (agent) {
    console.log();
    console.log(boxen(
      `${agent.icon}  ` + T.accent.bold(agent.name) + '\n' + T.muted(agent.desc),
      { padding: 1, borderColor: '#00A3E0', borderStyle: 'round', title: ' Agent Details ' }
    ));
    console.log();
    showMdPreview(agent.file, 60);
    console.log();
    const activate = await confirm({ message: T.white('Copy activation prompt to clipboard?'), default: false });
    if (activate) {
      const prompt = `Act as ${agent.name} agent from ghostforge-agents toolkit. ${agent.desc}`;
      try {
        execSync(`echo "${prompt}" | pbcopy 2>/dev/null || echo "${prompt}" | xclip -selection clipboard 2>/dev/null`);
        console.log(T.success('  ✔  Copied! Paste into GitHub Copilot Chat.'));
      } catch { console.log(T.warning('  ⚠  Could not copy. Manually copy:\n  ') + T.dim(prompt)); }
    }
    await pressEnter();
  }
}

async function screenInstructions() {
  sectionHeader('Instructions / Knowledge Base', 'Browse the AI instruction files that power Copilot');

  const choices = INSTRUCTIONS.map(i => ({
    name: T.accent.bold(i.name.padEnd(22)) + T.muted(i.desc),
    value: i.name,
  }));
  choices.push({ name: T.muted('← Back'), value: '__back__' });

  const picked = await select({ message: 'Select instruction file:', choices, pageSize: 20 });
  if (picked === '__back__') return;

  const inst = INSTRUCTIONS.find(i => i.name === picked);
  if (inst) {
    console.log();
    showMdPreview(inst.file, 60);
    console.log();
    await pressEnter();
  }
}

async function screenSetup() {
  sectionHeader('🏗  New Project Setup', 'Launch the interactive project creation wizard');

  const mode = await select({
    message: T.white('Choose setup mode:'),
    choices: [
      {
        name: T.success.bold('🤖  AI Mode')  + T.muted(' — describe your project in plain English, AI sets everything up'),
        value: 'ai',
      },
      {
        name: T.accent.bold('📋  Manual Mode') + T.muted(' — step-by-step wizard (14 questions)'),
        value: 'manual',
      },
      { name: T.muted('← Back'), value: '__back__' },
    ],
  });

  if (mode === '__back__') return;

  if (mode === 'ai') {
    const desc = await input({
      message: T.white('Describe your project (e.g. "React Native e-commerce app with auth, payments, TypeScript"):'),
    });
    const spinner = ora({ text: T.accent('Starting AI-powered project setup...'), color: 'cyan' }).start();
    setTimeout(() => { spinner.stop(); runScript('scripts/create-project.sh', ['--ai', desc]); }, 1000);
  } else {
    const ok = await confirm({ message: T.white('This will run the interactive setup wizard. Continue?'), default: true });
    if (ok) runScript('scripts/create-project.sh');
  }
}

async function screenTickets() {
  sectionHeader('🎫  Tickets & Issues', 'View and manage your assigned tickets');

  const action = await select({
    message: T.white('Choose action:'),
    choices: [
      { name: T.accent.bold('/tickets')     + T.muted('     — Show all assigned tickets by priority'), value: 'view' },
      { name: T.warning.bold('/fix-tickets') + T.muted('  — Auto-fix bugs: critical → high → medium → low'), value: 'fix' },
      { name: T.muted('📄  View tickets command docs'), value: 'docs' },
      { name: T.muted('← Back'), value: '__back__' },
    ],
  });

  if (action === '__back__') return;
  if (action === 'docs') {
    console.log(); showMdPreview('commands/tickets.md', 60); console.log();
    await pressEnter(); return;
  }

  const provider = await select({
    message: T.white('Issue tracker:'),
    choices: [
      { name: T.accent('GitHub Issues'),      value: 'github' },
      { name: T.accent('Azure DevOps Boards'), value: 'azure' },
      { name: T.accent('Jira'),               value: 'jira' },
    ],
  });

  const spinner = ora({ text: T.accent(`Fetching ${provider} tickets...`), color: 'cyan' }).start();
  await new Promise(r => setTimeout(r, 1200));
  spinner.stop();

  if (provider === 'github') {
    try {
      const out = execSync('gh issue list --assignee @me --state open --limit 20 --json number,title,labels,milestone 2>/dev/null').toString();
      const issues = JSON.parse(out);
      if (!issues.length) { console.log(T.success('\n  ✔  No open issues assigned to you!')); }
      else {
        const table = new Table({
          head: [T.brand.bold('#'), T.brand.bold('Title'), T.brand.bold('Priority'), T.brand.bold('Labels')],
          colWidths: [6, 44, 12, 20],
          style: { border: ['cyan'] },
        });
        issues.forEach(i => {
          const labels = (i.labels || []).map(l => l.name).join(', ');
          const pri = labels.includes('critical') ? T.danger('🔴 critical')
                    : labels.includes('high')     ? T.warning('🟠 high')
                    : labels.includes('medium')   ? chalk.yellow('🟡 medium')
                    : T.success('🟢 low');
          table.push([T.muted('#' + i.number), i.title.substring(0, 42), pri, T.muted(labels.substring(0, 18))]);
        });
        console.log(table.toString());
      }
    } catch {
      console.log(T.warning('\n  ⚠  GitHub CLI not authenticated. Run: ') + T.dim('gh auth login'));
      console.log(T.muted('\n  To use tickets command in Copilot Chat, type: /tickets'));
    }
  } else {
    console.log(boxen(
      T.white(`Paste this into GitHub Copilot Chat:\n\n`) +
      T.brand.bold(`/${action === 'fix' ? 'fix-tickets' : 'tickets'} --provider ${provider}`),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round', title: ' Copilot Chat Command ' }
    ));
  }
  console.log();
  await pressEnter();
}

async function screenSecurity() {
  sectionHeader('🔒  Security Audit', 'OWASP scan, dependency check, secrets detection');

  const action = await select({
    message: T.white('Choose action:'),
    choices: [
      { name: T.accent('🔍  Dependency audit (npm audit)'),       value: 'npm-audit' },
      { name: T.accent('🔑  Secrets scan (git-secrets / truffle)'), value: 'secrets' },
      { name: T.accent('📄  View /security command docs'),         value: 'docs' },
      { name: T.accent('💬  Get Copilot security prompt'),         value: 'prompt' },
      { name: T.muted('← Back'),                                  value: '__back__' },
    ],
  });

  if (action === '__back__') return;

  if (action === 'docs') {
    console.log(); showMdPreview('commands/security.md', 60); console.log();
  } else if (action === 'npm-audit') {
    const cwd = await input({ message: T.white('Project path (leave blank for current directory):'), default: '.' });
    try {
      const out = execSync(`cd "${cwd}" && npm audit --json 2>/dev/null`, { timeout: 15000 }).toString();
      const data = JSON.parse(out);
      const { critical = 0, high = 0, moderate = 0, low = 0 } = data.metadata?.vulnerabilities || {};
      console.log(boxen(
        T.danger.bold(`Critical: ${critical}`) + '  ' + T.warning.bold(`High: ${high}`) + '\n' +
        chalk.yellow(`Moderate: ${moderate}`) + '  ' + T.success(`Low: ${low}`),
        { padding: 1, borderColor: critical > 0 ? 'red' : high > 0 ? 'yellow' : 'green', borderStyle: 'round', title: ' npm audit results ' }
      ));
    } catch (e) {
      console.log(T.warning('\n  ⚠  Could not run npm audit. Make sure you are in a Node.js project.'));
    }
  } else if (action === 'secrets') {
    const out = execSync(`cd "${process.cwd()}" && git log --all --full-history -- "*.env" 2>/dev/null | head -20`).toString();
    console.log(T.warning('\n  Git history .env references:\n'));
    console.log(T.dim(out || '  None found ✔'));
  } else if (action === 'prompt') {
    console.log(boxen(
      T.white('Copy this into GitHub Copilot Chat:\n\n') +
      T.brand.bold('/security --full --fix'),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round', title: ' Copilot Chat ' }
    ));
  }
  console.log();
  await pressEnter();
}

async function screenTest() {
  sectionHeader('🧪  Run Tests', 'Auto-detect test framework and run suite');

  const action = await select({
    message: T.white('Choose action:'),
    choices: [
      { name: T.accent('▶  Run tests now (auto-detect)'),        value: 'run' },
      { name: T.accent('📄  View /test command docs'),            value: 'docs' },
      { name: T.accent('💬  Get Copilot test generation prompt'), value: 'prompt' },
      { name: T.muted('← Back'),                                 value: '__back__' },
    ],
  });

  if (action === '__back__') return;

  if (action === 'docs') {
    console.log(); showMdPreview('commands/test.md', 60); console.log();
  } else if (action === 'run') {
    const cwd = await input({ message: T.white('Project path:'), default: '.' });
    const spinner = ora({ text: T.accent('Detecting test framework...'), color: 'cyan' }).start();
    await new Promise(r => setTimeout(r, 800));
    spinner.stop();

    // detect
    let cmd = 'npm test';
    const pkg = resolve(cwd, 'package.json');
    if (existsSync(pkg)) {
      const content = JSON.parse(readFileSync(pkg, 'utf8'));
      const deps = { ...content.dependencies, ...content.devDependencies };
      if (deps['vitest']) cmd = 'npx vitest run --coverage';
      else if (deps['jest']) cmd = 'npx jest --coverage';
      else if (deps['@playwright/test']) cmd = 'npx playwright test';
      else if (deps['detox']) cmd = 'npx detox test';
    }
    console.log(T.success(`\n  ► Detected command: `) + T.white.bold(cmd));
    const ok = await confirm({ message: T.white('Run now?'), default: true });
    if (ok) {
      try { execSync(`cd "${cwd}" && ${cmd}`, { stdio: 'inherit', timeout: 120000 }); }
      catch { console.log(T.danger('\n  Tests failed (see output above)')); }
    }
  } else {
    console.log(boxen(
      T.white('Copy into Copilot Chat:\n\n') + T.brand.bold('/test --coverage --watch'),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round', title: ' Copilot Chat ' }
    ));
  }
  console.log();
  await pressEnter();
}

async function screenDeploy() {
  sectionHeader('🚀  Deploy', 'Deploy to Azure, GitHub Pages, Vercel, or custom server');

  const target = await select({
    message: T.white('Deploy target:'),
    choices: [
      { name: T.accent('☁️   Azure App Service / AKS'),    value: 'azure' },
      { name: T.accent('▲   Vercel'),                      value: 'vercel' },
      { name: T.accent('📄  GitHub Pages'),                value: 'gh-pages' },
      { name: T.accent('🐳  Docker + custom server'),      value: 'docker' },
      { name: T.accent('📋  View deploy docs'),            value: 'docs' },
      { name: T.muted('← Back'),                           value: '__back__' },
    ],
  });

  if (target === '__back__') return;
  if (target === 'docs') {
    console.log(); showMdPreview('commands/deploy.md', 60); console.log();
    await pressEnter(); return;
  }

  const env = await select({
    message: T.white('Environment:'),
    choices: [
      { name: T.success('staging'),    value: 'staging' },
      { name: T.warning('production'), value: 'production' },
      { name: T.accent('dev'),         value: 'dev' },
    ],
  });

  if (target === 'azure') {
    const ok = await confirm({ message: T.warning(`Deploy to Azure ${env}?`), default: false });
    if (ok) runScript('scripts/deploy-azure.sh', [env]);
  } else {
    console.log(boxen(
      T.white('Copy into Copilot Chat:\n\n') + T.brand.bold(`/deploy --target ${target} --env ${env}`),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round', title: ' Copilot Chat Command ' }
    ));
    await pressEnter();
  }
}

async function screenHealth() {
  sectionHeader('💊  Project Health Check', 'Score /100 across audit, deps, coverage, bundle, tickets, and lint');

  const target = await input({
    message: T.white('Project path:'),
    default: process.cwd(),
  });
  const shouldFix = await confirm({
    message: T.white('Run safe auto-fixes first when available?'),
    default: false,
  });

  const spinner = ora({ text: T.accent('Running health checks...'), color: 'cyan' }).start();
  await new Promise(r => setTimeout(r, 500));
  spinner.stop();
  runScriptSync('scripts/health-check.sh', shouldFix ? [target, '--fix'] : [target]);
  console.log();
  await pressEnter();
}

async function screenProjects() {
  ensureRegisteredProjectsFile();

  while (true) {
    sectionHeader('🗂  Manage Projects', 'Registry of synced projects and toolkit status');

    const projects = getRegisteredProjects();
    const table = new Table({
      head: [T.brand.bold('#'), T.brand.bold('Project Path'), T.brand.bold('Status'), T.brand.bold('Toolkit')],
      colWidths: [5, 50, 12, 12],
      style: { border: ['cyan'] },
    });

    if (!projects.length) {
      table.push([T.muted('-'), T.muted('No registered projects yet'), T.muted('—'), T.muted('—')]);
    } else {
      projects.forEach((project, index) => {
        const exists = existsSync(project);
        const hasToolkit = exists && (
          existsSync(resolve(project, 'ghostforge-agents')) ||
          existsSync(resolve(project, '.github/copilot-instructions.md'))
        );
        table.push([
          T.muted(String(index + 1)),
          project,
          exists ? T.success('exists') : T.danger('missing'),
          hasToolkit ? T.success('yes') : T.warning('no'),
        ]);
      });
    }

    console.log(table.toString());
    console.log();

    const action = await select({
      message: T.white('Choose action:'),
      choices: [
        { name: T.success('[Add project]'), value: 'add' },
        { name: T.warning('[Remove project]'), value: 'remove' },
        { name: T.accent('[Open project]'), value: 'open' },
        { name: T.brand('[Sync all]'), value: 'sync' },
        { name: T.muted('[← Back]'), value: '__back__' },
      ],
    });

    if (action === '__back__') return;

    if (action === 'add') {
      const nextPath = await input({
        message: T.white('Project path to register:'),
        default: process.cwd(),
      });
      const normalized = resolve(expandHome(nextPath.trim() || process.cwd()));
      saveRegisteredProjects([...projects, normalized]);
      console.log(T.success(`\n  ✔  Registered: ${normalized}`));
      console.log();
      await pressEnter();
      continue;
    }

    if (!projects.length) {
      console.log(T.warning('\n  ⚠  No registered projects yet.'));
      console.log();
      await pressEnter();
      continue;
    }

    if (action === 'remove') {
      const toRemove = await select({
        message: T.white('Remove which project?'),
        choices: projects.map(project => ({ name: project, value: project })).concat({ name: T.muted('← Cancel'), value: '__cancel__' }),
      });
      if (toRemove !== '__cancel__') {
        saveRegisteredProjects(projects.filter(project => project !== toRemove));
        console.log(T.success(`\n  ✔  Removed: ${toRemove}`));
        console.log();
        await pressEnter();
      }
      continue;
    }

    if (action === 'open') {
      const toOpen = await select({
        message: T.white('Open which project?'),
        choices: projects.map(project => ({ name: project, value: project })).concat({ name: T.muted('← Cancel'), value: '__cancel__' }),
      });
      if (toOpen !== '__cancel__') {
        runScriptSync('scripts/open-project.sh', [toOpen]);
        console.log();
        await pressEnter();
      }
      continue;
    }

    if (action === 'sync') {
      const validProjects = projects.filter(project => existsSync(project));
      if (!validProjects.length) {
        console.log(T.warning('\n  ⚠  No valid project paths found to sync.'));
      } else {
        validProjects.forEach(project => {
          console.log(T.accent(`\n  ► Syncing ${project}`));
          runScriptSync('scripts/copy-to-project.sh', [project]);
        });
      }
      console.log();
      await pressEnter();
    }
  }
}

async function screenDigest() {
  sectionHeader('🌅  Daily Digest', 'Morning summary: tickets, security, deps, git, and health cache');

  const target = await input({
    message: T.white('Project path:'),
    default: process.cwd(),
  });

  runScriptSync('scripts/daily-digest.sh', [target]);
  console.log();

  const install = await confirm({
    message: T.white('Install the daily digest to cron or shell profile now?'),
    default: false,
  });
  if (install) {
    runScriptSync('scripts/install-digest-cron.sh', [target]);
    console.log();
  }

  await pressEnter();
}

async function screenReadme() {
  sectionHeader('📄  README / Documentation', 'Full toolkit documentation');
  showMdPreview('README.md', 80);
  console.log();
  await pressEnter();
}

async function screenHelp() {
  sectionHeader('❓  Help & Quick Reference', 'How to use the GhostForge AI Developer Toolkit');

  const table = new Table({
    head: [T.brand.bold('Command'), T.brand.bold('Description')],
    colWidths: [22, 52],
    style: { border: ['cyan'] },
  });

  COMMANDS.slice(0, 20).forEach(c => {
    table.push([T.accent.bold(c.name), T.muted(c.desc)]);
  });
  console.log(table.toString());
  console.log();
  console.log(boxen(
    T.white.bold('3 Ways to Use This Toolkit:\n\n') +
    T.accent('1. TUI    ') + T.muted('→ ') + T.white('This terminal UI  (ghostforge-ai)\n') +
    T.accent('2. Copilot') + T.muted('→ ') + T.white('Type /command in GitHub Copilot Chat\n') +
    T.accent('3. Script ') + T.muted('→ ') + T.white('bash scripts/create-project.sh'),
    { padding: 1, borderColor: '#00A3E0', borderStyle: 'round', title: ' Quick Start ' }
  ));
  console.log();
  await pressEnter();
}

async function screenOpenProject() {
  sectionHeader('📂  Open Existing Project', 'Wire GhostForge AI Toolkit into any existing project');

  const action = await select({
   message: T.white('Choose action:'),
   choices: [
     { name: T.brand.bold('📂  Open / Sync Project') + T.muted('   — copy toolkit files into an existing repo'), value: 'open' },
     { name: T.accent.bold('⚙️  Init Project Config') + T.muted(' — create .ghostforge-config.json for this project'), value: 'config' },
     { name: T.muted('← Back'), value: '__back__' },
   ],
  });

  if (action === '__back__') return;

  const projectPath = await input({
   message: T.white('Enter project path (or leave blank to browse):'),
   default: process.cwd(),
  });

  const target = projectPath.trim() || process.cwd();
  const spinner = ora({
   text: T.accent(action === 'config' ? 'Initializing project config...' : 'Launching open-project wizard...'),
   color: 'cyan',
  }).start();
  await new Promise(r => setTimeout(r, 600));
  spinner.stop();

  if (action === 'config') {
   runScriptSync('scripts/init-config.sh', [target]);
   console.log();
   await pressEnter();
   return;
  }

  runScriptSync('scripts/open-project.sh', [target]);
  console.log();
  await pressEnter();
}

async function screenVersion() {
  sectionHeader(`🔖  Version Management`, `Current toolkit version: v${VERSION}`);

  console.log(boxen(
    T.accent.bold(`  GhostForge AI Developer Toolkit\n\n`) +
    T.white(`  Version  : `) + T.brand.bold(`v${VERSION}`) + '\n' +
    T.white(`  Location : `) + T.muted(ROOT) + '\n' +
    T.white(`  Updated  : `) + T.muted(new Date().toLocaleDateString()),
    { padding: 1, borderColor: '#0077C8', borderStyle: 'round', title: ' Version Info ' }
  ));
  console.log();

  const action = await select({
    message: T.white('Choose action:'),
    choices: [
      { name: T.success.bold('🔄  Run updater')        + T.muted(' — pull latest + bump version + create git tag'), value: 'update' },
      { name: T.accent.bold('📋  View VERSION file')   + T.muted(' — show raw version history'),                    value: 'view' },
      { name: T.muted('← Back'), value: '__back__' },
    ],
  });

  if (action === '__back__') return;

  if (action === 'update') {
    const ok = await confirm({ message: T.white('Run the update + version bump script?'), default: true });
    if (ok) runScript('scripts/update.sh');
  } else if (action === 'view') {
    console.log();
    const vContent = readFile('VERSION');
    console.log(boxen(T.brand.bold('VERSION\n\n') + T.white(vContent || 'File not found'), {
      padding: 1, borderColor: '#0077C8', borderStyle: 'round',
    }));
    console.log();
    await pressEnter();
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
async function main() {
  try {
    while (true) {
      const choice = await screenHome();
      switch (choice) {
        case 'setup':        await screenSetup(); break;
        case 'open':         await screenOpenProject(); break;
        case 'projects':     await screenProjects(); break;
        case 'health':       await screenHealth(); break;
        case 'commands':     await screenCommands(); break;
        case 'agents':       await screenAgents(); break;
        case 'instructions': await screenInstructions(); break;
        case 'tickets':      await screenTickets(); break;
        case 'security':     await screenSecurity(); break;
        case 'test':         await screenTest(); break;
        case 'deploy':       await screenDeploy(); break;
        case 'digest':       await screenDigest(); break;
        case 'readme':       await screenReadme(); break;
        case 'version':      await screenVersion(); break;
        case 'help':         await screenHelp(); break;
        case 'exit':
          clear();
          console.log(boxen(
            T.brand.bold(' Goodbye! Happy coding 🚀 ') + '\n' + T.muted(` GhostForge AI Developer Toolkit — v${VERSION} `),
            { padding: 1, borderColor: '#0077C8', borderStyle: 'double' }
          ));
          console.log();
          process.exit(0);
      }
    }
  } catch (e) {
    if (e.name === 'ExitPromptError' || e.message?.includes('User force closed')) {
      clear();
      console.log(T.muted('\n  Exited. Run again: ') + T.accent('ghostforge-ai') + '\n');
      process.exit(0);
    }
    console.error(T.danger('\n  Error: ') + e.message);
    process.exit(1);
  }
}

main();
