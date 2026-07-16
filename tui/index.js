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
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
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
  { name: '/context',       cat: '💡 Development', file: 'commands/context.md',         desc: 'Read current file/component and inject as context for next request' },
  { name: '/docs',          cat: '💡 Development', file: 'commands/docs.md',            desc: 'Generate README, API docs, component docs, Storybook docs, changelog' },
  { name: '/optimize',      cat: '💡 Development', file: 'commands/optimize.md',       desc: 'Analyze and optimize performance, bundle size, and code quality' },
  { name: '/bundle',        cat: '💡 Development', file: 'commands/bundle.md',          desc: 'Analyze bundle size, flag heavy deps, suggest lazy-loading and tree-shaking' },
  { name: '/perf',          cat: '💡 Development', file: 'commands/perf.md',            desc: 'Measure runtime performance with Lighthouse, budgets, and baselines' },
  { name: '/lint',          cat: '💡 Development', file: 'commands/lint.md',           desc: 'Run linters, fix auto-fixable issues, report remaining errors' },
  { name: '/mock',          cat: '💡 Development', file: 'commands/mock.md',           desc: 'Generate mock data, MSW handlers, and test fixtures' },
  { name: '/snippet',       cat: '💡 Development', file: 'commands/snippet.md',        desc: 'Browse, insert, and save reusable snippets from the snippet library' },
  { name: '/storybook',     cat: '💡 Development', file: 'commands/storybook.md',      desc: 'Generate .stories.tsx for any component — Default, Loading, Error, RTL stories' },
  { name: '/rtl',           cat: '💡 Development', file: 'commands/rtl.md',            desc: 'RTL audit: find physical Tailwind classes and replace with logical properties' },
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
  { name: '/ticket',        cat: '🎫 Tickets',     file: 'commands/ticket.md',         desc: 'Scaffold a feature from a ticket ID — branch, commit template, file structure' },
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
  { name: '/api-types',     cat: '💡 Development', file: 'commands/api-types.md',      desc: 'Fetch OpenAPI/Swagger spec → generate TypeScript types + service file' },
  { name: '/changelog',     cat: '🔀 Git',         file: 'commands/changelog.md',      desc: 'Auto-generate CHANGELOG.md from git commits (Conventional Commits)' },
  { name: '/env-check',     cat: '🏗  Setup',      file: 'commands/env-check.md',      desc: 'Compare .env vs .env.example — flag missing, undocumented, exposed secrets' },
  { name: '/unused',        cat: '💡 Development', file: 'commands/unused.md',         desc: 'Find unused components, exports, and dependencies with knip' },
  { name: '/git-hooks',     cat: '🏗  Setup',      file: 'commands/git-hooks.md',      desc: 'Install Husky + lint-staged + commitlint in one command' },
  { name: '/upgrade',       cat: '⚙️  Modes',       file: 'commands/upgrade.md',        desc: 'Upgrade dependencies with safety checks and migration guide' },
  { name: '/help',          cat: '⚙️  Modes',       file: 'commands/help.md',           desc: 'Show full command reference and quick-start guide' },
  // Marketplace & Extensions
  { name: '/marketplace',   cat: '🏪 Marketplace', file: 'commands/marketplace.md',   desc: 'Browse and install agents, commands, skills, plugins from trusted sources' },
  { name: '/generate',      cat: '🏪 Marketplace', file: 'commands/generate.md',      desc: 'Generate a new custom agent, command, skill, or plugin with a wizard' },
  { name: '/free-models',   cat: '🏪 Marketplace', file: 'commands/free-models.md',   desc: 'Configure and use free AI models: NVIDIA, Groq, Ollama, HuggingFace' },
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
  { name: 'free-models',      file: 'instructions/free-models.md',      desc: 'Free/open-source AI model providers and setup' },
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
      { name: T.success.bold('💊  Project Health Check')    + T.muted(' — score /100: deps, tests, security, lint + badge'), value: 'health' },
      { name: T.accent.bold('⚡  Run a Command')             + T.muted('           — browse all slash commands'), value: 'commands' },
      { name: T.success.bold('🤖  Switch Agent / Role')      + T.muted('      — activate a specialized AI agent'), value: 'agents' },
      { name: T.warning.bold('📚  Browse Instructions')      + T.muted('     — view knowledge base / docs'), value: 'instructions' },
      { name: T.accent.bold('📋  Snippet Library')           + T.muted('         — browse & copy ready-made code snippets'), value: 'snippets' },
      { name: T.white.bold('🔍  Bundle Analyzer')            + T.muted('        — size, heavy deps, lazy-loading tips'), value: 'bundle' },
      { name: T.white.bold('🌐  RTL Audit')                  + T.muted('               — find & fix non-logical Tailwind classes'), value: 'rtl' },
      { name: T.accent.bold('🔑  /api-types')                + T.muted('               — OpenAPI/Swagger → TypeScript types'), value: 'api-types' },
      { name: T.accent.bold('📝  /changelog')                + T.muted('              — generate CHANGELOG from git commits'), value: 'changelog' },
      { name: T.accent.bold('🔒  /env-check')                + T.muted('               — validate .env vs .env.example'), value: 'env-check' },
      { name: T.accent.bold('🧹  /unused')                   + T.muted('                  — find dead code with knip'), value: 'unused' },
      { name: T.accent.bold('🪝  /git-hooks')                + T.muted('              — install husky + lint-staged'), value: 'git-hooks' },
      { name: T.white.bold('🎫  Tickets & Issues')          + T.muted('       — view and fix assigned tickets'), value: 'tickets' },
      { name: T.white.bold('🔒  Security Audit')            + T.muted('         — OWASP scan, dep check, secrets'), value: 'security' },
      { name: T.white.bold('🧪  Run Tests')                 + T.muted('              — auto-detect and run test suite'), value: 'test' },
      { name: T.white.bold('🚀  Deploy')                    + T.muted('                 — deploy to Azure / GitHub / Vercel'), value: 'deploy' },
      { name: T.muted('🌅  Daily Digest') + T.muted('              — morning summary: tickets, security, deps, git'), value: 'digest' },
      { name: T.white.bold('📄  README / Docs')             + T.muted('          — view full toolkit documentation'), value: 'readme' },
      { name: T.warning.bold('🏪  Marketplace')              + T.muted('           — browse/install agents, skills, plugins'), value: 'marketplace' },
      { name: T.success.bold('⚡  Generate New')              + T.muted('           — create custom agent/command/skill/plugin'), value: 'generate' },
      { name: T.accent.bold('🆓  Free Models')               + T.muted('            — NVIDIA, Groq, Ollama, HuggingFace'), value: 'freemodels' },
      { name: T.muted(`🔖  Version: v${VERSION}`)           + T.muted('          — bump version / run updater'), value: 'version' },
      { name: T.accent.bold('🧩  Install VS Code Extension')  + T.muted('  — install ghostforge-ai.vsix into VS Code'), value: 'vscode-install' },
      { name: T.muted('❓  Help & Quick Reference')                                                               , value: 'help' },
      { name: T.danger('✖   Exit')                                                                                , value: 'exit' },
    ],
    pageSize: 20,
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

  COMMANDS.forEach(c => {
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

// ─── Marketplace Screen ─────────────────────────────────────────────────────
async function screenMarketplace() {
  sectionHeader('🏪  Marketplace', 'Browse and install agents, commands, skills, plugins');

  const catalogPath = resolve(ROOT, 'marketplace/catalog.json');
  const registryPath = resolve(ROOT, 'marketplace/registry.json');
  let catalog = { items: [] };
  let registry = { installed: [], custom_agents: [], custom_models: [] };

  if (existsSync(catalogPath)) {
    try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')); } catch {}
  }
  if (existsSync(registryPath)) {
    try { registry = JSON.parse(readFileSync(registryPath, 'utf8')); } catch {}
  }

  const action = await select({
    message: T.white.bold('Marketplace:'),
    choices: [
      { name: T.accent.bold('📋  Browse All Items')    + T.muted(' — view full catalog by category'), value: 'browse' },
      { name: T.success.bold('🔍  Search Items')        + T.muted(' — search by name, tag, or category'), value: 'search' },
      { name: T.brand.bold('⬇️   Install Item')         + T.muted(' — install from catalog or URL'), value: 'install' },
      { name: T.warning.bold('🌐  Browse aitmpl.com')   + T.muted(' — open AI templates site'), value: 'aitmpl' },
      { name: T.white.bold('📦  My Installed Items')   + T.muted(' — view and manage installed items'), value: 'installed' },
      { name: T.success.bold('🔧  Add Custom Agent')    + T.muted(' — add your own agent from file or URL'), value: 'custom-agent' },
      { name: T.success.bold('🤖  Add Custom Model')    + T.muted(' — add a custom AI model provider'), value: 'custom-model' },
      { name: T.muted('🔄  Refresh Catalog')  + T.muted(' — fetch latest from sources'), value: 'refresh' },
      { name: T.muted('← Back to Menu'), value: '__back__' },
    ],
    pageSize: 10,
  });

  if (action === '__back__') return;

  if (action === 'browse') {
    const categories = [...new Set(catalog.items.map(i => i.category).filter(Boolean))];
    const catChoice = await select({
      message: 'Choose category:',
      choices: [
        { name: T.accent('All Items'), value: '__all__' },
        ...categories.map(c => ({ name: c, value: c })),
        { name: T.muted('← Back'), value: '__back__' },
      ],
    });
    if (catChoice === '__back__') { await screenMarketplace(); return; }

    const items = catChoice === '__all__' ? catalog.items : catalog.items.filter(i => i.category === catChoice);
    console.log();
    const table = new Table({
      head: [T.accent.bold('Name'), T.white.bold('Type'), T.muted('Description'), T.success.bold('Status')],
      colWidths: [28, 12, 40, 12],
      style: { head: [], border: ['dim'] },
    });
    items.forEach(item => {
      table.push([
        T.white.bold(item.name),
        T.muted(item.type),
        T.dim((item.description || '').substring(0, 38)),
        item.installed ? T.success('✅ installed') : T.muted('available'),
      ]);
    });
    console.log(table.toString());
    console.log();
    await pressEnter();
  }

  if (action === 'search') {
    const query = await input({ message: T.white('Search query:') });
    const q = query.toLowerCase();
    const results = catalog.items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.tags || []).some(t => t.toLowerCase().includes(q))
    );
    console.log();
    if (results.length === 0) {
      console.log(T.warning('  No items found for: ') + T.white(query));
    } else {
      results.forEach(item => {
        console.log(`  ${T.accent.bold(item.name)} ${T.muted('[' + item.type + ']')}`);
        console.log(`  ${T.dim(item.description)}`);
        console.log(`  ${item.installed ? T.success('✅ installed') : T.muted('available')}  ${T.muted(item.tags?.join(', ') || '')}`);
        console.log();
      });
    }
    await pressEnter();
  }

  if (action === 'install') {
    const available = catalog.items.filter(i => !i.installed);
    if (available.length === 0) {
      console.log(T.success('\n  ✅ All catalog items are already installed!\n'));
      await pressEnter();
      return;
    }
    const itemChoice = await select({
      message: 'Choose item to install:',
      choices: [
        ...available.map(i => ({ name: `${i.name} — ${T.muted((i.description || '').substring(0, 45))}`, value: i.id })),
        { name: T.muted('← Cancel'), value: '__cancel__' },
      ],
      pageSize: 10,
    });
    if (itemChoice === '__cancel__') return;
    const item = catalog.items.find(i => i.id === itemChoice);
    if (item) {
      console.log();
      console.log(T.brand.bold(`  Installing: ${item.name}...`));
      if (item.install_command) {
        console.log(T.muted(`  Running: ${item.install_command}`));
        try {
          execSync(item.install_command, { stdio: 'inherit', cwd: ROOT });
          console.log(T.success(`\n  ✅ ${item.name} installed successfully!`));
          item.installed = true;
          writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
        } catch {
          console.log(T.danger(`\n  ✖ Installation failed. Try manually: ${item.install_command}`));
        }
      } else if (item.url) {
        console.log(T.accent(`  Visit: ${item.url}`));
        console.log(T.muted('  (browser required for this item type)'));
      } else {
        console.log(T.success(`  ✅ Already available via the GhostForge toolkit!\n  File: ${item.file || 'built-in'}`));
      }
      await pressEnter();
    }
  }

  if (action === 'aitmpl') {
    console.log();
    console.log(boxen(
      T.brand.bold(' AI Templates — aitmpl.com ') + '\n\n' +
      T.white('Browse community AI component templates:\n') +
      T.accent('  https://aitmpl.com\n\n') +
      T.muted('  • React component templates\n') +
      T.muted('  • Next.js starter templates\n') +
      T.muted('  • AI-powered hooks and utilities\n') +
      T.muted('  • Browse → click + → copy install command\n\n') +
      T.dim('  After finding a template, use /generate to create a custom agent\n') +
      T.dim('  or /scaffold to generate it in your project'),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round' }
    ));
    console.log();
    try { execSync('open https://aitmpl.com 2>/dev/null || xdg-open https://aitmpl.com 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter();
  }

  if (action === 'installed') {
    console.log();
    const installedItems = catalog.items.filter(i => i.installed);
    if (installedItems.length === 0) {
      console.log(T.muted('  No items installed yet.\n'));
    } else {
      installedItems.forEach(item => {
        console.log(`  ${T.success('✅')} ${T.white.bold(item.name)} ${T.muted('[' + item.type + ']')} — ${T.dim(item.source)}`);
      });
      console.log();
    }
    const customAgents = registry.custom_agents || [];
    if (customAgents.length > 0) {
      console.log(T.accent.bold('  Custom Agents:'));
      customAgents.forEach(a => console.log(`  ${T.success('✅')} ${T.white(a.name)} — ${T.dim(a.file)}`));
      console.log();
    }
    await pressEnter();
  }

  if (action === 'custom-agent') {
    console.log();
    console.log(T.accent.bold('  Adding a Custom Agent\n'));
    const agentName = await input({ message: 'Agent name (e.g. "Shopify Expert"):' });
    const agentFile = await input({ message: 'Agent file path or URL (leave empty to use /generate):' });
    if (!agentName) return;
    if (!agentFile) {
      console.log(T.muted('\n  Tip: Use /generate in Copilot Chat to create a new agent definition\n'));
    } else {
      console.log(T.success(`\n  ✅ Custom agent "${agentName}" noted!\n  Add the file to: marketplace/custom-agents/\n`));
      const reg = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : { installed: [], custom_agents: [], custom_models: [] };
      reg.custom_agents = reg.custom_agents || [];
      reg.custom_agents.push({ name: agentName, file: agentFile, addedAt: new Date().toISOString() });
      writeFileSync(registryPath, JSON.stringify(reg, null, 2));
    }
    await pressEnter();
  }

  if (action === 'custom-model') {
    await screenFreeModels();
    return;
  }

  if (action === 'refresh') {
    const spinner = ora({ text: T.muted('  Fetching latest catalog from sources...'), color: 'blue' }).start();
    await new Promise(r => setTimeout(r, 1500));
    spinner.succeed(T.success('  Catalog refreshed! (using local cache + sources.json)'));
    console.log(T.muted('\n  Tip: To add new sources, edit marketplace/sources.json\n'));
    await pressEnter();
  }
}

// ─── Generate New Screen ────────────────────────────────────────────────────
async function screenGenerate() {
  sectionHeader('⚡  Generate New', 'Create a custom agent, command, skill, or plugin');

  const typeChoice = await select({
    message: T.white.bold('What would you like to create?'),
    choices: [
      { name: T.success.bold('🤖  Agent')        + T.muted('     — specialized AI persona with role + expertise + trigger phrase'), value: 'agent' },
      { name: T.accent.bold('⚡  Command')       + T.muted('    — new slash command (/my-command) with usage and AI behavior'), value: 'command' },
      { name: T.brand.bold('🎯  Skill')          + T.muted('      — coding agent skill that runs after file changes'), value: 'skill' },
      { name: T.warning.bold('🔧  Instruction')  + T.muted('  — knowledge pack for a framework, API, or domain'), value: 'instruction' },
      { name: T.white.bold('📦  Plugin')         + T.muted('     — reusable plugin package with multiple agents/commands'), value: 'plugin' },
      { name: T.muted('← Back'), value: '__back__' },
    ],
  });

  if (typeChoice === '__back__') return;

  console.log();
  const name = await input({ message: T.white(`${typeChoice} name (e.g. "shopify-expert", "analyze-bundle"):`) });
  if (!name) return;
  const cleanName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const description = await input({ message: T.white('Brief description (1 sentence):') });
  const tags = await input({ message: T.white('Tags (comma-separated, e.g. "react,frontend,performance"):') });

  let content = '';
  let outputFile = '';

  if (typeChoice === 'agent') {
    const role = await input({ message: 'What is this agent\'s role/expertise?' });
    const trigger = await input({ message: 'Trigger phrase (e.g. "act as shopify developer"):', default: `act as ${cleanName}` });
    const tools = await input({ message: 'Key tools/technologies (comma-separated):' });

    outputFile = resolve(ROOT, `marketplace/custom-agents/${cleanName}.md`);
    content = `# ${name} Agent\n\n## Role\n${role || description}\n\n## Trigger\nUser says: "${trigger}"\n\n## Expertise\n${tools ? tools.split(',').map(t => `- ${t.trim()}`).join('\n') : '- ' + (role || 'General expertise')}\n\n## Behavior\nWhen activated as the ${name} agent:\n1. Acknowledge the role switch\n2. Apply all ${name} conventions and best practices\n3. Use ${tools || 'relevant tools'} effectively\n4. Follow GhostForge coding standards\n\n## Key Guidelines\n- Always ${description || 'provide expert assistance'}\n- Follow project conventions\n- Write clean, maintainable code\n\n## Tags\n${tags || cleanName}\n`;
  }

  if (typeChoice === 'command') {
    const usage = await input({ message: `Command usage (e.g. "/${cleanName} [options]"):`, default: `/${cleanName}` });
    const behavior = await input({ message: 'What does the AI do when this command is run?' });

    outputFile = resolve(ROOT, `marketplace/custom-commands/${cleanName}.md`);
    content = `# /${cleanName} Command\n\n## Purpose\n${description}\n\n## Usage\n\`\`\`bash\n${usage || '/' + cleanName}\n\`\`\`\n\n## What AI Does\n${behavior || description}\n\n## Examples\n\`\`\`bash\n/${cleanName}\n/${cleanName} --help\n\`\`\`\n\n## Tags\n${tags || cleanName}\n`;
  }

  if (typeChoice === 'skill') {
    const trigger = await input({ message: 'When should this skill run? (e.g. "after editing React files")' });
    const command = await input({ message: 'CLI command to run (e.g. "npx my-tool --verbose"):', default: `npx ${cleanName}` });

    const skillDir = resolve(ROOT, `.copilot/skills/${cleanName}`);
    outputFile = resolve(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    content = `---\nname: ${cleanName}\ndescription: ${description}. Use when ${trigger || 'the user asks to run ' + cleanName}.\nversion: "1.0.0"\n---\n\n# ${name} Skill\n\n${description}\n\n## When to Run\n${trigger || 'When the user asks to run ' + cleanName}\n\n## Command\n\`\`\`bash\n${command}\n\`\`\`\n\n## After Running\nCheck the output and fix any issues found.\n`;
  }

  if (typeChoice === 'instruction') {
    const topic = await input({ message: 'Topic / framework / domain:' });
    const patterns = await input({ message: 'Key patterns or rules (comma-separated):' });

    outputFile = resolve(ROOT, `instructions/custom-${cleanName}.md`);
    content = `# ${name} — GhostForge Instructions\n\n## Overview\n${description}\n\n## Key Patterns\n${patterns ? patterns.split(',').map(p => `- ${p.trim()}`).join('\n') : '- Follow best practices'}\n\n## Guidelines\nWhen working with ${topic || name}:\n1. ${description}\n2. Follow established conventions\n3. Apply GhostForge coding standards\n\n## Tags\n${tags || cleanName}\n`;
  }

  if (typeChoice === 'plugin') {
    const pluginDir = resolve(ROOT, `plugins/${cleanName}`);
    outputFile = resolve(pluginDir, 'README.md');
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(resolve(pluginDir, 'agents'), { recursive: true });
    mkdirSync(resolve(pluginDir, 'commands'), { recursive: true });
    content = `# ${name} Plugin\n\n${description}\n\n## Contents\n- agents/ — specialized agents for this plugin\n- commands/ — slash commands\n\n## Usage\nCopy files to the ghostforge-agents root:\n\`\`\`bash\ncp -r plugins/${cleanName}/agents/* agents/\ncp -r plugins/${cleanName}/commands/* commands/\n\`\`\`\n\n## Tags\n${tags || cleanName}\n`;
    const manifestPath = resolve(pluginDir, 'plugin.json');
    writeFileSync(manifestPath, JSON.stringify({ id: cleanName, name, description, version: '1.0.0', tags: tags ? tags.split(',').map(t => t.trim()) : [cleanName] }, null, 2));
  }

  if (content && outputFile) {
    try {
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, content, 'utf8');
      console.log();
      console.log(T.success.bold(`  ✅ Created: ${outputFile.replace(ROOT, '.')}`));
      console.log(T.muted(`  Open in VS Code: code "${outputFile}"`));

      const registryPath = resolve(ROOT, 'marketplace/registry.json');
      const reg = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : { installed: [], custom_agents: [], custom_models: [] };
      reg.installed = reg.installed || [];
      reg.installed.push({ id: cleanName, type: typeChoice, name, file: outputFile.replace(ROOT + '/', ''), createdAt: new Date().toISOString() });
      if (typeChoice === 'agent') {
        reg.custom_agents = reg.custom_agents || [];
        reg.custom_agents.push({ name, file: outputFile.replace(ROOT + '/', ''), addedAt: new Date().toISOString() });
      }
      writeFileSync(registryPath, JSON.stringify(reg, null, 2));

      console.log(T.muted('\n  Tip: Edit the file to customize it, then use it in Copilot Chat!\n'));
    } catch (err) {
      console.log(T.danger(`\n  ✖ Error creating file: ${err.message}\n`));
    }
  }

  await pressEnter();
}

// ─── Free Models Screen ─────────────────────────────────────────────────────
async function screenFreeModels() {
  sectionHeader('🆓  Free AI Models', 'Configure free model providers: NVIDIA, Groq, Ollama, HuggingFace & more');

  const modelsPath = resolve(ROOT, 'marketplace/custom-models.json');
  let modelsData = { models: [], free_model_providers: [] };
  if (existsSync(modelsPath)) {
    try { modelsData = JSON.parse(readFileSync(modelsPath, 'utf8')); } catch {}
  }

  const action = await select({
    message: T.white.bold('Free Models:'),
    choices: [
      { name: T.accent.bold('📋  Browse Free Providers')   + T.muted('  — NVIDIA NIM, Groq, Ollama, HuggingFace, Cerebras'), value: 'browse' },
      { name: T.success.bold('⚙️   Configure a Provider')   + T.muted('    — add API key + test connection'), value: 'configure' },
      { name: T.brand.bold('🤖  Add Custom Model')         + T.muted('      — add any OpenAI-compatible model/API'), value: 'custom' },
      { name: T.warning.bold('🔌  Test Connections')        + T.muted('       — ping all configured providers'), value: 'test' },
      { name: T.white.bold('📖  View Configured Models')   + T.muted('  — see active model list'), value: 'list' },
      { name: T.muted('← Back to Menu'), value: '__back__' },
    ],
  });

  if (action === '__back__') return;

  if (action === 'browse') {
    console.log();
    const providers = modelsData.free_model_providers || [];
    if (providers.length === 0) {
      console.log(T.muted('  No provider data found. Check marketplace/custom-models.json\n'));
    } else {
      providers.forEach(p => {
        const envVal = p.env_key ? (process.env[p.env_key] || '') : '';
        const configured = p.env_key === null || envVal.length > 0;
        console.log(`  ${configured ? T.success('●') : T.muted('○')} ${T.white.bold(p.name)} ${T.muted('[' + p.id + ']')}`);
        console.log(`    ${T.dim(p.description)}`);
        console.log(`    ${T.muted('Models: ')}${T.accent((p.free_models || []).slice(0, 3).join(', '))}${(p.free_models || []).length > 3 ? T.muted(' +more') : ''}`);
        console.log(`    ${T.muted('Signup: ')}${T.dim(p.key_signup_url)}`);
        console.log(`    ${p.env_key ? T.muted(`Key: ${p.env_key}=${configured ? 'configured ✓' : 'not set'}`) : T.success('No key needed (local)')}`);
        console.log();
      });
    }
    await pressEnter();
  }

  if (action === 'configure') {
    const providers = modelsData.free_model_providers || [];
    if (providers.length === 0) { await pressEnter(); return; }

    const providerChoice = await select({
      message: 'Choose provider to configure:',
      choices: [
        ...providers.map(p => ({ name: `${p.name} — ${p.description.substring(0, 40)}`, value: p.id })),
        { name: T.muted('← Cancel'), value: '__cancel__' },
      ],
    });
    if (providerChoice === '__cancel__') { await screenFreeModels(); return; }

    const provider = providers.find(p => p.id === providerChoice);
    if (!provider) return;

    console.log();
    console.log(boxen(
      T.accent.bold(` ${provider.name} Setup `) + '\n\n' +
      T.white(provider.description) + '\n\n' +
      T.muted('Free models available:\n') +
      (provider.free_models || []).map(m => T.dim(`  • ${m}`)).join('\n') + '\n\n' +
      T.muted('Sign up at: ') + T.accent(provider.key_signup_url),
      { padding: 1, borderColor: '#00A3E0', borderStyle: 'round' }
    ));
    console.log();

    if (provider.env_key) {
      const apiKey = await input({ message: T.white(`Enter your ${provider.name} API key (${provider.env_key}):`), default: '' });
      if (apiKey) {
        const envFile = resolve(ROOT, '.env.local');
        const envLine = `\n${provider.env_key}=${apiKey}`;
        try {
          const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
          const updated = existing.includes(provider.env_key)
            ? existing.replace(new RegExp(`${provider.env_key}=.*`), `${provider.env_key}=${apiKey}`)
            : existing + envLine;
          writeFileSync(envFile, updated);
          console.log(T.success(`\n  ✅ ${provider.env_key} saved to .env.local`));
          console.log(T.muted('  Reload your shell or tool session if needed.'));
        } catch {
          console.log(T.warning(`\n  Add this to your .env.local:\n  ${provider.env_key}=${apiKey}\n`));
        }
      }
    } else {
      console.log(T.success('  ✅ No API key needed! Make sure Ollama is running:'));
      console.log(T.muted('  brew install ollama && ollama serve'));
      console.log(T.muted('  ollama pull llama3.2'));
    }
    await pressEnter();
  }

  if (action === 'custom') {
    console.log();
    console.log(T.accent.bold('  Add a Custom OpenAI-Compatible Model\n'));
    const modelName = await input({ message: 'Display name (e.g. "My Local Mistral"):' });
    const apiBase = await input({ message: 'API base URL (e.g. "http://localhost:8080/v1"):' });
    const modelId = await input({ message: 'Model ID (e.g. "mistral-7b-instruct"):' });
    const envKey = await input({ message: 'API key env var (leave empty if not needed):' });

    if (modelName && apiBase && modelId) {
      const reg = existsSync(modelsPath) ? JSON.parse(readFileSync(modelsPath, 'utf8')) : { models: [], free_model_providers: [] };
      reg.models = reg.models || [];
      reg.models.push({ id: modelId.toLowerCase().replace(/\s+/g, '-'), name: modelName, api_base: apiBase, model_id: modelId, env_key: envKey || null, addedAt: new Date().toISOString() });
      writeFileSync(modelsPath, JSON.stringify(reg, null, 2));
      console.log(T.success(`\n  ✅ Custom model "${modelName}" added!\n`));
      console.log(T.muted('  Model config saved to marketplace/custom-models.json'));
      console.log(T.muted('  Use /model in Copilot Chat to activate it'));
    }
    await pressEnter();
  }

  if (action === 'test') {
    console.log();
    const spinner = ora({ text: T.muted('  Testing connections...'), color: 'cyan' }).start();
    const results = [];

    try {
      execSync('curl -s --max-time 2 http://localhost:11434/api/version', { stdio: 'pipe' });
      results.push({ name: 'Ollama (Local)', status: 'online', icon: '🟢' });
    } catch {
      results.push({ name: 'Ollama (Local)', status: 'offline — run: ollama serve', icon: '⚫' });
    }

    const providerKeys = [
      ['NVIDIA NIM', 'NVIDIA_API_KEY'],
      ['Groq', 'GROQ_API_KEY'],
      ['HuggingFace', 'HF_TOKEN'],
      ['Together AI', 'TOGETHER_API_KEY'],
      ['Cerebras', 'CEREBRAS_API_KEY'],
      ['OpenRouter', 'OPENROUTER_API_KEY'],
    ];
    providerKeys.forEach(([name, key]) => {
      const configured = !!process.env[key];
      results.push({ name, status: configured ? 'key configured ✓' : `needs ${key}`, icon: configured ? '🟢' : '🟡' });
    });

    spinner.stop();
    console.log();
    results.forEach(r => console.log(`  ${r.icon}  ${T.white.bold(r.name)}: ${T.muted(r.status)}`));
    console.log();
    console.log(T.dim('  Tip: Run /free-models in Copilot Chat to configure any provider\n'));
    await pressEnter();
  }

  if (action === 'list') {
    const customModels = modelsData.models || [];
    console.log();
    if (customModels.length === 0) {
      console.log(T.muted('  No custom models configured yet.\n  Use "Add Custom Model" to add one.\n'));
    } else {
      customModels.forEach(m => {
        console.log(`  ${T.success('●')} ${T.white.bold(m.name)} ${T.muted('[' + m.model_id + ']')}`);
        console.log(`    ${T.dim(m.api_base)}`);
      });
      console.log();
    }
    await pressEnter();
  }
}

async function screenAPITypes() {
  sectionHeader('🔑  /api-types', 'Generate TypeScript types from an OpenAPI/Swagger spec');
  const choices = [
    { name: T.accent('▶  Run /api-types (enter URL or path)'), value: 'run' },
    { name: T.white('▶  Run with --service flag (also generate API service file)'), value: 'run-service' },
    { name: T.white('📖  View command docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;
  if (choice === 'docs') {
    showMdPreview('commands/api-types.md');
    await pressEnter();
    await screenAPITypes(); return;
  }
  const spec = await input({ message: T.white('OpenAPI spec URL or local file path:'), default: '' });
  if (!spec) { console.log(T.warning('\n  No spec provided.')); await pressEnter(); return; }
  const outFile = await input({ message: T.white('Output file:'), default: 'src/types/api.generated.ts' });
  const args = [spec, `--out=${outFile}`];
  if (choice === 'run-service') args.push('--service');
  console.log(T.muted('\n  Running...\n'));
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/api-types.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenChangelog() {
  sectionHeader('📝  /changelog', 'Auto-generate CHANGELOG.md from git conventional commits');
  const choices = [
    { name: T.accent('▶  Generate changelog (since last tag)'), value: 'run' },
    { name: T.white('▶  Dry run (print to console only)'), value: 'dry' },
    { name: T.white('▶  Show unreleased commits only'), value: 'unreleased' },
    { name: T.white('📖  View command docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;
  if (choice === 'docs') {
    showMdPreview('commands/changelog.md');
    await pressEnter();
    await screenChangelog(); return;
  }
  const args = [];
  if (choice === 'dry') args.push('--dry-run');
  if (choice === 'unreleased') args.push('--unreleased');
  console.log(T.muted('\n  Generating changelog...\n'));
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/changelog.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenEnvCheck() {
  sectionHeader('🔒  /env-check', 'Validate .env vs .env.example — find missing, undocumented, exposed secrets');
  const choices = [
    { name: T.accent('▶  Run env-check (current directory)'), value: 'run' },
    { name: T.warning('▶  Run with --fix (auto-add undocumented keys to .env.example)'), value: 'fix' },
    { name: T.danger('▶  Run in strict mode (exit non-zero on any issue — for CI)'), value: 'strict' },
    { name: T.white('📖  View command docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;
  if (choice === 'docs') {
    showMdPreview('commands/env-check.md');
    await pressEnter();
    await screenEnvCheck(); return;
  }
  const args = [];
  if (choice === 'fix') args.push('--fix');
  if (choice === 'strict') args.push('--strict');
  console.log(T.muted('\n  Scanning environment variables...\n'));
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/env-check.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenUnused() {
  sectionHeader('🧹  /unused', 'Find unused components, exports, and dependencies with knip');
  const choices = [
    { name: T.accent('▶  Full scan (files + exports + dependencies)'), value: 'run' },
    { name: T.white('▶  Unused dependencies only'), value: 'deps' },
    { name: T.white('▶  Unused exports only'), value: 'exports' },
    { name: T.white('▶  Unused files only'), value: 'files' },
    { name: T.warning('▶  Scan + auto-fix (removes safe unused items)'), value: 'fix' },
    { name: T.white('📖  View command docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;
  if (choice === 'docs') {
    showMdPreview('commands/unused.md');
    await pressEnter();
    await screenUnused(); return;
  }
  const args = [];
  if (choice === 'deps') args.push('--deps');
  if (choice === 'exports') args.push('--exports');
  if (choice === 'files') args.push('--files');
  if (choice === 'fix') args.push('--fix');
  console.log(T.muted('\n  Scanning for dead code...\n'));
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/unused.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenGitHooks() {
  sectionHeader('🪝  /git-hooks', 'Install Husky + lint-staged + commitlint in one command');
  const choices = [
    { name: T.accent('▶  Install git hooks (current directory)'), value: 'run' },
    { name: T.white('▶  Install minimal (husky + lint-staged, no commitlint)'), value: 'minimal' },
    { name: T.danger('▶  Remove all hooks'), value: 'remove' },
    { name: T.white('📖  View command docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;
  if (choice === 'docs') {
    showMdPreview('commands/git-hooks.md');
    await pressEnter();
    await screenGitHooks(); return;
  }
  if (choice === 'remove') {
    const confirmed = await input({ message: T.danger('Type "yes" to remove all git hooks:'), default: '' });
    if (confirmed !== 'yes') { console.log(T.muted('\n  Cancelled.')); await pressEnter(); return; }
  }
  const args = [];
  if (choice === 'minimal') args.push('--minimal');
  if (choice === 'remove') args.push('--remove');
  console.log(T.muted('\n  Setting up git hooks...\n'));
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/git-hooks.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
async function screenVSCodeInstall() {
  sectionHeader('🧩  Install VS Code Extension', 'Install the ghostforge-ai extension directly into VS Code');

  const { spawnSync } = await import('child_process');
  const { readdirSync } = await import('fs');

  // Find the .vsix file
  const extDir = join(BASE, 'extension');
  let vsixFile;
  try {
    vsixFile = readdirSync(extDir).find(f => f.endsWith('.vsix'));
  } catch { vsixFile = null; }

  if (!vsixFile) {
    console.log(T.warning('\n  No .vsix file found. Rebuilding extension first...\n'));
    const build = spawnSync('node', ['esbuild.js'], { stdio: 'inherit', cwd: extDir });
    if (build.status !== 0) {
      console.log(T.danger('  ✖  Build failed. Check extension/src/ for errors.'));
      await anyKey(); return;
    }
    const pkg = spawnSync('npx', ['@vscode/vsce', 'package', '--no-dependencies'], { stdio: 'inherit', cwd: extDir });
    if (pkg.status !== 0) {
      console.log(T.danger('  ✖  Packaging failed.'));
      await anyKey(); return;
    }
    vsixFile = readdirSync(extDir).find(f => f.endsWith('.vsix'));
  }

  const vsixPath = join(extDir, vsixFile);
  console.log(T.muted(`\n  Found: ${vsixPath}\n`));

  // Check if code CLI is available
  const codeCheck = spawnSync('which', ['code'], { stdio: 'pipe' });
  if (codeCheck.status !== 0) {
    console.log(T.warning('  VS Code CLI (code) not found in PATH.'));
    console.log(T.muted('  Install it: VS Code → Cmd+Shift+P → "Shell Command: Install code in PATH"\n'));
    console.log(T.white('  Then run manually:'));
    console.log(T.accent(`  code --install-extension ${vsixPath}\n`));
    await anyKey(); return;
  }

  console.log(T.muted('  Installing...\n'));
  const result = spawnSync('code', ['--install-extension', vsixPath, '--force'], { stdio: 'inherit' });

  if (result.status === 0) {
    console.log(T.success('\n  ✅ Extension installed successfully!'));
    console.log(T.muted('  Reload VS Code (Cmd+Shift+P → "Reload Window") to activate.'));
    console.log(T.muted('  Then press Cmd+Shift+E to open the GhostForge command picker.\n'));
  } else {
    console.log(T.danger('\n  ✖  Installation failed.'));
    console.log(T.muted(`  Try manually: code --install-extension ${vsixPath}\n`));
  }
  await anyKey();
}

async function screenSnippets() {
  sectionHeader('📋  Snippet Library', 'Ready-made code patterns — copy and adapt for your project');

  const { readdirSync, readFileSync } = await import('fs');
  const snippetsDir = join(BASE, 'snippets');
  let files = [];
  try { files = readdirSync(snippetsDir).filter(f => !f.startsWith('README') && f !== '.'); } catch { files = []; }

  if (files.length === 0) {
    console.log(T.warning('  No snippets found in snippets/'));
    await anyKey(); return;
  }

  const choices = files.map(f => ({
    name: T.brand.bold(f.replace(/\.(tsx?|md)$/, '').padEnd(28)) + T.muted(getSnippetDesc(f)),
    value: f,
  }));
  choices.push({ name: T.muted('← Back'), value: '__back__' });

  const chosen = await select({ message: 'Choose a snippet:', choices, pageSize: 18 });
  if (chosen === '__back__') return;

  const content = readFileSync(join(snippetsDir, chosen), 'utf8');
  clear();
  sectionHeader(`📋  ${chosen}`, 'Press any key to go back');
  console.log(T.muted('─'.repeat(70)));
  console.log(content.slice(0, 3000));
  if (content.length > 3000) console.log(T.muted(`\n  ... (${content.length - 3000} more chars — open file for full content)`));
  console.log(T.muted('─'.repeat(70)));
  console.log(T.success(`\n  📁  ${join(snippetsDir, chosen)}`));
  console.log(T.muted('  Copy the file path above to open in your editor.\n'));
  await anyKey();
  await screenSnippets();
}

function getSnippetDesc(filename) {
  const descs = {
    'tanstack-table.tsx':  'TanStack Table v8 — sorting, filtering, pagination',
    'msal-auth.tsx':       'Azure AD MSAL — PublicClientApp, silent token, auth guard',
    'next-intl-page.tsx':  'Next.js App Router page with next-intl i18n + RTL',
    'apexcharts.tsx':      'ApexCharts — line, bar, area with RTL + responsive',
    'rhf-zod-form.tsx':    'React Hook Form + Zod — schema, resolver, submit',
    'zustand-store.ts':    'Zustand store — state, actions, persist, devtools',
    'tanstack-query.tsx':  'TanStack Query v5 — useQuery, useMutation, infinite',
    'dnd-kit.tsx':         'dnd-kit sortable list with keyboard accessibility',
    'tiptap-editor.tsx':   'TipTap rich text editor with toolbar',
    'file-upload.tsx':     'react-dropzone — multi-file, preview, validation',
    'export-utils.ts':     'Export to PDF, Excel, CSV using jsPDF + xlsx',
  };
  return descs[filename] || '';
}

async function screenBundle() {
  sectionHeader('🔍  Bundle Analyzer', 'Analyze bundle size, find heavy deps, get optimization tips');
  console.log(T.muted('  Runs bundle analysis on the current working directory.\n'));

  const choices = [
    { name: T.accent('▶  Run bundle analysis (current directory)'), value: 'run' },
    { name: T.white('📖  View bundle command docs (/bundle)'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;
  if (choice === 'docs') {
    const { readFileSync } = await import('fs');
    try {
      const doc = readFileSync(join(BASE, 'commands/bundle.md'), 'utf8');
      clear(); console.log(doc); await anyKey();
    } catch { console.log(T.warning('  bundle.md not found')); await anyKey(); }
    await screenBundle(); return;
  }
  console.log(T.muted('\n  Running bundle analysis...\n'));
  const { spawnSync } = await import('child_process');
  const result = spawnSync('bash', [join(BASE, 'scripts/bundle.sh')], { stdio: 'inherit', cwd: process.cwd() });
  if (result.status !== 0) console.log(T.warning('\n  Bundle analysis completed with warnings.'));
  await anyKey();
}

async function screenRTL() {
  sectionHeader('🌐  RTL Audit', 'Find physical Tailwind classes and replace with logical properties');
  console.log(T.muted('  Scans: ml-/mr-/pl-/pr- → ms-/me-/ps-/pe-  |  text-left/right → text-start/end\n'));

  const choices = [
    { name: T.accent('🔍  Scan (dry run) — report issues only'), value: 'scan' },
    { name: T.warning('🔧  Scan + Auto-fix — replace all occurrences'), value: 'fix' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices });
  if (choice === '__back__') return;

  const { spawnSync } = await import('child_process');
  const args = choice === 'fix' ? [join(BASE, 'scripts/rtl.sh'), '.', '--fix'] : [join(BASE, 'scripts/rtl.sh'), '.'];
  console.log(T.muted('\n  Scanning...\n'));
  spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
  await anyKey();
}

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
        case 'marketplace':  await screenMarketplace(); break;
        case 'generate':     await screenGenerate(); break;
        case 'freemodels':   await screenFreeModels(); break;
        case 'snippets':     await screenSnippets(); break;
        case 'bundle':       await screenBundle(); break;
        case 'rtl':          await screenRTL(); break;
        case 'api-types':    await screenAPITypes(); break;
        case 'changelog':    await screenChangelog(); break;
        case 'env-check':    await screenEnvCheck(); break;
        case 'unused':       await screenUnused(); break;
        case 'git-hooks':    await screenGitHooks(); break;
        case 'version':      await screenVersion(); break;
        case 'vscode-install': await screenVSCodeInstall(); break;
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
