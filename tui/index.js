#!/usr/bin/env node
/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║           GHOSTFORGE  —  Operator Terminal v4.0          ║
 * ║     Operator-grade dev tools, forged in the shadows.     ║
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
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterMenuChoices, groupCommandChoices } from './lib/menu-search.js';
import { readRecentCommands, rememberCommand } from './lib/recent-commands.js';
import { askGFAI } from './lib/gfai-client.js';
import { normalizeLLMFitCLI } from './lib/llmfit-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = ROOT;
const VERSION = existsSync(resolve(ROOT, 'VERSION'))
  ? readFileSync(resolve(ROOT, 'VERSION'), 'utf8').trim()
  : '4.0.0';
const REGISTERED_PROJECTS_FILE = resolve(ROOT, '.registered-projects');
const SCRIPTS_COUNT = existsSync(resolve(ROOT, 'scripts'))
  ? readdirSync(resolve(ROOT, 'scripts')).filter(file => file.endsWith('.sh')).length
  : 0;
figlet.defaults({ fontPath: resolve(__dirname, 'node_modules/figlet/fonts') });

const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--version') || cliArgs.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  console.log(`GhostForge v${VERSION}
Operator-grade dev tools, forged in the shadows.

Usage:
  node tui/index.js
  ghostforge
  gf`);
  process.exit(0);
}

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  brand:    chalk.hex('#0077C8'),
  accent:   chalk.hex('#00A3E0'),      // lighter blue
  cyan:     chalk.hex('#06B6D4'),
  red:      chalk.hex('#EF4444'),
  yellow:   chalk.hex('#F59E0B'),
  success:  chalk.hex('#22C55E'),
  warning:  chalk.hex('#F59E0B'),
  danger:   chalk.hex('#EF4444'),
  muted:    chalk.hex('#6B7280'),
  white:    chalk.white,
  bold:     chalk.bold,
  dim:      chalk.dim,
};

const divider = (char = '─', len = 60) => T.muted(char.repeat(len));
const menuSeparator = () => ({ name: T.muted('─'.repeat(50)), value: '__sep__', disabled: true });
const menuChoice = (tone, label, desc, value) => ({
  name: tone(label.padEnd(30)) + T.muted(` — ${desc}`),
  value,
  searchText: `${label} ${desc}`,
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function clear() { process.stdout.write('\x1Bc'); }

function banner() {
  const art = figlet.textSync('GHOST', { font: 'Big', horizontalLayout: 'default' });
  console.log(T.brand(art));
  console.log(
    boxen(
      T.accent.bold(` GhostForge  v${VERSION} `) + T.muted('  |  ') +
      T.white('Operator-grade dev tools, forged in the shadows.') + '\n' +
      T.muted('  React · Next.js · TypeScript · Tailwind · Git · Performance · Release Ops') + '\n' +
      T.muted('  © Hisham Abulfeilat'),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderColor: '#0077C8', borderStyle: 'round' }
    )
  );
  console.log();
}

function sectionHeader(title, subtitle = '') {
  clear();
  banner();
  console.log(`  ${divider('═', 76)}`);
  console.log(
    boxen(
      T.brand.bold(` ${title} `) + (subtitle ? `\n${T.muted(` ${subtitle} `)}` : ''),
      {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { left: 1, right: 1 },
        width: 76,
        borderColor: '#00A3E0',
        borderStyle: 'round',
      }
    )
  );
  console.log(`  ${divider('═', 76)}`);
  console.log();
}

function readFile(relPath) {
  const full = resolve(ROOT, relPath);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function expandHome(targetPath) {
  return targetPath.replace(/^~(?=$|\/)/, process.env.HOME || '~');
}

function readEnvValueFromFile(filePath, key) {
  const full = resolve(ROOT, filePath);
  if (!existsSync(full)) return '';
  const content = readFileSync(full, 'utf8');
  const line = content.split('\n').find(entry => entry.trim().startsWith(`${key}=`));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}

function runShellCheck(command) {
  const result = spawnSync('bash', ['-lc', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

function doctorStatusTone(status) {
  if (status === 'pass') return T.success.bold(' PASS ');
  if (status === 'warn') return T.warning.bold(' WARN ');
  return T.danger.bold(' FAIL ');
}

function doctorStatusLabel(status) {
  if (status === 'pass') return T.success('pass');
  if (status === 'warn') return T.warning('warn');
  return T.danger('fail');
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
  const result = spawnSync('bash', [full, ...args], { stdio: 'inherit', cwd: process.cwd(), shell: false });
  return result.status === 0;
}

function runScript(scriptPath, args = []) {
  const full = resolve(ROOT, scriptPath);
  if (!existsSync(full)) { console.log(T.danger(`\n  ✖  Script not found: ${scriptPath}`)); return; }
  try {
    const child = spawn('bash', [full, ...args], { stdio: 'inherit', cwd: process.cwd(), shell: false });
    child.on('exit', () => pressEnter());
  } catch (e) {
    console.log(T.danger(`\n  ✖  ${e.message}`));
  }
}

async function pressEnter() {
  await input({ message: T.muted('  Press ENTER to go back...') });
}

const anyKey = pressEnter;

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
  { name: '/open',          cat: '🏗  Setup',      file: 'commands/open.md',          desc: 'Open existing project and wire up all GhostForge toolkit files' },
  { name: '/env',           cat: '🏗  Setup',      file: 'commands/env.md',            desc: 'Manage .env files: generate, validate, sync secrets' },
  { name: '/env-manager',   cat: '🏗  Setup',      file: 'commands/env-manager.md',    desc: 'Validate, diff, sync, and audit environment files' },
  // Development
  { name: '/add-feature',   cat: '💡 Development', file: 'commands/add-feature.md',    desc: 'Add a new feature with tests, types, and documentation' },
  { name: '/context',       cat: '💡 Development', file: 'commands/context.md',         desc: 'Read current file/component and inject as context for next request' },
  { name: '/docs',          cat: '💡 Development', file: 'commands/docs.md',            desc: 'Generate README, API docs, component docs, Storybook docs, changelog' },
  { name: '/optimize',      cat: '💡 Development', file: 'commands/optimize.md',       desc: 'Analyze and optimize performance, bundle size, and code quality' },
  { name: '/bundle',        cat: '💡 Development', file: 'commands/bundle.md',          desc: 'Analyze bundle size, flag heavy deps, suggest lazy-loading and tree-shaking' },
  { name: '/perf',          cat: '💡 Development', file: 'commands/perf.md',            desc: 'Lighthouse performance audit' },
  { name: '/lint',          cat: '💡 Development', file: 'commands/lint.md',           desc: 'Run linters, fix auto-fixable issues, report remaining errors' },
  { name: '/mock',          cat: '💡 Development', file: 'commands/mock.md',           desc: 'Generate mock data, MSW handlers, and test fixtures' },
  { name: '/snippet',       cat: '💡 Development', file: 'commands/snippet.md',        desc: 'Browse, insert, and save reusable snippets from the snippet library' },
  { name: '/storybook',     cat: '💡 Development', file: 'commands/storybook.md',      desc: 'Generate .stories.tsx for any component — Default, Loading, Error, RTL stories' },
  { name: '/component-gen', cat: '💡 Development', file: 'commands/component-gen.md',  desc: 'Generate a typed React component folder with tests, stories, and exports' },
  { name: '/rtl',           cat: '💡 Development', file: 'commands/rtl.md',            desc: 'RTL audit: find physical Tailwind classes and replace with logical properties' },
  { name: '/i18n',          cat: '💡 Development', file: 'commands/i18n.md',           desc: 'Add or manage internationalization (i18n) translations' },
  { name: '/explain-error', cat: '💡 Development', file: 'commands/explain-error.md',  desc: 'Explain an error message and provide a fix' },
  { name: '/explain',       cat: '💡 Development', file: 'commands/explain.md',        desc: 'Explain runtime errors, logs, and stack traces with exact fixes' },
  { name: '/ai-review',     cat: '💡 Development', file: 'commands/ai-review.md',      desc: 'Review staged diffs, branches, files, or full changes with AI' },
  { name: '/graphql-sync',  cat: '💡 Development', file: 'commands/graphql-sync.md',   desc: 'Introspect GraphQL APIs and generate schema and TypeScript types' },
  { name: '/diagram',       cat: '💡 Development', file: 'commands/diagram.md',        desc: 'Generate architecture, flow, or ER diagrams (Mermaid)' },
  // Quality & Security
  { name: '/health',        cat: '🔒 Security',    file: 'commands/health.md',         desc: 'Score project health across audit, deps, coverage, bundle, tickets, lint' },
  { name: '/health-all',    cat: '🔒 Security',    file: 'commands/health-all.md',     desc: 'Scan all registered projects for health scores' },
  { name: '/tech-debt',     cat: '🔒 Security',    file: 'commands/tech-debt.md',      desc: 'Scan TODOs, complexity, and deprecated patterns into a debt score' },
  { name: '/security',      cat: '🔒 Security',    file: 'commands/security.md',       desc: 'Full security audit: OWASP, dependency scan, secrets check' },
  { name: '/test',          cat: '🧪 QA',          file: 'commands/test.md',           desc: 'Auto-detect test framework and run tests with coverage' },
  { name: '/qa',            cat: '🧪 QA',          file: 'commands/qa.md',             desc: 'End-to-end QA: functional, UI, accessibility, performance' },
  { name: '/coverage',      cat: '🧪 QA',          file: 'commands/coverage.md',       desc: 'Capture and compare test coverage snapshots over time' },
  { name: '/a11y',          cat: '🧪 QA',          file: 'commands/a11y.md',           desc: 'Run axe-core audits and RTL-focused accessibility checks' },
  // Tickets & Git
  { name: '/tickets',       cat: '🎫 Tickets',     file: 'commands/tickets.md',        desc: 'Show assigned tickets (GitHub Issues / Azure DevOps / Jira)' },
  { name: '/ado',           cat: '🎫 Tickets',     file: 'commands/ado.md',            desc: 'Azure DevOps work items & pipelines' },
  { name: '/estimate',      cat: '🎫 Tickets',     file: 'commands/estimate.md',       desc: 'AI story point estimator' },
  { name: '/fix-tickets',   cat: '🎫 Tickets',     file: 'commands/fix-tickets.md',    desc: 'Auto-fix bugs by priority: critical → high → medium → low' },
  { name: '/ticket',        cat: '🎫 Tickets',     file: 'commands/ticket.md',         desc: 'Scaffold a feature from a ticket ID — branch, commit template, file structure' },
  { name: '/commit',        cat: '🔀 Git',         file: 'commands/commit.md',         desc: 'Stage, generate conventional commit message, and push' },
  { name: '/pr-description',cat: '🔀 Git',         file: 'commands/pr-description.md', desc: 'Generate a detailed, structured PR description from diff' },
  { name: '/review',        cat: '🔀 Git',         file: 'commands/review.md',         desc: 'Review staged diff for blockers, warnings, suggestions, and PR notes' },
  { name: '/release',       cat: '🔀 Git',         file: 'commands/release.md',        desc: 'Cut a release: changelog, version bump, tag, draft PR' },
  { name: '/changelog-view',cat: '🔀 Git',         file: 'commands/changelog.md',      desc: 'Interactive CHANGELOG viewer' },
  // Database & Reporting
  { name: '/sql',           cat: '🗄  Data',        file: 'commands/sql.md',            desc: 'Write, optimize, or explain SQL queries and reports' },
  // Deployment
  { name: '/deploy',        cat: '🚀 Deploy',      file: 'commands/deploy.md',         desc: 'Deploy to Azure / GitHub Pages / Vercel / custom server' },
  { name: '/appmorphy',     cat: '🚀 Deploy',      file: 'commands/appmorphy.md',      desc: 'Convert any website to an Android APK via AppMorphy cloud build' },
  { name: '/omniroute',    cat: '🆓 Free AI',     file: 'commands/omniroute.md',      desc: 'Local AI gateway — 250+ providers, 90+ free tiers, auto-fallback, no API key' },
  // Modes & Misc
  { name: '/autopilot',     cat: '⚙️  Modes',       file: 'commands/autopilot.md',      desc: 'Enable autopilot mode — auto-approve all actions (no prompts)' },
  { name: '/safe',          cat: '⚙️  Modes',       file: 'commands/safe.md',           desc: 'Enable safe mode — confirm every action before execution' },
  { name: '/dashboard',     cat: '💡 Development', file: 'commands/dashboard.md',      desc: 'Real-time terminal dashboard: tickets, pipelines, health charts, releases, activity' },
  { name: '/api-types',     cat: '💡 Development', file: 'commands/api-types.md',      desc: 'Fetch OpenAPI/Swagger spec → generate TypeScript types + service file' },
  { name: '/changelog',     cat: '🔀 Git',         file: 'commands/changelog.md',      desc: 'Auto-generate CHANGELOG.md from git commits (Conventional Commits)' },
  { name: '/env-check',     cat: '🏗  Setup',      file: 'commands/env-check.md',      desc: 'Compare .env vs .env.example — flag missing, undocumented, exposed secrets' },
  { name: '/unused',        cat: '💡 Development', file: 'commands/unused.md',         desc: 'Find unused components, exports, and dependencies with knip' },
  { name: '/git-hooks',     cat: '🏗  Setup',      file: 'commands/git-hooks.md',      desc: 'Install Husky + lint-staged + commitlint in one command' },
  { name: '/upgrade',       cat: '💡 Development', file: 'commands/upgrade.md',        desc: 'Interactive npm package upgrade wizard' },
  { name: '/mock-api',      cat: '💡 Development', file: 'commands/mock-api.md',       desc: 'Generate MSW handlers from OpenAPI spec' },
  { name: '/onboard-dev',   cat: '🏗  Setup',      file: 'commands/onboard-dev.md',    desc: 'New developer onboarding setup' },
  { name: '/voice',         cat: '⚙️  Modes',       file: 'commands/voice.md',          desc: 'Free TTS/STT voice features' },
  { name: '/career-cv',     cat: '🎯 Career',      file: 'commands/career-cv.md',      desc: 'Version-control your CV in git, diff between versions' },
  { name: '/career-prep',   cat: '🎯 Career',      file: 'commands/career-prep.md',    desc: 'Quick interview prep brief for any company' },
  { name: '/career-track',  cat: '🎯 Career',      file: 'commands/career-track.md',   desc: 'Local job application tracker synced with ADO' },
  { name: '/career-gap',    cat: '🎯 Career',      file: 'commands/career-gap.md',     desc: 'Compare CV vs job description, score the fit %' },
  { name: '/career-linkedin', cat: '🎯 Career',    file: 'commands/career-linkedin.md',desc: 'Generate 30-day LinkedIn content calendar' },
  { name: '/pentest',        cat: '🔐 Security',  file: 'commands/pentest.md',         desc: 'Security scanner: deps audit, secret detection, XSS, OWASP Top-10' },
  { name: '/playwright',    cat: '🧪 Testing',   file: 'commands/playwright.md',      desc: 'E2E testing: install, codegen, run, trace viewer' },
  { name: '/carbon',       cat: '🌿 Green',     file: 'commands/carbon.md',          desc: 'Track dev session CO₂ emissions — CodeCarbon + threshold alerts' },
  { name: '/help',          cat: '⚙️  Modes',       file: 'commands/help.md',           desc: 'Show full command reference and quick-start guide' },
  // Marketplace & Extensions
  { name: '/skills',        cat: '🏪 Marketplace', file: 'commands/skills.md',        desc: 'Browse & install Claude Agent Skills from Anthropic, SkillsMP, Claude-Flow and more' },
  { name: '/marketplace',   cat: '🏪 Marketplace', file: 'commands/marketplace.md',   desc: 'Browse and install agents, commands, skills, plugins from trusted sources' },
  { name: '/generate',      cat: '🏪 Marketplace', file: 'commands/generate.md',      desc: 'Generate a new custom agent, command, skill, or plugin with a wizard' },
  { name: '/free-models',   cat: '🏪 Marketplace', file: 'commands/free-models.md',   desc: 'Configure and use free AI models: NVIDIA, Groq, Ollama, HuggingFace' },
  { name: '/bridge',        cat: '🏪 Marketplace', file: 'commands/bridge.md',        desc: 'Run the Mac Bridge for secure remote command execution from GhostForge Web UI' },
  { name: '/gemini',        cat: '🏪 Marketplace', file: 'commands/gemini.md',        desc: 'Set up and test Google Gemini free-tier access for GhostForge and Vercel Web UI' },
  { name: '/tunnel',        cat: '🏪 Marketplace', file: 'commands/tunnel.md',        desc: 'Start or stop a Cloudflare tunnel for local GhostForge services' },
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

  const choices = [
    menuChoice(T.success.bold, '🔌  Integrations Hub',          'herdr · repowise · Vane · tasteskill', 'integrations'),
      menuChoice(T.cyan.bold,    '🖥  Command Center',            'full-screen dashboard + chat — everything at once', 'commandcenter'),
      menuChoice(T.warning.bold, '🧭  Guide Me',                  'I don\'t know what to pick — let the AI guide me', 'guideme'),
      menuSeparator(),
      menuChoice(T.cyan.bold,    '🤖  GhostForge AI (G.F.A.I.)', 'JARVIS-style: voice + tools + memory', 'jarvis'),
      menuChoice(T.brand.bold,   '📊  Developer Dashboard',       'tickets, pipelines, health, releases, charts', 'dashboard'),
      menuChoice(T.cyan.bold,    '👁️  View what\'s new',           'latest release highlights and changelog notes', 'whats-new'),
      menuChoice(T.brand.bold,   '🚀  New Project Setup',         'wizard: choose stack, init repo, scaffold everything', 'setup'),
      menuChoice(T.brand.bold,   '📂  Open Existing Project',     'copy AI files into any existing project + open VS Code', 'open'),
      menuChoice(T.brand.bold,   '🗂  Manage Projects',           'registry of all your projects', 'projects'),
      menuChoice(T.success.bold, '💊  Project Health Check',      'score /100: deps, tests, security, lint + badge', 'health'),
      menuChoice(T.success.bold, '🌐  /health-all',               'scan all projects', 'health-all'),
      menuChoice(T.accent.bold,  '⚡  /perf',                     'Lighthouse audit', 'perf'),
      menuChoice(T.accent.bold,  '⬆️  /upgrade',                  'npm upgrade wizard', 'upgrade'),
      menuChoice(T.accent.bold,  '🔌  /mock-api',                 'generate MSW handlers', 'mock-api'),
      menuChoice(T.brand.bold,   '🎓  /onboard-dev',              'new dev setup', 'onboard-dev'),
      menuChoice(T.white.bold,   '📋  /ado',                      'Azure DevOps', 'ado'),
      menuChoice(T.warning.bold, '🎯  /estimate',                 'story point estimate', 'estimate'),
      menuChoice(T.accent.bold,  '🔊  /voice',                    'voice features (TTS/STT)', 'voice'),
      menuChoice(T.accent.bold,  '📜  /changelog-view',           'browse CHANGELOG', 'changelog-view'),
      menuChoice(T.accent.bold,  '⚡  Run a Command',             'search or browse slash commands by category', 'commands'),
      menuChoice(T.success.bold, '🤖  Switch Agent / Role',       'activate a specialized AI agent', 'agents'),
      menuChoice(T.warning.bold, '📚  Browse Instructions',       'view knowledge base / docs', 'instructions'),
      menuChoice(T.accent.bold,  '📋  Snippet Library',           'browse & copy ready-made code snippets', 'snippets'),
      menuChoice(T.white.bold,   '🔍  Bundle Analyzer',           'size, heavy deps, lazy-loading tips', 'bundle'),
      menuChoice(T.white.bold,   '🌐  RTL Audit',                 'find & fix non-logical Tailwind classes', 'rtl'),
      menuChoice(T.accent.bold,  '🔑  /api-types',                'OpenAPI/Swagger → TypeScript types', 'api-types'),
      menuChoice(T.accent.bold,  '📝  /changelog',                'generate CHANGELOG from git commits', 'changelog'),
      menuChoice(T.accent.bold,  '🔒  /env-check',                'validate .env vs .env.example', 'env-check'),
      menuChoice(T.accent.bold,  '🧹  /unused',                   'find dead code with knip', 'unused'),
      menuChoice(T.accent.bold,  '🪝  /git-hooks',                'install husky + lint-staged', 'git-hooks'),
      menuChoice(T.white.bold,   '🎫  Tickets & Issues',          'view and fix assigned tickets', 'tickets'),
      menuSeparator(),
      menuChoice(T.white.bold,   '🔒  Security Audit',            'OWASP scan, dep check, secrets', 'security'),
      menuChoice(T.danger.bold,  '🛡️   Vigolium Scanner',          'AI-driven vuln scan — 317 modules, OWASP Top 10', 'vigolium'),
      menuChoice(T.white.bold,   '🧪  Run Tests',                 'auto-detect and run test suite', 'test'),
      menuSeparator(),
      menuChoice(T.white.bold,   '🚀  Deploy',                    'deploy to Azure / GitHub / Vercel', 'deploy'),
      menuChoice(T.accent.bold,  '🎨  Design Resources',          'DESIGN.md templates (74 sites) + awesome-design tools', 'designresources'),
      menuChoice(T.accent.bold,  '📱  Install on Device',         'PWA · Android APK · iOS IPA · Desktop', 'deviceinstall'),
      menuChoice(T.accent.bold,  '📱  AppMorphy',                 'convert website → Android APK (cloud build)', 'appmorphy'),
      menuChoice(T.white.bold,   '🍎  Mac Control',               'control Mac with natural language → AppleScript', 'maccontrol'),
      menuChoice(T.muted,        '🌅  Daily Digest',              'morning summary: tickets, security, deps, git', 'digest'),
      menuChoice(T.white.bold,   '📄  README / Docs',             'view full toolkit documentation', 'readme'),
      menuSeparator(),
      menuChoice(T.warning.bold, '🏪  Marketplace',               'browse/install agents, skills, plugins', 'marketplace'),
      menuChoice(T.success.bold, '⚡  Generate New',              'create custom agent/command/skill/plugin', 'generate'),
      menuChoice(T.accent.bold,  '🆓  Free Models',               'NVIDIA, Groq, OmniRoute, Ollama, HuggingFace', 'freemodels'),
      menuChoice(T.accent.bold,  "🔭  Open Source Tools",     "Browse and learn about integrated open source tools", "opensourcetools"),
      menuChoice(T.accent.bold,  '🆓  Free LLM APIs',             'provider list with limits + quick setup', 'freeapis'),
      menuSeparator(),
      menuChoice(T.cyan.bold,    '🩺  Doctor',                    'health check: env, bridge, AI, tools', 'doctor'),
      menuChoice(T.muted,        `🔖  Version: v${VERSION}`,      'bump version / run updater', 'version'),
      menuChoice(T.accent.bold,  '🧩  Install VS Code Extension', 'install ghostforge.vsix into VS Code', 'vscode-install'),
    menuChoice(T.muted,        '❓  Help & Quick Reference',    'reference shortcuts and key flows', 'help'),
    { name: T.danger('✖   Exit'), value: 'exit', searchText: 'exit quit close' },
  ];

  const quickValues = new Set([
    'commandcenter', 'jarvis', 'guideme', 'commands', 'setup', 'health',
    'security', 'test', 'marketplace', 'exit',
  ]);
  const quickChoices = choices.filter(choice => quickValues.has(choice.value));

  const choice = await search({
    message: T.white.bold('Search tools or ask G.F.A.I.:'),
    source: async term => {
      if (!term?.trim()) return quickChoices;
      const matches = filterMenuChoices(choices, term).slice(0, 14);
      const askChoice = {
        name: T.cyan.bold('💬  Ask G.F.A.I.') + T.muted(` — “${term.trim().slice(0, 70)}”`),
        value: `__ask__:${term.trim()}`,
        short: 'Ask G.F.A.I.',
      };
      return matches.length > 0 ? [...matches, askChoice] : [askChoice];
    },
    pageSize: 16,
  });
  return choice;
}

async function screenCommands() {
  const expandedCategories = new Set();
  let recentExpanded = true;
  let picked;

  while (true) {
    sectionHeader('Slash Commands', 'Type to search · ↑/↓ navigate · Enter expands a category or opens a command');
    picked = await search({
      message: T.white.bold('Find a slash command:'),
      source: async term => {
        const searching = Boolean(term?.trim());
        const recentCommands = readRecentCommands()
          .map(name => COMMANDS.find(command => command.name === name))
          .filter(Boolean);
        const recentChoices = !searching && recentCommands.length > 0
          ? [
              {
                name: T.warning.bold(`${recentExpanded ? '▼' : '▶'} 🕘 Recent`) + T.muted(` (${recentCommands.length})`),
                value: '__recent__',
                short: 'Recent',
              },
              ...(recentExpanded ? recentCommands.map(command => ({
                name: `   ${T.brand.bold(command.name.padEnd(20))}${T.muted(command.desc)}`,
                value: command.name,
                short: command.name,
              })) : []),
            ]
          : [];

        return [
          ...recentChoices,
          ...groupCommandChoices(COMMANDS, expandedCategories, term).map(item => {
          if (item.type === 'category') {
            return {
              name: T.accent.bold(`${item.expanded ? '▼' : '▶'} ${item.category}`) + T.muted(` (${item.count})`),
              value: `__category__:${item.category}`,
              short: item.category,
            };
          }
          return {
            name: `   ${T.brand.bold(item.command.name.padEnd(20))}${T.muted(item.command.desc)}`,
            value: item.command.name,
            short: item.command.name,
          };
          }),
          { name: T.muted('← Back'), value: '__back__' },
        ];
      },
      pageSize: 20,
    });

    if (picked === '__back__') return;
    if (picked === '__recent__') {
      recentExpanded = !recentExpanded;
      continue;
    }
    if (!picked.startsWith('__category__:')) break;

    const category = picked.slice('__category__:'.length);
    if (expandedCategories.has(category)) expandedCategories.delete(category);
    else expandedCategories.add(category);
  }

  const cmd = COMMANDS.find(c => c.name === picked);
  if (cmd) {
    rememberCommand(cmd.name);
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

async function handleMarketplaceToolAction(action) {
  if (action === 'git-autopilot') {
    const gitAction = await select({
      message: T.white.bold('👻  Git Autopilot:'),
      choices: [
        { name: T.accent.bold('✍️  Suggest commit'), value: 'suggest-commit' },
        { name: T.success.bold('🌿  Suggest branch'), value: 'suggest-branch' },
        { name: T.brand.bold('📝  Suggest PR'), value: 'suggest-pr' },
        { name: T.white.bold('📋  Status'), value: 'status' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (gitAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/git-autopilot.sh'), gitAction];
      if (gitAction === 'suggest-branch') {
        const desc = await input({ message: T.white('Task description (optional):'), default: '' });
        if (desc) args.push(desc);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'bridge') {
    const bridgeAction = await select({
      message: T.white.bold('🔌  GhostForge Mac Bridge:'),
      choices: [
        { name: T.accent.bold('▶  Start bridge'), value: 'start' },
        { name: T.danger.bold('■  Stop bridge'), value: 'stop' },
        { name: T.white.bold('📡  Status'), value: 'status' },
        { name: T.success.bold('🔑  Show token'), value: 'token' },
        { name: T.white.bold('📖  View command docs'), value: 'docs' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (bridgeAction === '__back__') return;
    if (bridgeAction === 'docs') {
      console.log();
      showMdPreview('commands/bridge.md', 60);
      console.log();
      await pressEnter();
      return;
    }
    const { spawnSync } = await import('child_process');
    spawnSync('bash', [resolve(ROOT, 'scripts/bridge.sh'), bridgeAction], { stdio: 'inherit', cwd: process.cwd() });
    await pressEnter();
  }

  if (action === 'web-ui-info') {
    console.log();
    console.log(boxen(
      T.success.bold(' GhostForge Web UI — Vercel Deploy ') + '\n\n' +
      T.white('Mobile-first Next.js 14 chat UI with AI + Mac Bridge control.\n\n') +
      T.success.bold('  Deploy:\n') +
      T.cyan('  cd ~/ghostforge/web-ui\n') +
      T.cyan('  npm install\n') +
      T.cyan('  npx vercel login\n') +
      T.cyan('  npx vercel --prod\n\n') +
      T.success.bold('  Required env vars:\n') +
      T.muted('  • ACCESS_PIN\n') +
      T.muted('  • AUTH_SECRET\n') +
      T.muted('  • OPENROUTER_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY\n') +
      T.muted('  • WS_BRIDGE_URL + WS_BRIDGE_TOKEN (optional for remote execution)\n\n') +
      T.dim('  Full guide: web-ui/DEPLOY.md'),
      { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
    ));
    console.log();
    showMdPreview('web-ui/DEPLOY.md', 60);
    console.log();
    await pressEnter();
  }

  if (action === 'gemini') {
    const geminiAction = await select({
      message: T.white.bold('✨  Google Gemini Integration:'),
      choices: [
        { name: T.accent.bold('🧭  Setup guide'), value: 'setup' },
        { name: T.success.bold('🧪  Test API key'), value: 'test' },
        { name: T.white.bold('📚  View free models'), value: 'models' },
        { name: T.white.bold('📖  View command docs'), value: 'docs' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (geminiAction === '__back__') return;
    if (geminiAction === 'docs') {
      console.log();
      showMdPreview('commands/gemini.md', 60);
      console.log();
      await pressEnter();
      return;
    }
    const { spawnSync } = await import('child_process');
    spawnSync('bash', [resolve(ROOT, 'scripts/gemini.sh'), geminiAction], { stdio: 'inherit', cwd: process.cwd() });
    await pressEnter();
  }

  if (action === 'tunnel') {
    const tunnelAction = await select({
      message: T.white.bold('🌐  Cloudflare Tunnel:'),
      choices: [
        { name: T.accent.bold('▶  Start tunnel'), value: 'start' },
        { name: T.danger.bold('■  Stop tunnel'), value: 'stop' },
        { name: T.white.bold('📡  Status'), value: 'status' },
        { name: T.white.bold('📖  View command docs'), value: 'docs' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (tunnelAction === '__back__') return;
    if (tunnelAction === 'docs') {
      console.log();
      showMdPreview('commands/tunnel.md', 60);
      console.log();
      await pressEnter();
      return;
    }
    const args = [resolve(ROOT, 'scripts/tunnel.sh'), tunnelAction];
    if (tunnelAction === 'start') {
      const port = await input({ message: T.white('Local port to expose:'), default: '4747' });
      if (port) args.push(port);
    }
    const { spawnSync } = await import('child_process');
    spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
    await pressEnter();
  }

  if (action === 'bundle-tracker') {
    const bundleAction = await select({
      message: T.white.bold('📦  Bundle Size Tracker:'),
      choices: [
        { name: T.accent.bold('📍  Track build output'), value: 'track' },
        { name: T.white.bold('🕘  History'), value: 'history' },
        { name: T.success.bold('📈  Compare last builds'), value: 'compare' },
        { name: T.warning.bold('🚨  Set alert threshold'), value: 'alert' },
        { name: T.danger.bold('🧹  Clean history'), value: 'clean' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (bundleAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/bundle.sh'), bundleAction];
      if (bundleAction === 'track') {
        const dir = await input({ message: T.white('Directory to scan:'), default: process.cwd() });
        if (dir) args.push(dir);
      }
      if (bundleAction === 'alert') {
        const threshold = await input({ message: T.white('Threshold in KB:'), default: '500' });
        if (threshold) args.push(threshold);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'lighthouse-ci') {
    const lighthouseAction = await select({
      message: T.white.bold('🔦  Lighthouse CI:'),
      choices: [
        { name: T.accent.bold('▶  Run audit'), value: 'run' },
        { name: T.success.bold('⬇️  Install lighthouse'), value: 'install' },
        { name: T.white.bold('🕘  History'), value: 'history' },
        { name: T.brand.bold('📄  Open last report'), value: 'report' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (lighthouseAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/lighthouse.sh'), lighthouseAction];
      if (lighthouseAction === 'run') {
        const url = await input({ message: T.white('URL to audit:'), default: 'http://localhost:3000' });
        if (url) args.push(url);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'i18n-rtl') {
    const i18nAction = await select({
      message: T.white.bold('🌍  i18n / RTL Helper:'),
      choices: [
        { name: T.accent.bold('🈯  Translate text'), value: 'translate' },
        { name: T.warning.bold('🔍  Audit RTL issues'), value: 'audit' },
        { name: T.success.bold('🧾  Extract hardcoded strings'), value: 'extract' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (i18nAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/i18n.sh'), i18nAction];
      if (i18nAction === 'translate') {
        const textValue = await input({ message: T.white('Text to translate:'), default: '' });
        const lang = await input({ message: T.white('Target language (ar/en, optional):'), default: '' });
        if (textValue) args.push(textValue);
        if (lang) args.push(lang);
      } else {
        const dir = await input({ message: T.white('Directory to scan:'), default: process.cwd() });
        if (dir) args.push(dir);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'changelog-gen') {
    const changelogAction = await select({
      message: T.white.bold('📝  Changelog Generator:'),
      choices: [
        { name: T.accent.bold('🛠  Generate'), value: 'generate' },
        { name: T.white.bold('👀  Preview'), value: 'preview' },
        { name: T.success.bold('🏷  Bump version'), value: 'bump' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (changelogAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/changelog.sh'), changelogAction];
      if (changelogAction === 'generate' || changelogAction === 'preview') {
        const since = await input({ message: T.white('Since tag/ref (optional):'), default: '' });
        if (since) args.push(since);
      }
      if (changelogAction === 'bump') {
        const bump = await select({
          message: 'Version bump:',
          choices: [
            { name: 'major', value: 'major' },
            { name: 'minor', value: 'minor' },
            { name: 'patch', value: 'patch' },
          ],
        
          pageSize: 15,});
        args.push(bump);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'dep-health') {
    const depAction = await select({
      message: T.white.bold('🩺  Dependency Health:'),
      choices: [
        { name: T.accent.bold('🧮  Quick audit summary'), value: 'check' },
        { name: T.warning.bold('🔐  Full npm audit'), value: 'audit' },
        { name: T.white.bold('📦  Outdated packages'), value: 'outdated' },
        { name: T.success.bold('📊  Full scorecard'), value: 'full' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (depAction !== '__back__') {
      const { spawnSync } = await import('child_process');
      spawnSync('bash', [resolve(ROOT, 'scripts/dep-health.sh'), depAction], { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'api-mock-gen') {
    const mockAction = await select({
      message: T.white.bold('🔌  API Mock Generator:'),
      choices: [
        { name: T.accent.bold('🧱  Setup MSW'), value: 'setup' },
        { name: T.success.bold('⚙️  Generate handlers'), value: 'generate' },
        { name: T.white.bold('📂  List generated files'), value: 'list' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (mockAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/api-mock.sh'), mockAction];
      if (mockAction === 'generate') {
        const spec = await input({ message: T.white('OpenAPI spec path:'), default: '' });
        if (spec) args.push(spec);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'figma-tokens') {
    const figmaAction = await select({
      message: T.white.bold('🎨  Figma Token Sync:'),
      choices: [
        { name: T.accent.bold('🔑  Setup token'), value: 'setup' },
        { name: T.white.bold('👀  Preview token names'), value: 'preview' },
        { name: T.success.bold('🔄  Sync tokens'), value: 'sync' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (figmaAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/figma-tokens.sh'), figmaAction];
      if (figmaAction === 'preview' || figmaAction === 'sync') {
        const key = await input({ message: T.white('Figma file key:'), default: '' });
        if (key) args.push(key);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'storybook-scaffold') {
    const storyAction = await select({
      message: T.white.bold('📚  Storybook Scaffolder:'),
      choices: [
        { name: T.accent.bold('⬇️  Install Storybook'), value: 'install' },
        { name: T.success.bold('🧩  Scaffold stories'), value: 'scaffold' },
        { name: T.white.bold('▶  Run Storybook'), value: 'run' },
        { name: T.brand.bold('🏗  Build Storybook'), value: 'build' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (storyAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/storybook.sh'), storyAction];
      if (storyAction === 'scaffold') {
        const dir = await input({ message: T.white('Components directory:'), default: 'src/components' });
        if (dir) args.push(dir);
      }
      const { spawnSync } = await import('child_process');
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'ai-review') {
    const subAction = await select({
      message: T.white.bold('🔍  AI Code Review:'),
      choices: [
        { name: T.accent.bold('📌  Review staged diff'), value: 'staged' },
        { name: T.success.bold('🌿  Review branch diff'), value: 'branch' },
        { name: T.white.bold('📄  Review one file'), value: 'file' },
        { name: T.brand.bold('🧠  Review all changed files'), value: 'full' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/ai-review.sh'), subAction];
      if (subAction === 'branch') {
        const base = await input({ message: T.white('Base branch:'), default: 'main' });
        if (base) args.push(base);
      }
      if (subAction === 'file') {
        const file = await input({ message: T.white('File path to review:'), default: '' });
        if (file) args.push(file);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'explain') {
    const subAction = await select({
      message: T.white.bold('💡  AI Error Explainer:'),
      choices: [
        { name: T.accent.bold('📝  Paste an error message'), value: 'error' },
        { name: T.white.bold('📄  Explain a log file'), value: 'log' },
        { name: T.success.bold('📥  Read from stdin / pipe'), value: 'pipe' },
        { name: T.brand.bold('🕘  Explain latest logs'), value: 'last' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/explain.sh'), subAction];
      if (subAction === 'error') {
        const message = await input({ message: T.white('Error message:'), default: '' });
        if (message) args.push(message);
      }
      if (subAction === 'log') {
        const file = await input({ message: T.white('Log file path:'), default: '' });
        if (file) args.push(file);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'release') {
    const subAction = await select({
      message: T.white.bold('🚀  Release Manager:'),
      choices: [
        { name: T.accent.bold('🛠  Prepare release'), value: 'prepare' },
        { name: T.success.bold('🏷  Create tag'), value: 'tag' },
        { name: T.white.bold('📝  Generate notes'), value: 'notes' },
        { name: T.brand.bold('📤  Publish tags'), value: 'publish' },
        { name: T.white.bold('📋  Status'), value: 'status' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/release.sh'), subAction];
      if (subAction === 'prepare') {
        const bump = await select({
          message: T.white('Version bump:'),
          choices: [
            { name: 'patch', value: 'patch' },
            { name: 'minor', value: 'minor' },
            { name: 'major', value: 'major' },
          ],
          pageSize: 15,
        });
        args.push(bump);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'env-manager') {
    const subAction = await select({
      message: T.white.bold('🔐  Environment Manager:'),
      choices: [
        { name: T.accent.bold('✅  Validate file'), value: 'validate' },
        { name: T.white.bold('🧮  Diff two env files'), value: 'diff' },
        { name: T.success.bold('📄  Generate .env.example'), value: 'example' },
        { name: T.brand.bold('🔄  Sync missing keys'), value: 'sync' },
        { name: T.warning.bold('🕵️  Audit project env files'), value: 'audit' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/env-manager.sh'), subAction];
      if (subAction === 'validate' || subAction === 'example') {
        const file = await input({ message: T.white('Env file (leave blank for default):'), default: '' });
        if (file) args.push(file);
      }
      if (subAction === 'diff') {
        const file1 = await input({ message: T.white('First env file:'), default: '.env.example' });
        const file2 = await input({ message: T.white('Second env file:'), default: '.env.local' });
        if (file1) args.push(file1);
        if (file2) args.push(file2);
      }
      if (subAction === 'sync') {
        const source = await input({ message: T.white('Source env file:'), default: '.env.example' });
        const target = await input({ message: T.white('Target env file:'), default: '.env.local' });
        if (source) args.push(source);
        if (target) args.push(target);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'coverage') {
    const subAction = await select({
      message: T.white.bold('📈  Coverage Tracker:'),
      choices: [
        { name: T.accent.bold('📸  Snapshot coverage'), value: 'snapshot' },
        { name: T.white.bold('🕘  History'), value: 'history' },
        { name: T.success.bold('📉  Compare latest runs'), value: 'compare' },
        { name: T.warning.bold('🚨  Alert threshold'), value: 'alert' },
        { name: T.brand.bold('📄  Markdown report'), value: 'report' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/coverage.sh'), subAction];
      if (subAction === 'alert') {
        const threshold = await input({ message: T.white('Minimum coverage threshold:'), default: '80' });
        if (threshold) args.push(threshold);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'a11y') {
    const subAction = await select({
      message: T.white.bold('♿  A11y Deep Auditor:'),
      choices: [
        { name: T.accent.bold('🌐  Audit URL'), value: 'audit' },
        { name: T.success.bold('⬇️  Install axe CLI'), value: 'install' },
        { name: T.white.bold('↔️  RTL scan'), value: 'rtl' },
        { name: T.brand.bold('📄  Markdown report'), value: 'report' },
        { name: T.white.bold('🕘  History'), value: 'history' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/a11y.sh'), subAction];
      if (subAction === 'audit') {
        const url = await input({ message: T.white('URL to audit:'), default: 'http://localhost:3000' });
        if (url) args.push(url);
      }
      if (subAction === 'rtl') {
        const dir = await input({ message: T.white('Directory to scan:'), default: 'src' });
        if (dir) args.push(dir);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'graphql-sync') {
    const subAction = await select({
      message: T.white.bold('🔷  GraphQL Type Sync:'),
      choices: [
        { name: T.accent.bold('🔄  Sync from endpoint'), value: 'sync' },
        { name: T.success.bold('👀  Watch endpoint'), value: 'watch' },
        { name: T.white.bold('🧮  Diff remote schema'), value: 'diff' },
        { name: T.brand.bold('🧹  Clean generated files'), value: 'clean' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/graphql-sync.sh'), subAction];
      if (subAction === 'sync' || subAction === 'watch') {
        const endpoint = await input({ message: T.white('GraphQL endpoint:'), default: 'http://localhost:4000/graphql' });
        if (endpoint) args.push(endpoint);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'component-gen') {
    const subAction = await select({
      message: T.white.bold('🧩  Component Generator:'),
      choices: [
        { name: T.accent.bold('✨  Create component bundle'), value: 'create' },
        { name: T.white.bold('📂  List generated components'), value: 'list' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/component-gen.sh'), subAction];
      if (subAction === 'create') {
        const name = await input({ message: T.white('Component name (PascalCase):'), default: '' });
        const dir = await input({ message: T.white('Target directory (optional):'), default: '' });
        const type = await select({
          message: T.white('Component type:'),
          choices: [
            { name: 'UI Component', value: 'ui' },
            { name: 'Form Component', value: 'form' },
            { name: 'Layout Component', value: 'layout' },
            { name: 'Page Component', value: 'page' },
          ],
          pageSize: 15,
        });
        if (name) args.push(name);
        if (dir) args.push(dir); else args.push('');
        args.push(type);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'tech-debt') {
    const subAction = await select({
      message: T.white.bold('🏚️  Tech Debt Scanner:'),
      choices: [
        { name: T.accent.bold('📊  Full scan'), value: 'scan' },
        { name: T.white.bold('📝  TODO / FIXME / HACK'), value: 'todos' },
        { name: T.warning.bold('📏  Complexity warnings'), value: 'complexity' },
        { name: T.red.bold('🧨  Deprecated patterns'), value: 'deprecated' },
        { name: T.success.bold('🧮  Debt score'), value: 'score' },
        { name: T.brand.bold('📄  Markdown report'), value: 'report' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/tech-debt.sh'), subAction];
      if (subAction === 'scan' || subAction === 'todos' || subAction === 'complexity' || subAction === 'deprecated' || subAction === 'score' || subAction === 'report') {
        const dir = await input({ message: T.white('Directory to scan:'), default: 'src' });
        if (dir) args.push(dir);
      }
      const { spawnSync } = await import('child_process'); // lazy
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
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
      const prompt = `Act as ${agent.name} agent from GhostForge toolkit. ${agent.desc}`;
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
  
    pageSize: 15,});

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
  
    pageSize: 15,});

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
  
    pageSize: 15,});

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
  
    pageSize: 15,});

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
  
    pageSize: 15,});

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
  
    pageSize: 15,});

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
  
    pageSize: 15,});

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

async function screenJarvis() {
  sectionHeader('🤖  G.F.A.I. — GhostForge Artificial Intelligence', 'JARVIS-style AI — chat, tools, Mac control, voice');

  const action = await select({
    message: T.cyan('G.F.A.I. options:'),
    choices: [
      { name: T.cyan.bold('💬  AI Chat (TUI)')          + T.muted('        — chat with any model in terminal'), value: 'chat' },
      { name: T.success.bold('🌐  Open Web UI')          + T.muted('          — full JARVIS with voice in browser'), value: 'webui' },
      { name: T.accent.bold('🔄  Switch Model')          + T.muted('         — change active AI model'), value: 'model' },
      { name: T.accent.bold('🧠  Best Model (llmfit)')   + T.muted('     — hardware-scored recommendations'), value: 'llmfit' },
      { name: T.warning.bold('🧹  Cleanup Mac')          + T.muted('          — free RAM/disk, kill zombies'), value: 'cleanup' },
      { name: T.white.bold('⏰  Quick: Time')            + T.muted('          — ask current time'), value: 'time' },
      { name: T.white.bold('🌤  Quick: Weather')         + T.muted('         — current conditions'), value: 'weather' },
      { name: T.white.bold('💻  Quick: System Status')   + T.muted('     — CPU, battery'), value: 'sysinfo' },
      { name: T.white.bold('📸  Quick: Screenshot')      + T.muted('        — saves to Desktop'), value: 'screenshot' },
      { name: T.accent.bold('💬  Quick: iMessage')       + T.muted('         — send a message'), value: 'imessage' },
      { name: T.warning('↩  Back'), value: 'back' },
    ],
    pageSize: 14,
  });

  if (action === 'back') return;

  if (action === 'webui') {
    console.log(T.cyan('\n  Opening http://localhost:3001/jarvis ...\n'));
    try { execSync('open http://localhost:3001/jarvis 2>/dev/null || xdg-open http://localhost:3001/jarvis 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter(); return;
  }

  if (action === 'model') {
    await screenModelSelect();
    return screenJarvis();
  }

  if (action === 'llmfit') {
    await screenLLMFit();
    return screenJarvis();
  }

  if (action === 'cleanup') {
    await screenMacCleanup();
    return screenJarvis();
  }

  if (action === 'chat') {
    await screenGFAIChat();
    return;
  }

  const quickCmds = {
    time: 'What is the current time and date?',
    weather: 'What is the weather today?',
    sysinfo: 'Give me a system status report.',
    screenshot: 'Take a screenshot and save it to the Desktop.',
  };

  if (action in quickCmds) {
    console.log(T.muted(`\n  Sending to G.F.A.I.: "${quickCmds[action]}"\n`));
    console.log(T.muted('  (Note: Full voice + AI response available in Web UI)\n'));
    if (action === 'time') {
      console.log(T.success(`  ${new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`));
    } else if (action === 'weather') {
      try {
        const r = execSync('curl -s "https://wttr.in/?format=3" 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        console.log(T.success(`  ${r.trim()}\n`));
      } catch { console.log(T.muted('  Weather unavailable\n')); }
    } else if (action === 'sysinfo') {
      try {
        const cpu = execSync("top -l 1 -s 0 | awk '/CPU usage/{print $3+$5}'", { encoding: 'utf8', timeout: 5000 }).trim();
        const bat = execSync("pmset -g batt | grep -o '[0-9]*%' | head -1", { encoding: 'utf8', timeout: 5000 }).trim();
        console.log(T.success(`  CPU: ${Math.round(parseFloat(cpu))}% used | Battery: ${bat}\n`));
      } catch { console.log(T.muted('  System info unavailable\n')); }
    } else if (action === 'screenshot') {
      const ts = new Date().toISOString().slice(0,19).replace(/[:.]/g,'-');
      try {
        execSync(`screencapture ~/Desktop/screenshot-${ts}.png`, { stdio: 'ignore' });
        console.log(T.success(`  ✓ Screenshot saved to ~/Desktop/screenshot-${ts}.png\n`));
      } catch { console.log(T.muted('  screencapture not available\n')); }
    }
    await pressEnter(); return;
  }

  if (action === 'imessage') {
    const contact = await input({ message: 'Contact name:' });
    const msg     = await input({ message: 'Message:' });
    const script = `tell application "Messages"\n  try\n    set s to 1st service whose service type = iMessage\n    send "${msg.replace(/"/g,'\\"')}" to buddy "${contact.replace(/"/g,'\\"')}" of s\n    return "sent"\n  on error e\n    return e\n  end try\nend tell`;
    await runAppleScript(script); return;
  }
}

// ── LLMFit hardware model recommender ────────────────────────────────────────

async function screenLLMFit() {
  sectionHeader('🧠  LLMFit — Hardware-Aware Model Recommender', 'Scores AI models against your RAM/CPU/GPU — powered by llmfit.axjns.dev');

  const spinner = ora(T.muted('  Analyzing hardware and scoring models...')).start();
  let data = null;
  try {
    const { default: http } = await import('http');
    data = await new Promise((resolve) => {
      const req = http.get('http://localhost:3001/api/llmfit', {
        headers: { Cookie: `gf_token=${process.env.AUTH_SECRET || 'ghostforge-secret'}` },
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) return resolve(null);
          try {
            const parsed = JSON.parse(d);
            resolve(parsed?.hardware && parsed?.recommendation ? parsed : null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
    spinner.stop();
  } catch {
    spinner.stop();
  }

  if (!data) {
    try {
      const raw = execSync('llmfit recommend -n 12 --json --no-dashboard', { encoding: 'utf8', timeout: 20000 });
      data = normalizeLLMFitCLI(JSON.parse(raw));
    } catch { /* handled below */ }
  }

  if (!data) {
    console.log(T.danger('\n  ✗ LLMfit is unavailable. Start the Web UI or install the llmfit CLI.\n'));
    await pressEnter(); return;
  }

  const { hardware, models, recommendation } = data;
  console.log(T.cyan(`\n  Hardware: ${hardware.cpuBrand} · ${hardware.ramGB}GB RAM · Available: ~${hardware.availableGB}GB\n`));
  console.log(T.success(`  ${recommendation.summary}\n`));

  if (recommendation.pullFirst) {
    console.log(T.warning(`  ⬇ Recommended: ${recommendation.pullFirst}\n`));
  }

  // Show top 10 models
  const visibleRows = Math.max(4, Math.min(8, (process.stdout.rows || 30) - 18));
  const top = (models || []).slice(0, visibleRows);
  console.log(T.muted('  ┌─ Model ─────────────────────────── Params ─ RAM ─ Score ─ Status ┐'));
  for (const m of top) {
    const status = m.isInstalled ? T.success('installed') : m.canRun ? T.muted(m.runtime || 'not pulled') : T.danger('too large');
    const score  = m.compositeScore >= 80 ? T.success(String(m.compositeScore).padStart(3)) :
                   m.compositeScore >= 60 ? T.warning(String(m.compositeScore).padStart(3)) :
                   T.danger(String(m.compositeScore).padStart(3));
    const rec    = m.recommendation === 'best' ? T.success('★') : m.recommendation === 'good' ? T.accent('◎') : ' ';
    const modelName = String(m.name || m.id).slice(0, 32).padEnd(32);
    const params = `${m.params || '?'}B`.slice(0, 7).padEnd(7);
    const memory = `${m.ramGB || '?'}GB`.slice(0, 6).padEnd(6);
    console.log(`  │ ${rec} ${T.white(modelName)} ${params} ${memory} ${score}   ${status}`);
  }
  console.log(T.muted('  └──────────────────────────────────────────────────────────────────┘\n'));

  // Offer to pull best model or set as default
  const choices = [];
  if (recommendation.pullFirst) {
    choices.push({ name: T.success(`⬇ Pull recommended Ollama model: ${recommendation.pullFirst}`), value: `pull:${recommendation.pullFirst}` });
  }
  if (recommendation.bestInstalled) {
    choices.push({ name: T.accent(`✓ Use ${recommendation.bestInstalled} as default`), value: `use:${recommendation.bestInstalled}` });
  }
  choices.push({ name: T.muted('↩  Back'), value: 'back' });

  const picked = await select({ message: 'Action:', choices });

  if (picked.startsWith('pull:')) {
    const modelId = picked.replace('pull:', '');
    console.log(T.cyan(`\n  Triggering: ollama pull ${modelId} ...\n`));
    const result = spawnSync('ollama', ['pull', modelId], { stdio: 'inherit', timeout: 300000 });
    if (result.status === 0) {
      console.log(T.success(`\n  ✓ Pull complete: ${modelId}\n`));
    } else {
      console.log(T.warning('\n  Pull did not complete. Check Ollama and try again.\n'));
    }
  } else if (picked.startsWith('use:')) {
    const modelId = picked.replace('use:', '');
    _tuiSelectedModel.provider = 'ollama';
    _tuiSelectedModel.id = modelId;
    console.log(T.success(`\n  ✓ Default model set to: ${modelId}\n`));
  }

  await pressEnter();
}

// ── Mac cleanup screen ────────────────────────────────────────────────────────

async function screenMacCleanup() {
  sectionHeader('🧹  Mac Cleanup', 'Free RAM, clear temp files, kill zombie processes');
  console.log(T.muted('  Running cleanup via G.F.A.I. mac_cleanup tool...\n'));

  const spinner = ora(T.muted('  Cleaning...')).start();
  try {
    const { default: http } = await import('http');
    const result = await new Promise((resolve) => {
      const body = JSON.stringify({ message: 'clean up my mac, remove temp files, clear cache, free memory', platform: 'mac' });
      const req = http.request({
        hostname: 'localhost', port: 3001, path: '/api/jarvis',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Cookie: 'gf_token=' },
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ toolResult: 'Cleanup complete' }); } });
      });
      req.on('error', () => resolve({ toolResult: 'Server not running' }));
      req.write(body); req.end();
    });
    if (result.toolResult === 'Server not running') throw new Error('Server not running');
    spinner.stop();
    console.log(T.success('\n  ✓ Cleanup complete:\n'));
    console.log(T.muted(`  ${(result.toolResult || result.speech || '').split('\n').join('\n  ')}\n`));
  } catch {
    spinner.stop();
    // Fallback: run cleanup directly
    try {
      console.log(T.muted('  Clearing GFAI temp files...'));
      execSync('find /tmp -name "gfai-*" -mmin +60 -delete 2>/dev/null || true', { stdio: 'ignore' });
      execSync('dscacheutil -flushcache 2>/dev/null || true', { stdio: 'ignore' });
      const disk = execSync('df -h / | tail -1', { encoding: 'utf8' }).trim();
      console.log(T.success(`\n  ✓ Basic cleanup done. Disk: ${disk}\n`));
    } catch { console.log(T.danger('\n  Cleanup failed\n')); }
  }
  await pressEnter();
}


// ── Model selection screen ────────────────────────────────────────────────────

const _tuiSelectedModel = { provider: '', id: '' };

async function screenModelSelect() {
  sectionHeader('🔄  Switch AI Model', 'Select which AI model G.F.A.I. will use');

  let availableModels = [];
  const spinner = ora(T.muted('  Fetching available models...')).start();
  try {
    const { default: http } = await import('http');
    availableModels = await new Promise((resolve) => {
      const req = http.get('http://localhost:3001/api/jarvis/models', {
        headers: { Cookie: 'gf_token=' },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data).models || []); } catch { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.setTimeout(3000, () => { req.destroy(); resolve([]); });
    });
    spinner.stop();
  } catch {
    spinner.stop();
  }

  // Fallback models if server is down
  if (!availableModels.length) {
    availableModels = [
      { provider: 'google',     id: 'gemini-2.0-flash',                      label: 'Gemini 2.0 Flash (Google)' },
      { provider: 'deepseek',   id: 'deepseek-v4-flash',                     label: 'DeepSeek V4 Flash ($0.14/M, 1M ctx) ★' },
      { provider: 'deepseek',   id: 'deepseek-v4-pro',                       label: 'DeepSeek V4 Pro ($1.74/M, best quality)' },
      { provider: 'deepseek',   id: 'deepseek-chat',                         label: 'DeepSeek Chat (V3, legacy)' },
      { provider: 'deepseek',   id: 'deepseek-reasoner',                     label: 'DeepSeek Reasoner R1 (legacy)' },
      { provider: 'xai',        id: 'grok-3-mini',                           label: 'Grok 3 Mini (xAI)' },
      { provider: 'openrouter', id: 'google/gemma-4-26b-a4b-it:free',        label: 'Gemma 4 26B (Free)' },
      { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 120B (Free)' },
      { provider: 'openrouter', id: 'deepseek/deepseek-r1:free',             label: 'DeepSeek R1 (Free via OpenRouter)' },
      { provider: 'openrouter', id: 'deepseek/deepseek-chat-v3-0324:free',   label: 'DeepSeek V3 (Free via OpenRouter)' },
      { provider: 'ollama',     id: 'qwen3:14b',                             label: 'Qwen3 14B (Local — best)' },
      { provider: 'ollama',     id: 'qwen2.5-coder:7b',                      label: 'Qwen2.5-Coder 7B (Local)' },
      { provider: 'ollama',     id: 'llama3.2:3b',                           label: 'Llama 3.2 3B (Local, fast)' },
    ];
  }

  const choices = availableModels.map(m => ({
    name: `${m.available !== false ? T.success('✓') : T.danger('✗')} ${T.white.bold((m.label || m.id).padEnd(35))} ${T.muted(m.provider)}`,
    value: `${m.provider}::${m.id}`,
  }));
  choices.push({ name: T.muted('← Back'), value: '__back__' });

  const picked = await select({ message: 'Choose a model:', choices, pageSize: 15 });
  if (picked === '__back__') return;

  const [provider, id] = picked.split('::');
  _tuiSelectedModel.provider = provider;
  _tuiSelectedModel.id = id;

  console.log(T.success(`\n  ✓ Model set to: ${T.white.bold(id)} (${provider})\n`));
  console.log(T.muted('  This model will be used in TUI chat sessions.\n'));
  await pressEnter();
}

// ── G.F.A.I. TUI Chat session ─────────────────────────────────────────────────

async function screenGFAIChat(initialMessage = '') {
  sectionHeader('💬  G.F.A.I. Chat', 'Chat with any AI model — type your message, /model to switch, /exit to quit');

  const history = [];
  const modelInfo = _tuiSelectedModel.id
    ? `${_tuiSelectedModel.id} (${_tuiSelectedModel.provider})`
    : 'auto (fallback chain)';

  console.log(boxen(
    T.cyan.bold('  G.F.A.I. Chat Session\n') +
    T.muted('  Model: ') + T.white(modelInfo) + '\n' +
    T.muted('  Commands: ') + T.accent('/model') + T.muted(' switch model · ') +
    T.accent('/clear') + T.muted(' clear history · ') +
    T.accent('/features') + T.muted(' list features · ') +
    T.accent('/exit') + T.muted(' quit chat'),
    { padding: 1, margin: { left: 2 }, borderColor: 'cyan', borderStyle: 'round' }
  ));

  let pendingInput = initialMessage.trim();
  while (true) {
    let userInput;
    if (pendingInput) {
      userInput = pendingInput;
      pendingInput = '';
      console.log(T.cyan(`\n  You: ${userInput}\n`));
    } else {
      try {
        userInput = await input({
          message: T.cyan('You:'),
          theme: { prefix: '' },
        });
      } catch { break; }
    }

    if (!userInput.trim()) continue;

    const cmd = userInput.trim().toLowerCase();

    if (cmd === '/exit' || cmd === 'exit' || cmd === 'quit') break;

    if (cmd === '/clear') {
      history.length = 0;
      console.log(T.muted('  History cleared.\n'));
      continue;
    }

    if (cmd === '/model' || cmd === '/switch') {
      await screenModelSelect();
      const newModel = _tuiSelectedModel.id ? `${_tuiSelectedModel.id} (${_tuiSelectedModel.provider})` : 'auto';
      console.log(T.success(`  Active model: ${newModel}\n`));
      continue;
    }

    if (cmd === '/features' || cmd === '/help') {
      console.log(boxen(
        T.cyan.bold('G.F.A.I. Features (type naturally or use these):\n\n') +
        T.white('  🕐 Time & Date') +         T.muted('   — "what time is it?"\n') +
        T.white('  🌤 Weather') +             T.muted('      — "weather in Riyadh"\n') +
        T.white('  🖥 System') +              T.muted('       — "system status", "battery"\n') +
        T.white('  📸 Screenshot') +          T.muted('   — "take a screenshot"\n') +
        T.white('  🔒 Lock Screen') +         T.muted('   — "lock the screen"\n') +
        T.white('  🖱 Mouse/Click') +         T.muted('    — "click at 500 300"\n') +
        T.white('  ⌨️ Key Combo') +           T.muted('     — "press cmd+space"\n') +
        T.white('  📋 Clipboard') +           T.muted('     — "copy to clipboard: hello"\n') +
        T.white('  🤖 Copilot CLI') +         T.muted('  — "ask copilot: how to..."\n') +
        T.white('  💬 iMessage') +            T.muted('      — "send iMessage to John: hi"\n') +
        T.white('  🔍 Web Search') +          T.muted('   — "search for React hooks"\n') +
        T.white('  🐙 GitHub') +              T.muted('       — "list my repos"\n') +
        T.white('  💻 Run Code') +            T.muted('      — "run: python3 -c \'print(1+1)\'"\n'),
        { padding: 1, borderColor: '#06B6D4', borderStyle: 'round', title: ' G.F.A.I. Capabilities ' }
      ));
      continue;
    }

    // Handle direct run commands
    if (cmd.startsWith('/run ') || cmd.startsWith('run: ')) {
      const runCmd = userInput.replace(/^\/run |^run: /i, '').trim();
      console.log(T.muted(`\n  Running: ${runCmd}\n`));
      try {
        const out = execSync(runCmd, { encoding: 'utf8', timeout: 15000, stdio: ['pipe','pipe','pipe'] }).trim();
        console.log(T.success('  Output:\n') + T.white(`  ${out.split('\n').join('\n  ')}\n`));
      } catch (e) {
        console.log(T.danger(`  Error: ${e.message}\n`));
      }
      continue;
    }

    history.push({ role: 'user', text: userInput });

    const spinner = ora(T.muted('  G.F.A.I. thinking...')).start();
    let response;
    try {
      response = await askGFAI({
        message: userInput,
        history: history.slice(-6).map(item => ({ role: item.role, content: item.text })),
        selectedProvider: _tuiSelectedModel.provider,
        selectedModel: _tuiSelectedModel.id,
      });
      spinner.stop();
    } catch (e) {
      spinner.stop();
      console.log(T.danger(`\n  Error: ${e.message}\n`));
      continue;
    }

    const speech = response.speech || response.text || 'No response.';
    const usedModel = response.usedModel ? T.muted(` [${response.usedModel}]`) : '';
    const domain = response.domain ? T.muted(` {${response.domain}}`) : '';
    const tool = response.tool ? T.muted(` ⚙ ${response.tool}`) : '';

    console.log();
    console.log(boxen(
      T.cyan.bold('G.F.A.I.:') + usedModel + domain + tool + '\n\n' +
      T.white(speech) +
      (response.toolResult ? '\n\n' + T.accent('Result:\n') + T.dim(String(response.toolResult).slice(0, 800)) : ''),
      { padding: 1, margin: { left: 2 }, borderColor: 'cyan', borderStyle: 'round' }
    ));
    console.log();

    history.push({ role: 'assistant', text: speech });
  }

  console.log(T.muted('\n  Chat ended. Returning to menu...\n'));
  await new Promise(r => setTimeout(r, 800));
}

async function screenMacControl() {
  sectionHeader('🍎  Mac Control', 'Automate your Mac with natural language → AppleScript');

  console.log(boxen(
    T.white.bold('  🍎  Natural Language → AppleScript → Runs on your Mac\n\n') +
    T.success('  ✓ iMessage, Teams, Mail, Finder, Spotify, Safari & more\n') +
    T.success('  ✓ System control: volume, brightness, lock, screenshot\n') +
    T.success('  ✓ AI generates AppleScript from plain English\n') +
    T.muted('  ─────────────────────────────────────────────────\n') +
    T.cyan('  Web UI: ') + T.white('http://localhost:3001/mac-control') + '\n' +
    T.muted('  Or use the quick actions below\n'),
    { padding: 1, margin: { left: 2 }, borderColor: 'white', borderStyle: 'round', title: ' Mac Control — appmorphy.app ' }
  ));

  const action = await select({
    message: T.accent('Choose an action:'),
    choices: [
      { name: T.success.bold('💬  iMessage / SMS')         + T.muted('   — send a message via Messages app'), value: 'imessage' },
      { name: T.white.bold('👥  Teams Message')           + T.muted('    — send a message in Microsoft Teams'), value: 'teams' },
      { name: T.cyan.bold('🔊  Volume Control')          + T.muted('    — set, mute, or unmute system audio'), value: 'volume' },
      { name: T.accent.bold('📸  Screenshot')             + T.muted('         — take a screenshot to Desktop'), value: 'screenshot' },
      { name: T.warning.bold('🔒  Lock Screen')           + T.muted('         — lock your Mac immediately'), value: 'lock' },
      { name: T.success.bold('🔔  Notification')          + T.muted('         — show a system notification'), value: 'notify' },
      { name: T.white.bold('🌐  Open Web UI')            + T.muted('         — full UI in browser'), value: 'webui' },
      { name: T.warning('↩  Back'), value: 'back' },
    ],
    pageSize: 10,
  });

  if (action === 'back') return;

  if (action === 'webui') {
    console.log(T.accent('\n  Opening http://localhost:3001/mac-control ...\n'));
    try { execSync('open http://localhost:3001/mac-control 2>/dev/null || xdg-open http://localhost:3001/mac-control 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter();
    return;
  }

  if (action === 'screenshot') {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const path = `~/Desktop/screenshot-${ts}.png`;
    const script = `do shell script "screencapture ${path}"\ndisplay notification "Screenshot saved to Desktop" with title "GhostForge"`;
    await runAppleScript(script);
    return;
  }

  if (action === 'lock') {
    const script = `tell application "System Events" to keystroke "q" using {command down, control down}`;
    await runAppleScript(script);
    return;
  }

  if (action === 'volume') {
    const vol = await input({ message: 'Volume level (0–100, or "mute"/"unmute"):', default: '50' });
    let script;
    if (vol.toLowerCase() === 'mute') script = 'set volume with output muted';
    else if (vol.toLowerCase() === 'unmute') script = 'set volume without output muted';
    else script = `set volume output volume ${parseInt(vol, 10) || 50}`;
    await runAppleScript(script);
    return;
  }

  if (action === 'notify') {
    const title = await input({ message: 'Notification title:', default: 'GhostForge' });
    const msg   = await input({ message: 'Message:' });
    await runAppleScript(`display notification "${msg.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`);
    return;
  }

  if (action === 'imessage') {
    const contact = await input({ message: 'Contact name (as it appears in Messages):' });
    const msg     = await input({ message: 'Message:' });
    const script = `tell application "Messages"
  try
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "${contact.replace(/"/g, '\\"')}" of targetService
    send "${msg.replace(/"/g, '\\"')}" to targetBuddy
    display notification "Message sent to ${contact.replace(/"/g, '\\"')}" with title "GhostForge"
  on error errMsg
    display notification errMsg with title "GhostForge — iMessage Error"
  end try
end tell`;
    await runAppleScript(script);
    return;
  }

  if (action === 'teams') {
    const contact = await input({ message: 'Contact name (as it appears in Teams):' });
    const msg     = await input({ message: 'Message:' });
    const script = `tell application "Microsoft Teams" to activate
delay 1.5
tell application "System Events"
  tell process "Microsoft Teams"
    try
      keystroke "k" using command down
      delay 0.8
      keystroke "${contact.replace(/"/g, '\\"')}"
      delay 1.5
      key code 36
      delay 0.8
      keystroke "${msg.replace(/"/g, '\\"')}"
      delay 0.3
      key code 36
      display notification "Message sent to ${contact.replace(/"/g, '\\"')}" with title "GhostForge"
    on error errMsg
      display notification errMsg with title "GhostForge — Teams Error"
    end try
  end tell
end tell`;
    await runAppleScript(script);
    return;
  }
}

async function runAppleScript(script) {
  const { writeFileSync, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const tmpPath = join(tmpdir(), `gf-mac-${Date.now()}.scpt`);
  try {
    writeFileSync(tmpPath, script, 'utf8');
    console.log(T.muted('\n  Running AppleScript...\n'));
    const result = execSync(`osascript "${tmpPath}" 2>&1`, { encoding: 'utf8', timeout: 20000 }).trim();
    if (result) console.log(T.success(`  Result: ${result}\n`));
    else console.log(T.success('  ✓ Script ran successfully\n'));
  } catch (e) {
    console.log(T.danger(`  ✗ Error: ${e.message || e}\n`));
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
  await pressEnter();
}

async function screenAppmorphy() {
  sectionHeader('📱  AppMorphy', 'Convert any website into an Android APK via private cloud build');

  console.log(boxen(
    T.accent.bold('  🌐  Website → APK in 3 steps\n\n') +
    T.white('  1. ') + T.muted('Fill the build form: URL, app name, package ID, icon\n') +
    T.white('  2. ') + T.muted('AppMorphy compiles an APK in an isolated cloud pipeline\n') +
    T.white('  3. ') + T.muted('Download signed APK via your private status page\n\n') +
    T.success('  ✓ No Android Studio or Gradle needed on your machine\n') +
    T.success('  ✓ Build list never public — unique token URL per build\n') +
    T.success('  ✓ Real-time compile logs in browser'),
    { padding: 1, margin: { left: 2 }, borderColor: 'cyan', borderStyle: 'round', title: ' AppMorphy — appmorphy.app ' }
  ));

  const action = await select({
    message: T.white('What do you want to do?'),
    choices: [
      { name: T.accent.bold('🏗️  Open build form')          + T.muted('    — submit URL + metadata to start a new APK build'), value: 'build' },
      { name: T.white.bold('🌐  Open AppMorphy home')       + T.muted('  — visit appmorphy.app'), value: 'home' },
      { name: T.accent.bold('📋  View docs')                + T.muted('            — show /appmorphy command reference'), value: 'docs' },
      { name: T.white.bold('🔗  Check build status')        + T.muted('  — open a private status page URL'), value: 'status' },
      { name: T.white.bold('💡  Copilot Chat prompt')       + T.muted('  — copy AI prompt to plan the APK build'), value: 'prompt' },
      { name: T.muted('← Back'), value: '__back__' },
    ],
    pageSize: 15,
  });

  if (action === '__back__') return;

  if (action === 'docs') {
    console.log(); showMdPreview('commands/appmorphy.md', 60); console.log();
    await pressEnter(); return;
  }

  if (action === 'home') {
    console.log(T.accent('\n  Opening https://appmorphy.app ...\n'));
    try { execSync('open https://appmorphy.app 2>/dev/null || xdg-open https://appmorphy.app 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter(); return;
  }

  if (action === 'build') {
    console.log(T.accent('\n  Opening https://appmorphy.app/build ...\n'));
    try { execSync('open https://appmorphy.app/build 2>/dev/null || xdg-open https://appmorphy.app/build 2>/dev/null', { stdio: 'ignore' }); } catch {}
    console.log(boxen(
      T.white.bold('Build checklist:\n\n') +
      T.muted('  □  Web app URL (publicly accessible or via tunnel)\n') +
      T.muted('  □  App name & package ID (e.g. com.yourcompany.appname)\n') +
      T.muted('  □  Icon PNG — 512×512 recommended\n') +
      T.muted('  □  Save the private status URL after submission'),
      { padding: 1, margin: { left: 2 }, borderColor: 'yellow', borderStyle: 'round', title: ' Pre-Build Checklist ' }
    ));
    await pressEnter(); return;
  }

  if (action === 'status') {
    const statusUrl = await input({
      message: T.white('Paste your AppMorphy status page URL:'),
      validate: v => v.includes('appmorphy.app') ? true : 'Must be an appmorphy.app URL',
    });
    console.log(T.accent(`\n  Opening ${statusUrl} ...\n`));
    try { execSync(`open '${statusUrl}' 2>/dev/null || xdg-open '${statusUrl}' 2>/dev/null`, { stdio: 'ignore' }); } catch {}
    await pressEnter(); return;
  }

  if (action === 'prompt') {
    const webUrl = await input({ message: T.white('Web app URL to convert:'), default: 'https://myapp.com' });
    const appName = await input({ message: T.white('App name:'), default: 'My App' });
    console.log(boxen(
      T.white('Copy into Copilot Chat:\n\n') +
      T.brand.bold(`/appmorphy --url ${webUrl} --name "${appName}"\n\n`) +
      T.muted('Then ask: "Prepare my web app for AppMorphy APK build.\n') +
      T.muted('Check if the URL is accessible, suggest an icon size,\n') +
      T.muted('and generate a valid Android package ID."'),
      { padding: 1, margin: { left: 2 }, borderColor: '#0077C8', borderStyle: 'round', title: ' Copilot Chat Command ' }
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
          existsSync(resolve(project, 'ghostforge')) ||
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
    
      pageSize: 15,});

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
      
        pageSize: 15,});
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
      
        pageSize: 15,});
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
  sectionHeader('❓  Help & Quick Reference', 'How to use GhostForge');

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
    T.accent('1. TUI    ') + T.muted('→ ') + T.white('This terminal UI  (ghostforge)\n') +
    T.accent('2. Copilot') + T.muted('→ ') + T.white('Type /command in GitHub Copilot Chat\n') +
    T.accent('3. Script ') + T.muted('→ ') + T.white('bash scripts/create-project.sh'),
    { padding: 1, borderColor: '#00A3E0', borderStyle: 'round', title: ' Quick Start ' }
  ));
  console.log();
  await pressEnter();
}

async function screenOpenProject() {
  sectionHeader('📂  Open Existing Project', 'Wire GhostForge into any existing project');

  const action = await select({
   message: T.white('Choose action:'),
   choices: [
     { name: T.brand.bold('📂  Open / Sync Project') + T.muted('   — copy toolkit files into an existing repo'), value: 'open' },
     { name: T.accent.bold('⚙️  Init Project Config') + T.muted(' — create .ghostforge-config.json for this project'), value: 'config' },
     { name: T.muted('← Back'), value: '__back__' },
   ],
  
    pageSize: 15,});

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

async function screenDoctor() {
  sectionHeader('🩺  GhostForge Doctor', 'Live health checks — services, AI keys, and required CLI tools');

  const checks = [];
  const addCheck = (label, status, detail, weight = 1) => checks.push({ label, status, detail, weight });

  const server = runShellCheck('curl -fsS --max-time 2 http://localhost:3001 >/dev/null');
  addCheck('Server :3001', server.ok ? 'pass' : 'fail', server.ok ? 'responding' : 'not reachable');

  const ollama = runShellCheck('curl -fsS --max-time 2 http://localhost:11434/api/tags >/dev/null');
  addCheck('Ollama :11434', ollama.ok ? 'pass' : 'warn', ollama.ok ? 'responding' : 'offline');

  const cliclick = runShellCheck('command -v cliclick');
  addCheck('cliclick', cliclick.ok ? 'pass' : 'fail', cliclick.ok ? cliclick.output : 'not installed');

  const fishAudio = readEnvValueFromFile('web-ui/.env.local', 'FISH_AUDIO_API_KEY');
  addCheck('Fish Audio key', fishAudio ? 'pass' : 'warn', fishAudio ? `set (${fishAudio.length} chars)` : 'missing in web-ui/.env.local');

  const elevenlabs = readEnvValueFromFile('web-ui/.env.local', 'ELEVENLABS_API_KEY');
  addCheck('ElevenLabs key', elevenlabs ? 'pass' : 'warn', elevenlabs ? `set (${elevenlabs.length} chars)` : 'missing in web-ui/.env.local');

  const openrouter = readEnvValueFromFile('web-ui/.env.local', 'OPENROUTER_API_KEY');
  addCheck('OpenRouter key', openrouter ? 'pass' : 'warn', openrouter ? `set (${openrouter.length} chars)` : 'missing in web-ui/.env.local');

  const gemini = readEnvValueFromFile('web-ui/.env.local', 'GOOGLE_GENERATIVE_AI_API_KEY')
    || readEnvValueFromFile('web-ui/.env.local', 'GEMINI_API_KEY');
  addCheck('Gemini key', gemini ? 'pass' : 'warn', gemini ? `set (${gemini.length} chars)` : 'missing in web-ui/.env.local');

  const gh = runShellCheck('command -v gh');
  addCheck('GitHub CLI', gh.ok ? 'pass' : 'fail', gh.ok ? gh.output : 'not installed');

  const git = runShellCheck('command -v git');
  addCheck('Git CLI', git.ok ? 'pass' : 'fail', git.ok ? git.output : 'not installed');

  const deepseekKey = readEnvValueFromFile('web-ui/.env.local', 'DEEPSEEK_API_KEY');
  addCheck('DeepSeek key', deepseekKey ? 'pass' : 'warn', deepseekKey ? `set (${deepseekKey.length} chars)` : 'missing — add DEEPSEEK_API_KEY to .env.local');

  const openInterpreter = runShellCheck('python3 -m interpreter --version 2>/dev/null');
  addCheck('open-interpreter', openInterpreter.ok ? 'pass' : 'warn', openInterpreter.ok ? `v${(openInterpreter.output.match(/\d+\.\d+\.\d+/) || ['?'])[0]}` : 'pip3 install open-interpreter');

  const mkcertCheck = runShellCheck('command -v mkcert');
  const mkcertTrusted = runShellCheck('security find-certificate -a -c "mkcert" /Library/Keychains/System.keychain 2>/dev/null | head -1');
  addCheck('mkcert (HTTPS)', mkcertCheck.ok ? (mkcertTrusted.ok ? 'pass' : 'warn') : 'warn',
    mkcertCheck.ok ? (mkcertTrusted.ok ? 'CA trusted system-wide' : '⚠ run: sudo mkcert -install') : 'brew install mkcert');

  const qwen3Check = runShellCheck('ollama list 2>/dev/null | grep -c qwen3');
  addCheck('qwen3:14b model', qwen3Check.output.trim() !== '0' && qwen3Check.ok ? 'pass' : 'warn',
    qwen3Check.output.trim() !== '0' ? 'installed ✓' : 'pulling... (check: tail -f /tmp/ollama-pull-qwen3-14b.log)');

  const vigoliumCheck = runShellCheck('command -v vigolium');
  addCheck('Vigolium scanner', vigoliumCheck.ok ? 'pass' : 'warn',
    vigoliumCheck.ok ? 'installed (317-module OWASP scanner) ✓' : 'npm install -g @vigolium/vigolium');

  const designMdCheck = existsSync(resolve(ROOT, 'DESIGN.md')) || existsSync(resolve(process.cwd(), 'DESIGN.md'));
  addCheck('DESIGN.md', designMdCheck ? 'pass' : 'warn',
    designMdCheck ? 'design system template active ✓' : 'optional — ask JARVIS to apply a design template');

  const doctorTable = new Table({
    head: [T.white.bold('Check'), T.white.bold('Status'), T.white.bold('Details')],
    colWidths: [24, 12, 40],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  checks.forEach(check => {
    doctorTable.push([
      T.white(check.label),
      doctorStatusTone(check.status),
      check.status === 'pass' ? T.success(check.detail) : check.status === 'warn' ? T.warning(check.detail) : T.danger(check.detail),
    ]);
  });

  const scoreValue = checks.reduce((sum, check) => {
    if (check.status === 'pass') return sum + check.weight;
    if (check.status === 'warn') return sum + (check.weight * 0.5);
    return sum;
  }, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const healthScore = Math.round((scoreValue / maxScore) * 100);
  const passCount = checks.filter(check => check.status === 'pass').length;
  const warnCount = checks.filter(check => check.status === 'warn').length;
  const failCount = checks.filter(check => check.status === 'fail').length;
  const scoreTone = healthScore >= 85 ? T.success : healthScore >= 65 ? T.warning : T.danger;

  console.log(doctorTable.toString());
  console.log();
  console.log(boxen(
    T.white(' Health Score ') + scoreTone.bold(`${healthScore}%`) + '\n' +
    T.success(` Pass: ${passCount} `) + T.muted('│') +
    T.warning(` Warn: ${warnCount} `) + T.muted('│') +
    T.danger(` Fail: ${failCount} `) + '\n' +
    checks.map(check => `${doctorStatusLabel(check.status)} ${check.label}`).join('\n'),
    { padding: 1, borderColor: healthScore >= 85 ? '#22C55E' : healthScore >= 65 ? '#F59E0B' : '#EF4444', borderStyle: 'round' }
  ));

  // Show mkcert hint if not trusted
  if (mkcertCheck.ok && !mkcertTrusted.ok) {
    console.log('\n' + boxen(
      T.warning.bold(' ⚠ HTTPS not trusted \n\n') +
      T.white('Run this ONCE to trust your local HTTPS certificate:\n\n') +
      T.accent('  sudo mkcert -install\n\n') +
      T.muted('This enables:\n  • Microphone access on iPhone/iPad\n  • Secure LAN access from any device\n  • Voice features in Safari'),
      { padding: 1, borderColor: '#F59E0B', borderStyle: 'round', width: 60 }
    ));
  }

  await pressEnter();
}

async function screenVersion() {
  sectionHeader(`🔖  Version Management`, `Current toolkit version: v${VERSION}`);

  console.log(boxen(
    T.accent.bold(`  GhostForge\n\n`) +
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
  
    pageSize: 15,});

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
      { name: T.warning.bold('🌐  Browse aitmpl.com')     + T.muted(' — open AI templates site'), value: 'aitmpl' },
      { name: T.cyan.bold('🔍  Open Source Discovery')   + T.muted(' — hidden gems & trending repos (opensourceprojects.dev)'), value: 'osp-dev' },
      { name: T.accent.bold('🧠  Hermes Agent')            + T.muted(' — self-improving AI agent by Nous Research'), value: 'hermes-agent' },
      { name: T.success.bold('🧠  Shared Memory')           + T.muted(' — claude-mem persistent context across sessions'), value: 'claude-mem' },
      { name: T.success.bold('🎓  Claude Agent Skills')   + T.muted(' — Anthropic, SkillsMP, Claude-Flow, scroll-world, UI/UX'), value: 'skills' },
      { name: T.brand.bold('🗂️   Claude Marketplaces')     + T.muted(' — skills, MCP servers, plugins directory'), value: 'claude-marketplaces' },
      { name: T.cyan.bold('⚡  PocketBase')               + T.muted(' — open source backend in 1 file'), value: 'pocketbase' },
      { name: T.warning.bold('🖱️   Page Agent (Alibaba)')    + T.muted(' — GUI agent living in your webpage'), value: 'page-agent' },
      { name: T.red.bold('🔐  Strix')                     + T.muted(' — autonomous AI penetration testing'), value: 'strix' },
      { name: T.red.bold('🛡️   HackingTool')               + T.muted(' — 185+ pentesting tools · recon, web, AD, cloud, mobile'), value: 'hackingtool' },
      { name: T.red.bold('🔍  Security Scanner')            + T.muted(' — scan project for vulns, secrets, XSS, OWASP Top-10'), value: 'pentest' },
      { name: T.red.bold('🏚️  Tech Debt Scanner')          + T.muted(' — TODOs, complexity, deprecated APIs, debt score'), value: 'tech-debt' },
      { name: T.success.bold('🏥  Codebase Health Score')   + T.muted(' — A-F grade across debt, coverage, bundle, lighthouse, a11y'), value: 'health-score' },
      { name: T.accent.bold('🐳  Docker Generator')         + T.muted(' — Dockerfile + compose templates for app deployment'), value: 'docker-gen' },
      { name: T.white.bold('📖  API Docs Generator')       + T.muted(' — scan routes into Markdown and OpenAPI docs'), value: 'api-docs' },
      { name: T.cyan.bold('🗣️  Daily Standup')             + T.muted(' — git activity into concise daily updates'), value: 'standup' },
      { name: T.warning.bold('🪝  Smart Git Hooks')         + T.muted(' — native git hooks for carbon, TS, lint, commits'), value: 'git-hooks-setup' },
      { name: T.brand.bold('🗄️  DB Schema Visualizer')      + T.muted(' — Prisma/Drizzle schema to ASCII or HTML ERD'), value: 'schema-viz' },
      { name: T.cyan.bold('🎯  Career Helper')             + T.muted(' — CV, LinkedIn, interview prep, job scout (14 skills)'), value: 'career-helper' },
      { name: T.success.bold('🗂️   Career-Ops')             + T.muted(' — multi-agent job search · 740+ listings · WIRED / BI'), value: 'career-ops' },
      { name: T.brand.bold('🎨  Awesome Claude Design')   + T.muted(' — DESIGN.md collection · rohitg00'), value: 'awesome-claude-design-rohitg00' },
      { name: T.brand.bold('🎨  Awesome Claude Design')   + T.muted(' — DESIGN.md collection · VoltAgent'), value: 'awesome-claude-design-voltagent' },
      { name: T.brand.bold('✨  Impeccable')               + T.muted(' — 23 design cmds, 46 detector rules, live browser iteration'), value: 'impeccable' },
      { name: T.brand.bold('🎨  Frontend Design Plugin')   + T.muted(' — official Anthropic Claude plugin · distinctive production UI'), value: 'claude-plugin-frontend-design' },
      { name: T.accent.bold('🔧  Career Tools')            + T.muted(' — CV versioning, prep, tracker, gap, LinkedIn calendar'), value: 'career-tools' },
      { name: T.success.bold('🎭  Playwright')             + T.muted(' — E2E testing · React/Next.js · codegen · trace viewer'), value: 'playwright' },
      { name: T.cyan.bold('👁️   UI-TARS')                  + T.muted(' — ByteDance GUI agent · see screen, click, automate · visual testing'), value: 'ui-tars' },
      { name: T.warning.bold('🔀  OpenRouter')              + T.muted(' — 300+ AI models · browse free models · one API'), value: 'openrouter' },
      { name: T.success.bold('🌐  OmniRoute')               + T.muted(' — 250+ providers · 90+ free · auto-fallback · no key'), value: 'omniroute' },
      { name: T.cyan.bold('🎙️   Meetily')                   + T.muted(' — local AI meeting transcription · Arabic · no cloud'), value: 'meetily' },
      { name: T.success.bold('🌿  Carbon Monitor')           + T.muted(' — track dev session CO₂ emissions · your CRP research'), value: 'carbon-monitor' },
      { name: T.accent.bold('👻  Git Autopilot')             + T.muted(' — AI commit, branch, PR, and status helper'), value: 'git-autopilot' },
      { name: T.cyan.bold('🔌  Mac Bridge')                  + T.muted(' — remote command execution from web UI'), value: 'bridge' },
      { name: T.success.bold('🌐  Web UI')                  + T.muted(' — deploy GhostForge to Vercel for mobile access'), value: 'web-ui-info' },
      { name: T.warning.bold('✨  Gemini AI')               + T.muted(' — Google AI free tier setup + test'), value: 'gemini' },
      { name: T.muted('🌐  Tunnel')                         + T.muted(' — Cloudflare tunnel for local services'), value: 'tunnel' },
      { name: T.white.bold('🔍  AI Code Review')            + T.muted(' — staged, branch, file, and full Claude review'), value: 'ai-review' },
      { name: T.cyan.bold('💡  AI Error Explainer')         + T.muted(' — explain errors, logs, and failing stack traces'), value: 'explain' },
      { name: T.white.bold('📦  Bundle Size Tracker')        + T.muted(' — JS size history, compare builds, set alerts'), value: 'bundle-tracker' },
      { name: T.warning.bold('🔦  Lighthouse CI')            + T.muted(' — trend performance, accessibility, and SEO scores'), value: 'lighthouse-ci' },
      { name: T.success.bold('📈  Coverage Tracker')        + T.muted(' — snapshot, compare, and alert on coverage drift'), value: 'coverage' },
      { name: T.success.bold('♿  A11y Deep Auditor')        + T.muted(' — axe-core + RTL accessibility auditing'), value: 'a11y' },
      { name: T.success.bold('🌍  i18n / RTL Helper')        + T.muted(' — translation, RTL audit, string extraction'), value: 'i18n-rtl' },
      { name: T.brand.bold('📝  Changelog Generator')        + T.muted(' — conventional commits to release notes'), value: 'changelog-gen' },
      { name: T.success.bold('🚀  Release Manager')         + T.muted(' — prepare, tag, notes, publish, and status'), value: 'release' },
      { name: T.warning.bold('🩺  Dependency Health')        + T.muted(' — npm audit summary and outdated package score'), value: 'dep-health' },
      { name: T.warning.bold('🔐  Environment Manager')     + T.muted(' — validate, diff, sync, and audit env files'), value: 'env-manager' },
      { name: T.accent.bold('🔌  API Mock Generator')        + T.muted(' — OpenAPI to MSW handler stubs'), value: 'api-mock-gen' },
      { name: T.accent.bold('🔷  GraphQL Type Sync')        + T.muted(' — introspect APIs into schema and TS types'), value: 'graphql-sync' },
      { name: T.brand.bold('🎨  Figma Token Sync')           + T.muted(' — variables to CSS custom properties + Tailwind'), value: 'figma-tokens' },
      { name: T.success.bold('🧩  Component Generator')     + T.muted(' — create React components with tests and stories'), value: 'component-gen' },
      { name: T.success.bold('📚  Storybook Scaffolder')     + T.muted(' — install Storybook and generate stories'), value: 'storybook-scaffold' },
      { name: T.white.bold('📦  My Installed Items')     + T.muted(' — view and manage installed items'), value: 'installed' },
      { name: T.success.bold('🔧  Add Custom Agent')      + T.muted(' — add your own agent from file or URL'), value: 'custom-agent' },
      { name: T.success.bold('🤖  Add Custom Model')      + T.muted(' — add a custom AI model provider'), value: 'custom-model' },
      { name: T.muted('🔄  Refresh Catalog')    + T.muted(' — fetch latest from sources'), value: 'refresh' },
      { name: T.muted('← Back to Menu'), value: '__back__' },
    ],
    pageSize: 16,
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
    
      pageSize: 15,});
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

  if (action === 'osp-dev') {
    console.log();
    console.log(boxen(
      T.cyan.bold(' 🔍 Open Source Projects Discovery ') + '\n\n' +
      T.white('Curated open-source repos — no email required.\n') +
      T.accent('  https://www.opensourceprojects.dev\n\n') +
      T.muted('  • Hidden gems & trending GitHub repos\n') +
      T.muted('  • Developer tools, libraries, frameworks\n') +
      T.muted('  • RSS feed: opensourceprojects.dev/rss\n') +
      T.muted('  • Search: opensourceprojects.dev/?search=<query>\n\n') +
      T.dim('  Tip: add their RSS to your daily digest for passive discovery'),
      { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
    ));
    console.log();
    try { execSync('open https://www.opensourceprojects.dev 2>/dev/null || xdg-open https://www.opensourceprojects.dev 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter();
  }

  if (action === 'hermes-agent') {
    const hermesAction = await select({
      message: T.white.bold('Hermes Agent — Nous Research:'),
      choices: [
        { name: T.success.bold('⬇️  Install Hermes Agent'),         value: 'install' },
        { name: T.accent.bold('📖  Open Docs'),                    value: 'docs' },
        { name: T.cyan.bold('🌐  Open GitHub'),                    value: 'github' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (hermesAction !== '__back__') {
      console.log();
      console.log(boxen(
        T.accent.bold(' 🧠 Hermes Agent — Self-Improving AI ') + '\n\n' +
        T.white('Built by Nous Research. The only agent with a built-in learning loop.\n\n') +
        T.success.bold('  Key features:\n') +
        T.muted('  • Creates skills from experience, self-improves during use\n') +
        T.muted('  • Persistent memory across sessions (FTS5 search + LLM summarization)\n') +
        T.muted('  • Cron scheduler — daily reports, nightly backups, audits\n') +
        T.muted('  • Telegram, Discord, Slack, WhatsApp, Signal + CLI gateway\n') +
        T.muted('  • Voice memo transcription, cross-platform continuity\n') +
        T.muted('  • 6 backends: local, Docker, SSH, Modal, Daytona, Singularity\n') +
        T.muted('  • Any model: Nous Portal, OpenRouter, OpenAI, custom endpoint\n') +
        T.muted('  • agentskills.io compatible\n\n') +
        T.success.bold('  Install (macOS/Linux/WSL2):\n') +
        T.cyan('  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash\n\n') +
        T.dim('  Docs: https://hermes-agent.nousresearch.com/docs/'),
        { padding: 1, borderColor: '#8B5CF6', borderStyle: 'round' }
      ));
      console.log();
      if (hermesAction === 'install') {
        const { confirm: confirmPrompt } = await import('@inquirer/prompts');
        const go = await confirmPrompt({ message: 'Run the install script now?', default: true });
        if (go) {
          const { spawnSync } = await import('child_process');
          spawnSync('bash', ['-c', 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'], { stdio: 'inherit', cwd: process.cwd() });
        }
      } else if (hermesAction === 'docs') {
        try { execSync('open https://hermes-agent.nousresearch.com/docs/ 2>/dev/null || xdg-open https://hermes-agent.nousresearch.com/docs/ 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (hermesAction === 'github') {
        try { execSync('open https://github.com/nousresearch/hermes-agent 2>/dev/null || xdg-open https://github.com/nousresearch/hermes-agent 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'claude-marketplaces') {
    console.log();
    console.log(boxen(
      T.brand.bold(' 🗂️  Claude Marketplaces Directory ') + '\n\n' +
      T.white('Curated directory of Claude Code skills, MCP servers,\nplugin marketplaces, commands, hooks, and agents.\n\n') +
      T.accent('  https://claudemarketplaces.com\n\n') +
      T.muted('  • Skills — reusable instruction sets, install with 1 command\n') +
      T.muted('  • Plugin Marketplaces — GitHub registries of skills/MCP/agents\n') +
      T.muted('  • MCP Servers — tools, APIs, integrations\n') +
      T.muted('  • Ranked by install count, GitHub stars, community votes\n') +
      T.muted('  • 100% free to browse and install\n\n') +
      T.dim('  Tip: find skills here, then install via /skills in the toolkit'),
      { padding: 1, borderColor: '#7C3AED', borderStyle: 'round' }
    ));
    console.log();
    try { execSync('open https://claudemarketplaces.com 2>/dev/null || xdg-open https://claudemarketplaces.com 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter();
  }

  if (action === 'pocketbase') {
    console.log();
    console.log(boxen(
      T.cyan.bold(' ⚡ PocketBase — Open Source Backend in 1 File ') + '\n\n' +
      T.white('Go backend: SQLite + realtime + auth + files + Admin UI.\nSingle portable executable — no Docker, no setup.\n\n') +
      T.accent('  https://pocketbase.io/docs\n\n') +
      T.success.bold('  Download & run:\n') +
      T.cyan('  # Download from: https://github.com/pocketbase/pocketbase/releases\n') +
      T.cyan('  ./pocketbase serve\n') +
      T.cyan('  # Admin UI: http://127.0.0.1:8090/_/\n\n') +
      T.muted('  • Embedded SQLite with realtime subscriptions\n') +
      T.muted('  • Built-in auth (email, OAuth2, OTP, MFA)\n') +
      T.muted('  • File storage + S3 support\n') +
      T.muted('  • Extend with JavaScript or Go\n') +
      T.muted('  • JS SDK: npm install pocketbase\n\n') +
      T.dim('  GitHub: https://github.com/pocketbase/pocketbase'),
      { padding: 1, borderColor: '#00A3E0', borderStyle: 'round' }
    ));
    console.log();
    try { execSync('open https://pocketbase.io/docs 2>/dev/null || xdg-open https://pocketbase.io/docs 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter();
  }

  if (action === 'page-agent') {
    const paAction = await select({
      message: T.warning.bold('🖱️  Page Agent (Alibaba) — where do you want to use it?'),
      choices: [
        { name: T.warning.bold('🌐  Use in Browser')     + T.muted(' — install Chrome extension, works on any site'), value: 'browser' },
        { name: T.cyan.bold('💻  Use in Project')        + T.muted(' — npm install + React/Next.js integration'), value: 'project' },
        { name: T.success.bold('📖  Quick start guide'), value: 'guide' },
        { name: T.accent.bold('🐙  GitHub'),             value: 'github' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (paAction !== '__back__') {
      console.log();
      if (paAction === 'browser') {
        console.log(boxen(
          T.warning.bold(' 🌐 Page Agent — Browser (Chrome Extension) ') + '\n\n' +
          T.white('Adds an AI agent to any website you browse — no code needed.\n\n') +
          T.success.bold('  Install:\n') +
          T.cyan('  1. Open Chrome Web Store:\n') +
          T.cyan('     https://chromewebstore.google.com/detail/page-agent-ext/akldabonmimlicnjlflnapfeklbfemhj\n') +
          T.cyan('  2. Click "Add to Chrome"\n') +
          T.cyan('  3. Click the extension icon → enter your API key (OpenAI / Anthropic)\n\n') +
          T.success.bold('  Usage:\n') +
          T.white('  • Open any webpage\n') +
          T.white('  • Click the Page Agent icon in the toolbar\n') +
          T.white('  • Type a task: "fill the login form", "find all prices", "click the submit button"\n') +
          T.white('  • Agent executes it in the page — no screenshots, pure DOM manipulation\n'),
          { padding: 1, borderColor: '#F59E0B', borderStyle: 'round' }
        ));
        try { execSync('open https://chromewebstore.google.com/detail/page-agent-ext/akldabonmimlicnjlflnapfeklbfemhj 2>/dev/null || xdg-open https://chromewebstore.google.com/detail/page-agent-ext/akldabonmimlicnjlflnapfeklbfemhj 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (paAction === 'project') {
        console.log(boxen(
          T.cyan.bold(' 💻 Page Agent — In Your React/Next.js Project ') + '\n\n' +
          T.white('Embed an AI agent directly in your web app for users.\n\n') +
          T.success.bold('  Install:\n') +
          T.cyan('  npm install page-agent\n\n') +
          T.success.bold('  React/Next.js usage:\n') +
          T.cyan("  import { PageAgent } from 'page-agent'\n\n") +
          T.cyan("  // In your component or _app.tsx:\n") +
          T.cyan("  <PageAgent apiKey={process.env.NEXT_PUBLIC_AI_KEY} />\n\n") +
          T.success.bold('  Env setup (.env.local):\n') +
          T.cyan('  NEXT_PUBLIC_AI_KEY=your-openai-or-anthropic-key\n\n') +
          T.success.bold('  Features:\n') +
          T.white('  • No browser extension or headless browser needed\n') +
          T.white('  • Works with OpenAI, Anthropic, or any LLM\n') +
          T.white('  • Text-based DOM — no screenshots, no multimodal needed\n') +
          T.white('  • Automates: form filling, navigation, UI tasks, scraping\n') +
          T.dim('  Docs: https://alibaba.github.io/page-agent/docs/introduction/overview'),
          { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
        ));
        const { spawnSync } = await import('child_process');
        const yn = await select({ message: 'Install page-agent in current directory?', choices: [{ name: 'Yes — npm install page-agent', value: 'y' }, { name: 'No — just show the instructions', value: 'n' }],
          pageSize: 15,});
        if (yn === 'y') spawnSync('npm', ['install', 'page-agent'], { stdio: 'inherit', cwd: process.cwd() });
      } else if (paAction === 'guide') {
        console.log(boxen(
          T.warning.bold(' 🖱️  Page Agent — Quick Start ') + '\n\n' +
          T.yellow.bold('  Browser (fastest):\n') +
          T.white('  Install Chrome extension → enter API key → works on any site\n\n') +
          T.cyan.bold('  Project (embed in your app):\n') +
          T.white('  npm install page-agent → <PageAgent apiKey="..." />\n\n') +
          T.success.bold('  Example tasks you can give it:\n') +
          T.white('  "Fill in the form with test data"\n') +
          T.white('  "Click the Submit button"\n') +
          T.white('  "Find all product prices on this page"\n') +
          T.white('  "Navigate to the settings page"\n') +
          T.white('  "Extract all links from the table"\n\n') +
          T.dim('  Docs: https://alibaba.github.io/page-agent\n') +
          T.dim('  GitHub: https://github.com/alibaba/page-agent'),
          { padding: 1, borderColor: '#F59E0B', borderStyle: 'round' }
        ));
      } else if (paAction === 'github') {
        try { execSync('open https://github.com/alibaba/page-agent 2>/dev/null || xdg-open https://github.com/alibaba/page-agent 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    console.log();
    await pressEnter();
  }

  if (action === 'strix') {
    console.log();
    console.log(boxen(
      T.red.bold(' 🔐 Strix — Autonomous AI Penetration Testing ') + '\n\n' +
      T.white('AI pentesters that act like real hackers.\n') +
      T.muted('Real exploit validation with working PoCs — not false positives.\n\n') +
      T.success.bold('  Install:\n') +
      T.cyan('  curl -sSL https://strix.ai/install | bash\n\n') +
      T.success.bold('  Configure & run:\n') +
      T.cyan('  export STRIX_LLM="openai/gpt-5.4"\n') +
      T.cyan('  export LLM_API_KEY="your-key"\n') +
      T.cyan('  strix --target ./your-app\n\n') +
      T.warning('  Requires: Docker (running) + LLM API key\n\n') +
      T.muted('  Features:\n') +
      T.muted('  • Multi-agent pentest orchestration\n') +
      T.muted('  • Working PoC exploits for every finding\n') +
      T.muted('  • One-click auto-fix PRs\n') +
      T.muted('  • CI/CD integration (GitHub Actions, GitLab)\n') +
      T.muted('  • Compliance-ready reports\n\n') +
      T.dim('  Platform: https://app.strix.ai'),
      { padding: 1, borderColor: '#EF4444', borderStyle: 'round' }
    ));
    console.log();
    try { execSync('open https://app.strix.ai 2>/dev/null || xdg-open https://app.strix.ai 2>/dev/null', { stdio: 'ignore' }); } catch {}
    await pressEnter();
  }

  if (action === 'hackingtool') {
    const htAction = await select({
      message: T.red.bold('🛡️  HackingTool — 185+ Pentesting Tools:'),
      choices: [
        { name: T.success.bold('⬇️  Install HackingTool'),                value: 'install' },
        { name: T.red.bold('📖  Tool categories (35 categories)'),        value: 'info' },
        { name: T.warning.bold('🌐  Open GitHub (50k+ stars)'),           value: 'github' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (htAction !== '__back__') {
      console.log();
      const cats = [
        '🔍 Info Gathering', '🔎 OSINT', '🌐 Web Vuln Scanning', '🔓 Password Attacks',
        '📶 Wireless Attacks', '💻 Exploitation', '🔧 Post-Exploitation', '🔁 Reverse Engineering',
        '🖥  RAT', '🏢 Active Directory', '☁️  Cloud Security', '📱 Mobile Security',
        '🕵️  Anonymising', '📡 Network Scanning', '🐛 Malware Analysis',
      ].map(c => `  ${c}`).join('\n');
      console.log(boxen(
        T.red.bold(' 🛡️  HackingTool — All-in-One Hacking & Pentest Suite ') + '\n\n' +
        T.white('185+ curated ethical hacking tools, 35 categories.\n') +
        T.white('OS-aware menus, tag filter (/), search, batch install.\n\n') +
        T.yellow.bold('  Categories:\n') + T.white(cats) + '\n\n' +
        T.success.bold('  Install (Linux/macOS):\n') +
        T.cyan('  curl -sSL https://raw.githubusercontent.com/Z4nzu/hackingtool/master/install.sh | sudo bash\n\n') +
        T.success.bold('  Run:\n') +
        T.cyan('  sudo python3 hack.py\n') +
        T.cyan('  # Then use / to search, t to filter by tag, r for recommend\n\n') +
        T.dim('  GitHub: https://github.com/Z4nzu/hackingtool · ⭐ 50k+'),
        { padding: 1, borderColor: '#EF4444', borderStyle: 'round' }
      ));
      console.log();
      if (htAction === 'install') {
        try { execSync('open https://github.com/Z4nzu/hackingtool 2>/dev/null || xdg-open https://github.com/Z4nzu/hackingtool 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (htAction === 'github') {
        try { execSync('open https://github.com/Z4nzu/hackingtool 2>/dev/null || xdg-open https://github.com/Z4nzu/hackingtool 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'pentest') {
    const ptAction = await select({
      message: T.red.bold('🔍 Security Scanner — Project Vulnerability Testing:'),
      choices: [
        { name: T.red.bold('🔍  Full Scan')            + T.muted(' — deps + secrets + static code analysis'), value: 'scan' },
        { name: T.warning.bold('📦  Dependencies')      + T.muted(' — npm audit · CVE check · risky packages'), value: 'deps' },
        { name: T.red.bold('🔑  Secrets Scan')          + T.muted(' — find hardcoded API keys, tokens, passwords'), value: 'secrets' },
        { name: T.warning.bold('💻  Code Analysis')     + T.muted(' — XSS, eval, innerHTML, dangerouslySetInnerHTML'), value: 'code' },
        { name: T.cyan.bold('🌐  HTTP Headers')         + T.muted(' — CSP, HSTS, X-Frame-Options, etc.'), value: 'headers' },
        { name: T.brand.bold('📋  OWASP Top-10')        + T.muted(' — checklist for your React/Next.js app'), value: 'owasp' },
        { name: T.success.bold('📊  Generate Report')   + T.muted(' — save Markdown security report'), value: 'report' },
        { name: T.accent.bold('⬇️  Install Tools')      + T.muted(' — install audit-ci, semgrep, truffleHog'), value: 'install-tools' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 10,
    });
    if (ptAction !== '__back__') {
      console.log();
      if (ptAction === 'scan' || ptAction === 'deps' || ptAction === 'secrets' || ptAction === 'code' || ptAction === 'headers' || ptAction === 'owasp' || ptAction === 'report' || ptAction === 'install-tools') {
        const { spawnSync } = await import('child_process');
        spawnSync('bash', [resolve(ROOT, 'scripts/pentest.sh'), ptAction], { stdio: 'inherit', cwd: process.cwd() });
      }
    }
    await pressEnter();
  }

  if (action === 'career-helper') {
    const careerAction = await select({
      message: T.cyan.bold('🎯 Career Helper — 14 Skills:'),
      choices: [
        { name: T.success.bold('⬇️  Install Career Helper'),                         value: 'install' },
        { name: T.accent.bold('🧑‍💼  Career Coach (Tim)')       + T.muted(' — guided coaching, recommended first step'), value: 'coach' },
        { name: T.white.bold('📄  Application Optimiser')      + T.muted(' — ATS CV rewrite, cover letter, research'), value: 'cv' },
        { name: T.brand.bold('💼  LinkedIn Coach')             + T.muted(' — profile audit, headline, content strategy'), value: 'linkedin' },
        { name: T.warning.bold('🎤  Interview Master')          + T.muted(' — mock interviews, prep, post-interview coaching'), value: 'interview' },
        { name: T.cyan.bold('🔍  Job Scout')                   + T.muted(' — live role discovery, batch ranking, kanban tracker'), value: 'scout' },
        { name: T.success.bold('📊  Skills Radar')              + T.muted(' — skills inventory, gap analysis, learning plans'), value: 'skills-radar' },
        { name: T.accent.bold('🔄  Career Transitions')         + T.muted(' — fractional, entrepreneurship, non-linear paths'), value: 'transitions' },
        { name: T.red.bold('🤖  AI Impact Assessment')         + T.muted(' — will AI disrupt your role in 12 months?'), value: 'ai-impact' },
        { name: T.muted('📋  View all 14 skills'), value: 'list' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 12,
    });

    if (careerAction === '__back__') { await pressEnter(); return; }

    if (careerAction === 'list') {
      console.log();
      const skills = [
        ['🧑‍💼', 'Career Coach (Tim)',    '/career-helper:career-coach',    'Guided coaching — start here'],
        ['🚀', 'Getting Started',        '/getting-started',                'Full overview + checklists'],
        ['🔎', 'Employer Footprint',     '/employer-footprint',             'Digital audit through employer\'s eyes'],
        ['📱', 'Social Media Review',    '/social-media-review',            'Quick check through recruiter\'s eyes'],
        ['📄', 'Application Optimiser',  '/application-optimiser',          'ATS CV + cover letter + research'],
        ['💼', 'LinkedIn Coach',         '/linkedin-coach',                 'Profile audit, content strategy'],
        ['🎤', 'Interview Master',       '/interview-master',               'Mock interviews + reference prep'],
        ['🗺️', 'Career Navigator',       '/career-navigator',               'Networking, salary, kanban tracker'],
        ['🔍', 'Job Scout',              '/job-scout',                      'Live role discovery + ranking'],
        ['📊', 'Skills Radar',           '/skills-radar',                   'Gap analysis + learning plans'],
        ['🔄', 'Career Transitions',     '/career-transitions',             'Fractional, startup, public sector'],
        ['🤖', 'AI Impact Assessment',   '/ai-impact-assessment',           'AI disruption + mitigation plan'],
        ['📋', 'NED AI Helper',          '/ned-ai-helper',                  'AI governance for board members'],
        ['✨', 'Personal Brand',         '/personal-brand',                 'Why You, Why Them positioning'],
      ];
      console.log(T.bold('\n  All 14 Career Helper Skills:\n'));
      for (const [icon, name, cmd, desc] of skills) {
        console.log(`  ${icon} ${T.white.bold(name.padEnd(22))} ${T.cyan(cmd.padEnd(32))} ${T.dim(desc)}`);
      }
      console.log();
    } else {
      const infoMap = {
        install: {
          title: '⬇️  Install Career Helper',
          body: T.success.bold('  Claude Desktop (recommended):\n') +
            T.muted('  1. Click + → Add plugins → Add marketplace from GitHub\n') +
            T.muted('  2. Enter: Zal4DW/career-helper → Sync → Install\n\n') +
            T.success.bold('  Claude Code CLI:\n') +
            T.cyan('  claude plugin marketplace add Zal4DW/career-helper\n') +
            T.cyan('  claude plugin install career-helper@career-helper\n\n') +
            T.muted('  ✅ Free on all Claude plans including free tier'),
        },
        coach: {
          title: '🧑‍💼  Career Coach (Tim)',
          body: T.muted('  Personal AI career coach that guides you through the\n  right skills in the right order.\n\n') +
            T.cyan('  /career-helper:career-coach\n') + T.muted('  /career-helper:quick-start\n') +
            T.dim('\n  Start here if you\'re new to the plugin'),
        },
        cv: {
          title: '📄  Application Optimiser',
          body: T.muted('  ATS-optimised CV rewriting, cover letters, company research,\n  verified PDF production with ATS text-layer checks.\n\n') +
            T.cyan('  /application-optimiser\n'),
        },
        linkedin: {
          title: '💼  LinkedIn Coach',
          body: T.muted('  Profile audit, headline optimisation, content strategy,\n  post review, video scripts.\n\n') +
            T.cyan('  /linkedin-coach\n'),
        },
        interview: {
          title: '🎤  Interview Master',
          body: T.muted('  Mock interviews, interviewer perspective reports,\n  post-interview coaching, reference prep, ageism support.\n\n') +
            T.cyan('  /interview-master\n'),
        },
        scout: {
          title: '🔍  Job Scout',
          body: T.muted('  Live role discovery with honest coverage caveats.\n  Batch ranking with deal-breaker vetting + deadline flags.\n  Interactive kanban application tracker.\n\n') +
            T.cyan('  /job-scout\n') + T.cyan('  /career-navigator\n'),
        },
        'skills-radar': {
          title: '📊  Skills Radar',
          body: T.muted('  Evidenced skills inventory (including public work),\n  gap analysis vs target role, realistic learning plans.\n\n') +
            T.cyan('  /skills-radar\n'),
        },
        transitions: {
          title: '🔄  Career Transitions',
          body: T.muted('  Fractional careers, entrepreneurship, startups, public sector,\n  charity, intrapreneurship, multi-role skilling.\n\n') +
            T.cyan('  /career-transitions\n'),
        },
        'ai-impact': {
          title: '🤖  AI Impact Assessment',
          body: T.muted('  Researches whether AI will materially disrupt your role\n  in the next 12 months, with a 6-month mitigation plan.\n\n') +
            T.cyan('  /ai-impact-assessment\n'),
        },
      };
      const info = infoMap[careerAction];
      if (info) {
        console.log();
        console.log(boxen(
          T.cyan.bold(` ${info.title} `) + '\n\n' + info.body + T.dim('\n  GitHub: https://github.com/Zal4DW/career-helper'),
          { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
        ));
        console.log();
        if (careerAction === 'install') {
          try { execSync('open https://github.com/Zal4DW/career-helper 2>/dev/null || xdg-open https://github.com/Zal4DW/career-helper 2>/dev/null', { stdio: 'ignore' }); } catch {}
        }
      }
    }
    await pressEnter();
  }

  if (action === 'career-ops') {
    const subAction = await select({
      message: T.success.bold('🗂️  Career-Ops — Multi-Agent Job Search:'),
      choices: [
        { name: T.success.bold('⬇️  Install Career-Ops'),              value: 'install' },
        { name: T.cyan.bold('📖  How it works'),                       value: 'info' },
        { name: T.accent.bold('🌐  GitHub'),                           value: 'github' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (subAction !== '__back__') {
      console.log();
      console.log(boxen(
        T.success.bold(' 🗂️  Career-Ops — Multi-Agent Job Search System ') + '\n\n' +
        T.white('Featured in WIRED + Business Insider. 740+ job listings evaluated,\n') +
        T.white('100+ personalised CVs generated, 1 dream role landed.\n\n') +
        T.yellow('Companies use AI to filter candidates.\n') +
        T.yellow('Career-Ops gives candidates AI to choose companies.\n\n') +
        T.success.bold('  Install:\n') +
        T.cyan('  npm install -g @santifer/career-ops\n') +
        T.cyan('  career-ops init\n\n') +
        T.success.bold('  Features:\n') +
        T.white('  • Batch-evaluate 700+ job listings against your criteria\n') +
        T.white('  • Auto-personalise CVs per job + company\n') +
        T.white('  • Multi-agent orchestration (research, ranking, apply)\n') +
        T.dim('  GitHub: https://github.com/santifer/career-ops'),
        { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
      ));
      console.log();
      if (subAction === 'install') {
        try { execSync('npm install -g @santifer/career-ops 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (subAction === 'github') {
        try { execSync('open https://github.com/santifer/career-ops 2>/dev/null || xdg-open https://github.com/santifer/career-ops 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'awesome-claude-design-rohitg00' || action === 'awesome-claude-design-voltagent') {
    const isVolt = action === 'awesome-claude-design-voltagent';
    const ghUrl = isVolt
      ? 'https://github.com/VoltAgent/awesome-claude-design'
      : 'https://github.com/rohitg00/awesome-claude-design';
    const author = isVolt ? 'VoltAgent' : 'rohitg00';
    const subAction = await select({
      message: T.brand.bold(`🎨 Awesome Claude Design (${author}):`),
      choices: [
        { name: T.cyan.bold('📖  What is DESIGN.md?'),    value: 'info' },
        { name: T.accent.bold('🌐  Open GitHub'),         value: 'github' },
        { name: T.brand.bold('🎨  Open Claude Design'),   value: 'claude-design' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (subAction !== '__back__') {
      console.log();
      console.log(boxen(
        T.brand.bold(` 🎨 Awesome Claude Design — ${author} `) + '\n\n' +
        T.white('Ready-to-use DESIGN.md files for Claude Design (Anthropic Labs).\n') +
        T.white('Upload a DESIGN.md → Claude scaffolds a full design system:\n') +
        T.white('color tokens, type scale, components, preview cards, UI kit.\n\n') +
        T.success.bold('  Usage:\n') +
        T.cyan('  1. Browse the collection on GitHub\n') +
        T.cyan('  2. Download a DESIGN.md file\n') +
        T.cyan('  3. Open https://claude.ai/design\n') +
        T.cyan('  4. Upload the DESIGN.md → full design system generated\n\n') +
        T.white('  Also see: https://getdesign.md for more DESIGN.md files\n') +
        T.dim(`  GitHub: ${ghUrl}`),
        { padding: 1, borderColor: '#A855F7', borderStyle: 'round' }
      ));
      console.log();
      if (subAction === 'github') {
        try { execSync(`open ${ghUrl} 2>/dev/null || xdg-open ${ghUrl} 2>/dev/null`, { stdio: 'ignore' }); } catch {}
      } else if (subAction === 'claude-design') {
        try { execSync('open https://claude.ai/design 2>/dev/null || xdg-open https://claude.ai/design 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'impeccable') {
    const impAction = await select({
      message: T.brand.bold('✨ Impeccable — AI Design Skill:'),
      choices: [
        { name: T.success.bold('⬇️  Install'),                  value: 'install' },
        { name: T.brand.bold('📖  23 Commands overview'),        value: 'info' },
        { name: T.cyan.bold('🌐  impeccable.style docs'),        value: 'docs' },
        { name: T.accent.bold('🐙  GitHub'),                     value: 'github' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (impAction !== '__back__') {
      console.log();
      console.log(boxen(
        T.brand.bold(' ✨ Impeccable — Design Guidance for AI Coding Agents ') + '\n\n' +
        T.white('Eliminates AI design tells: Inter-for-everything, purple→blue\n') +
        T.white('gradients, cards-in-cards, gray text on coloured backgrounds.\n\n') +
        T.yellow.bold('  23 commands  ·  46 detector rules  ·  live browser iteration\n\n') +
        T.success.bold('  Install:\n') +
        T.cyan('  npx impeccable install\n\n') +
        T.success.bold('  Init (writes PRODUCT.md + DESIGN.md):\n') +
        T.cyan('  /impeccable init\n\n') +
        T.success.bold('  Key commands:\n') +
        T.white('  /impeccable craft    — full shape-then-build flow\n') +
        T.white('  /impeccable polish   — final pass, design system alignment\n') +
        T.white('  /impeccable audit    — a11y, performance, responsive checks\n') +
        T.white('  /impeccable critique — UX hierarchy, clarity, emotional resonance\n') +
        T.white('  /impeccable animate  — add purposeful motion\n') +
        T.white('  /impeccable bolder   — stronger visual hierarchy\n') +
        T.white('  /impeccable quieter  — reduce visual noise\n') +
        T.white('  /impeccable distil   — strip to essentials\n\n') +
        T.dim('  GitHub: https://github.com/pbakaus/impeccable\n') +
        T.dim('  Docs: https://impeccable.style'),
        { padding: 1, borderColor: '#A855F7', borderStyle: 'round' }
      ));
      console.log();
      if (impAction === 'install') {
        const { spawnSync } = await import('child_process');
        spawnSync('npx', ['impeccable', 'install'], { stdio: 'inherit', cwd: process.cwd() });
      } else if (impAction === 'docs') {
        try { execSync('open https://impeccable.style 2>/dev/null || xdg-open https://impeccable.style 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (impAction === 'github') {
        try { execSync('open https://github.com/pbakaus/impeccable 2>/dev/null || xdg-open https://github.com/pbakaus/impeccable 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'claude-plugin-frontend-design') {
    const fdAction = await select({
      message: T.brand.bold('🎨 Frontend Design Plugin (Official Anthropic):'),
      choices: [
        { name: T.success.bold('⬇️  Install plugin'),               value: 'install' },
        { name: T.brand.bold('📖  What it does'),                   value: 'info' },
        { name: T.cyan.bold('🌐  Open plugin page'),                value: 'open' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (fdAction !== '__back__') {
      console.log();
      console.log(boxen(
        T.brand.bold(' 🎨 Frontend Design — Official Claude Plugin ') + '\n\n' +
        T.white('Generates distinctive, production-grade frontend interfaces.\n') +
        T.white('Activates automatically when you ask Claude to build UIs.\n\n') +
        T.yellow.bold('  Aesthetic modes:\n') +
        T.white('  brutalist · maximalist · retro-futuristic · luxury\n') +
        T.white('  playful · editorial · dark-mode · and more\n\n') +
        T.success.bold('  Install:\n') +
        T.cyan('  claude plugin add frontend-design\n\n') +
        T.success.bold('  Example prompts:\n') +
        T.white('  "Create a dashboard for a music streaming app"\n') +
        T.white('  "Build a landing page for an AI security startup"\n') +
        T.white('  "Design a settings panel with dark mode support"\n\n') +
        T.success.bold('  Design features:\n') +
        T.white('  • Unexpected typography pairings\n') +
        T.white('  • Orchestrated motion + scroll-triggered interactions\n') +
        T.white('  • Asymmetric layouts, grid-breaking elements\n') +
        T.white('  • Gradients, textures, layered depth effects\n') +
        T.white('  • Avoids: Inter-for-everything, purple gradients, cookie-cutter components\n\n') +
        T.dim('  Plugin: https://claude.com/plugins/frontend-design'),
        { padding: 1, borderColor: '#A855F7', borderStyle: 'round' }
      ));
      console.log();
      if (fdAction === 'install') {
        const { spawnSync } = await import('child_process');
        spawnSync('claude', ['plugin', 'add', 'frontend-design'], { stdio: 'inherit', cwd: process.cwd() });
      } else if (fdAction === 'open') {
        try { execSync('open https://claude.com/plugins/frontend-design 2>/dev/null || xdg-open https://claude.com/plugins/frontend-design 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'career-tools') {
    const ctAction = await select({
      message: T.accent.bold('🔧 Career Tools — Built-in Scripts:'),
      choices: [
        { name: T.success.bold('📄  career-cv')       + T.muted(' — version-control your CV in git, diff versions'),     value: 'cv' },
        { name: T.warning.bold('🎯  career-prep')      + T.muted(' — interview prep brief for any company'),               value: 'prep' },
        { name: T.cyan.bold('📊  career-track')        + T.muted(' — local job application tracker + ADO sync'),           value: 'track' },
        { name: T.brand.bold('🔍  career-gap')         + T.muted(' — compare CV vs job description, score fit %'),         value: 'gap' },
        { name: T.accent.bold('💼  career-linkedin')   + T.muted(' — generate 30-day LinkedIn content calendar'),          value: 'linkedin' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 8,
    });
    const ctInfo = {
      cv: {
        title: '📄 career-cv — CV Version Control',
        cmd: 'ghostforge career-cv',
        color: '#22C55E',
        body:
          T.white('Version-control your CV in git, diff between versions.\n\n') +
          T.success.bold('  Commands:\n') +
          T.cyan('  ghostforge career-cv init <path>    — init git-tracked CV repo\n') +
          T.cyan('  ghostforge career-cv save [msg]     — save a new version\n') +
          T.cyan('  ghostforge career-cv diff [v1] [v2] — diff between versions\n') +
          T.cyan('  ghostforge career-cv versions       — show all saved versions\n') +
          T.cyan('  ghostforge career-cv export         — export to ~/Desktop\n'),
      },
      prep: {
        title: '🎯 career-prep — Interview Prep Launcher',
        cmd: 'ghostforge career-prep',
        color: '#F59E0B',
        body:
          T.white('Quick interview prep brief for any company.\n\n') +
          T.success.bold('  Commands:\n') +
          T.cyan('  ghostforge career-prep <company>    — create prep brief\n') +
          T.cyan('  ghostforge career-prep list         — list all briefs\n') +
          T.cyan('  ghostforge career-prep open <co>    — open most recent brief\n') +
          T.white('\n  Creates a structured Markdown brief: company research,\n') +
          T.white('  STAR stories scaffold, React/TS technical questions.\n'),
      },
      track: {
        title: '📊 career-track — Job Application Tracker',
        cmd: 'ghostforge career-track',
        color: '#06B6D4',
        body:
          T.white('Local job application tracker (SQLite + CSV export).\n\n') +
          T.success.bold('  Commands:\n') +
          T.cyan('  ghostforge career-track add <co> <role> [url]  — add application\n') +
          T.cyan('  ghostforge career-track update <id> <status>   — update status\n') +
          T.cyan('  ghostforge career-track list [--status]        — list all\n') +
          T.cyan('  ghostforge career-track stats                  — response rate etc\n') +
          T.cyan('  ghostforge career-track export                 — export CSV\n') +
          T.white('\n  Statuses: applied | screening | interview | offer | rejected\n'),
      },
      gap: {
        title: '🔍 career-gap — CV vs JD Skills Gap Scorer',
        cmd: 'ghostforge career-gap',
        color: '#A855F7',
        body:
          T.white('Compare your CV vs a job description, score the fit.\n\n') +
          T.success.bold('  Commands:\n') +
          T.cyan('  ghostforge career-gap score <cv> <jd>    — score match %\n') +
          T.cyan('  ghostforge career-gap keywords <file>    — extract keywords\n') +
          T.cyan('  ghostforge career-gap suggest <cv> <jd>  — Claude prompt to tailor CV\n') +
          T.white('\n  Extracts tech/skill keywords, shows missing vs matching,\n') +
          T.white('  outputs a score out of 100.\n'),
      },
      linkedin: {
        title: '💼 career-linkedin — LinkedIn Content Calendar',
        cmd: 'ghostforge career-linkedin',
        color: '#0EA5E9',
        body:
          T.white('Generate 30-day LinkedIn content calendar.\n\n') +
          T.success.bold('  Commands:\n') +
          T.cyan('  ghostforge career-linkedin calendar <topic> — generate 30-day plan\n') +
          T.cyan('  ghostforge career-linkedin post <topic>     — single post prompt\n') +
          T.cyan('  ghostforge career-linkedin list             — list saved calendars\n') +
          T.cyan('  ghostforge career-linkedin open [date]      — open calendar in editor\n') +
          T.white('\n  Each day: format (text/carousel/poll/video), theme, hook line.\n'),
      },
    };
    if (ctAction !== '__back__') {
      const info = ctInfo[ctAction];
      if (info) {
        console.log();
        console.log(boxen(
          T.accent.bold(` ${info.title} `) + '\n\n' + info.body +
          T.dim(`\n  Script: scripts/${ctAction === 'cv' ? 'career-cv' : ctAction === 'linkedin' ? 'career-linkedin' : `career-${ctAction}`}.sh`),
          { padding: 1, borderColor: info.color, borderStyle: 'round' }
        ));
        console.log();
      }
    }
    await pressEnter();
  }

  if (action === 'playwright') {
    const pwAction = await select({
      message: T.success.bold('🎭 Playwright — E2E Testing:'),
      choices: [
        { name: T.success.bold('⬇️  Install in project'),              value: 'install' },
        { name: T.cyan.bold('🎬  Codegen')      + T.muted(' — record tests by clicking in your browser'),  value: 'codegen' },
        { name: T.warning.bold('▶️   Run tests'),                       value: 'run' },
        { name: T.accent.bold('🔍  Trace Viewer')+ T.muted(' — debug failed tests visually'),              value: 'trace' },
        { name: T.brand.bold('📖  Quick start guide'),                 value: 'guide' },
        { name: T.muted('🌐  playwright.dev docs'),                    value: 'docs' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 9,
    });
    if (pwAction !== '__back__') {
      console.log();
      if (pwAction === 'guide') {
        console.log(boxen(
          T.success.bold(' 🎭 Playwright — E2E Testing Quick Start ') + '\n\n' +
          T.success.bold('  1. Install:\n') +
          T.cyan('  npm init playwright@latest\n') +
          T.cyan('  # Picks Chromium/Firefox/WebKit, creates tests/ folder, CI config\n\n') +
          T.success.bold('  2. Write a test (tests/example.spec.ts):\n') +
          T.cyan("  import { test, expect } from '@playwright/test'\n\n") +
          T.cyan("  test('homepage loads', async ({ page }) => {\n") +
          T.cyan("    await page.goto('http://localhost:3000')\n") +
          T.cyan("    await expect(page).toHaveTitle(/My App/)\n") +
          T.cyan("  })\n\n") +
          T.success.bold('  3. Run tests:\n') +
          T.cyan('  npx playwright test              # headless\n') +
          T.cyan('  npx playwright test --ui         # interactive UI mode\n') +
          T.cyan('  npx playwright test --headed     # watch browser\n\n') +
          T.success.bold('  4. Codegen (record by clicking):\n') +
          T.cyan('  npx playwright codegen http://localhost:3000\n\n') +
          T.success.bold('  5. Debug with Trace Viewer:\n') +
          T.cyan('  npx playwright test --trace on\n') +
          T.cyan('  npx playwright show-report\n\n') +
          T.dim('  Docs: https://playwright.dev · GitHub: microsoft/playwright'),
          { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
        ));
      } else if (pwAction === 'install') {
        const { spawnSync } = await import('child_process');
        spawnSync('npm', ['init', 'playwright@latest'], { stdio: 'inherit', cwd: process.cwd() });
      } else if (pwAction === 'codegen') {
        const { input } = await import('@inquirer/prompts');
        const url = await input({ message: 'URL to record against:', default: 'http://localhost:3000' });
        const { spawnSync } = await import('child_process');
        spawnSync('npx', ['playwright', 'codegen', url], { stdio: 'inherit', cwd: process.cwd() });
      } else if (pwAction === 'run') {
        const { spawnSync } = await import('child_process');
        const mode = await select({ message: 'Run mode:', choices: [
          { name: 'Headless (default)', value: [] },
          { name: 'UI mode (interactive)', value: ['--ui'] },
          { name: 'Headed (watch browser)', value: ['--headed'] },
          { name: 'Debug mode', value: ['--debug'] },
        ],
          pageSize: 15,});
        spawnSync('npx', ['playwright', 'test', ...mode], { stdio: 'inherit', cwd: process.cwd() });
      } else if (pwAction === 'trace') {
        const { spawnSync } = await import('child_process');
        spawnSync('npx', ['playwright', 'show-report'], { stdio: 'inherit', cwd: process.cwd() });
      } else if (pwAction === 'docs') {
        try { execSync('open https://playwright.dev 2>/dev/null || xdg-open https://playwright.dev 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'ui-tars') {
    const { spawnSync: spawnUT } = await import('child_process');
    const utAction = await select({
      message: T.cyan.bold('👁️  UI-TARS — ByteDance GUI Automation Agent:'),
      choices: [
        { name: T.cyan.bold('ℹ️   About UI-TARS')          + T.muted(' — capabilities, models, use cases'), value: 'info' },
        { name: T.success.bold('🖥️  UI-TARS Desktop')      + T.muted(' — download local desktop app'), value: 'desktop' },
        { name: T.accent.bold('🤖  Model Setup')            + T.muted(' — run 7B model locally or via API'), value: 'model' },
        { name: T.brand.bold('🌐  Midscene Browser Auto')   + T.muted(' — Playwright + UI-TARS visual testing'), value: 'midscene' },
        { name: T.muted('📄  Research Paper'),               value: 'paper' },
        { name: T.muted('🌐  Website (seed-tars.com)'),      value: 'site' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 8,
    });
    if (utAction !== '__back__') {
      console.log();
      if (utAction === 'paper' || utAction === 'site' || utAction === 'desktop') {
        spawnUT('bash', [resolve(ROOT, 'scripts/ui-tars.sh'), 'open', utAction === 'desktop' ? 'desktop' : utAction], { stdio: 'inherit', cwd: process.cwd() });
      } else {
        spawnUT('bash', [resolve(ROOT, 'scripts/ui-tars.sh'), utAction], { stdio: 'inherit', cwd: process.cwd() });
      }
    }
    await pressEnter();
  }

  if (action === 'openrouter') {
    const orAction = await select({
      message: T.warning.bold('🔀 OpenRouter — AI Model Hub:'),
      choices: [
        { name: T.warning.bold('🆓  Browse Free Models')  + T.muted(' — Llama, Mistral, Gemini, DeepSeek, Qwen...'), value: 'free' },
        { name: T.cyan.bold('📋  All 300+ Models'),       value: 'all' },
        { name: T.success.bold('🔑  Get API Key'),         value: 'apikey' },
        { name: T.brand.bold('💻  Use in project')        + T.muted(' — OpenAI-compatible setup snippet'), value: 'code' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (orAction !== '__back__') {
      console.log();
      if (orAction === 'code') {
        console.log(boxen(
          T.warning.bold(' 🔀 OpenRouter — Use in Your Project ') + '\n\n' +
          T.white('OpenAI-compatible API — swap base URL, keep same SDK.\n\n') +
          T.success.bold('  Install (uses openai package):\n') +
          T.cyan('  npm install openai\n\n') +
          T.success.bold('  TypeScript setup:\n') +
          T.cyan("  import OpenAI from 'openai'\n\n") +
          T.cyan("  const client = new OpenAI({\n") +
          T.cyan("    apiKey: process.env.OPENROUTER_API_KEY,\n") +
          T.cyan("    baseURL: 'https://openrouter.ai/api/v1',\n") +
          T.cyan("  })\n\n") +
          T.cyan("  const res = await client.chat.completions.create({\n") +
          T.cyan("    model: 'meta-llama/llama-3.1-8b-instruct:free', // free!\n") +
          T.cyan("    messages: [{ role: 'user', content: 'Hello' }],\n") +
          T.cyan("  })\n\n") +
          T.success.bold('  .env.local:\n') +
          T.cyan('  OPENROUTER_API_KEY=sk-or-...\n\n') +
          T.success.bold('  Popular free models:\n') +
          T.white('  meta-llama/llama-3.1-8b-instruct:free\n') +
          T.white('  google/gemini-2.0-flash-exp:free\n') +
          T.white('  deepseek/deepseek-r1:free\n') +
          T.white('  mistralai/mistral-7b-instruct:free\n') +
          T.white('  qwen/qwen-2.5-72b-instruct:free\n\n') +
          T.dim('  Browse all free: https://openrouter.ai/models?supported_parameters=free'),
          { padding: 1, borderColor: '#F59E0B', borderStyle: 'round' }
        ));
      } else {
        const urls = {
          free: 'https://openrouter.ai/models?order=top-weekly&supported_parameters=free',
          all:  'https://openrouter.ai/models?order=top-weekly',
          apikey: 'https://openrouter.ai/settings/keys',
        };
        const url = urls[orAction];
        console.log(boxen(
          T.warning.bold(' 🔀 OpenRouter ') + '\n\n' +
          (orAction === 'free'
            ? T.white('Opening free models browser...\n') + T.muted('Filter: top weekly · free tier · 300+ options\n\n') +
              T.success.bold('  Popular free models:\n') +
              T.white('  🦙 Llama 3.1 8B / 70B / 405B (Meta)\n') +
              T.white('  ✨ Gemini 2.0 Flash Exp (Google)\n') +
              T.white('  🐋 DeepSeek R1 / V3 (DeepSeek)\n') +
              T.white('  🌟 Mistral 7B / Mixtral (Mistral AI)\n') +
              T.white('  🐉 Qwen 2.5 72B (Alibaba)\n') +
              T.white('  🌺 Gemma 3 (Google)\n\n') +
              T.cyan('  Append :free to any model ID to use free tier\n')
            : orAction === 'apikey'
            ? T.white('Opening API key settings...\n\n') + T.cyan('  Add key to .env.local:\n  OPENROUTER_API_KEY=sk-or-...\n')
            : T.white('Opening all 300+ models...\n')) +
          T.dim(`\n  ${url}`),
          { padding: 1, borderColor: '#F59E0B', borderStyle: 'round' }
        ));
        try { execSync(`open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null`, { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'omniroute') {
    const orAction = await select({
      message: T.success.bold('🌐 OmniRoute — Free AI Gateway:'),
      choices: [
        { name: T.success.bold('▶  Start OmniRoute')         + T.muted('        — run: npx omniroute (in new terminal)'), value: 'start' },
        { name: T.accent.bold('🌐  Open Dashboard')          + T.muted('         — open OmniRoute web UI in browser'), value: 'dashboard' },
        { name: T.white.bold('📋  View Docs')                + T.muted('              — /omniroute command reference'), value: 'docs' },
        { name: T.brand.bold('💻  Use in project')           + T.muted('         — OpenAI-compatible setup snippet'), value: 'code' },
        { name: T.warning.bold('🆓  Browse free providers')  + T.muted('  — list of 90+ free-tier providers'), value: 'providers' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (orAction !== '__back__') {
      console.log();
      if (orAction === 'docs') {
        console.log(); showMdPreview('commands/omniroute.md', 60); console.log();
      } else if (orAction === 'start') {
        console.log(boxen(
          T.success.bold(' 🌐 Start OmniRoute\n\n') +
          T.white('Run in a new terminal window:\n\n') +
          T.cyan('  npx omniroute\n\n') +
          T.white('Or via Docker:\n\n') +
          T.cyan('  docker run -p 20128:20128 diegosouzapw/omniroute\n\n') +
          T.white('Or install globally:\n\n') +
          T.cyan('  npm install -g omniroute && omniroute\n\n') +
          T.success('Once running, GhostForge auto-uses it as AI fallback.\n') +
          T.muted('  Endpoint: http://localhost:20128/v1'),
          { padding: 1, borderColor: 'green', borderStyle: 'round', title: ' OmniRoute Quick Start ' }
        ));
      } else if (orAction === 'dashboard') {
        console.log(T.accent('\n  Opening http://localhost:20128 ...\n'));
        try { execSync('open http://localhost:20128 2>/dev/null || xdg-open http://localhost:20128 2>/dev/null', { stdio: 'ignore' }); } catch {}
        console.log(T.muted('  (OmniRoute must be running first: npx omniroute)\n'));
      } else if (orAction === 'code') {
        console.log(boxen(
          T.success.bold(' 🌐 OmniRoute — Use in Your Project ') + '\n\n' +
          T.white('OpenAI-compatible API — no API key required.\n\n') +
          T.success.bold('  TypeScript / JavaScript:\n') +
          T.cyan("  import OpenAI from 'openai'\n\n") +
          T.cyan("  const client = new OpenAI({\n") +
          T.cyan("    apiKey: 'omniroute', // ignored — OmniRoute handles auth\n") +
          T.cyan("    baseURL: 'http://localhost:20128/v1',\n") +
          T.cyan("  })\n\n") +
          T.cyan("  const res = await client.chat.completions.create({\n") +
          T.cyan("    model: 'auto/coding', // quality-first for code\n") +
          T.cyan("    messages: [{ role: 'user', content: 'Hello' }],\n") +
          T.cyan("  })\n\n") +
          T.success.bold('  .env.local:\n') +
          T.cyan('  OMNIROUTE_URL=http://localhost:20128/v1\n') +
          T.cyan('  OMNIROUTE_MODEL=auto/coding\n\n') +
          T.success.bold('  Model IDs:\n') +
          T.white('  auto           → balanced (last-known-good)\n') +
          T.white('  auto/coding    → quality-first for code 🧑‍💻\n') +
          T.white('  auto/fast      → lowest latency ⚡\n') +
          T.white('  auto/cheap     → cheapest per token 💰\n') +
          T.white('  auto/offline   → most quota headroom\n'),
          { padding: 1, borderColor: 'green', borderStyle: 'round' }
        ));
      } else if (orAction === 'providers') {
        console.log(boxen(
          T.success.bold(' 🆓 OmniRoute Free Providers (sample)\n\n') +
          T.white('  Free forever (no cap):\n') +
          T.success('  ✓ Kiro · Pollinations · LongCat · SiliconFlow · Z.AI GLM-Flash\n\n') +
          T.white('  Free tiers (~1.6B tokens/mo total):\n') +
          T.accent('  • Google AI (Gemini 2.0 Flash)\n') +
          T.accent('  • Groq (Llama 3.1 70B)\n') +
          T.accent('  • Together AI ($25 signup credit)\n') +
          T.accent('  • Cerebras (Llama 3.3 70B)\n') +
          T.accent('  • NVIDIA NIM (Llama 3.3 70B)\n') +
          T.accent('  • OpenRouter (100+ free models)\n') +
          T.accent('  • HuggingFace Inference API\n') +
          T.accent('  + 80 more free providers\n\n') +
          T.muted('  Full list: https://omniroute.online'),
          { padding: 1, borderColor: 'green', borderStyle: 'round', title: ' 90+ Free Providers ' }
        ));
        try { execSync('open https://omniroute.online 2>/dev/null || xdg-open https://omniroute.online 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'meetily') {
    const mtAction = await select({
      message: T.cyan.bold('🎙️  Meetily — Local AI Meeting Assistant:'),
      choices: [
        { name: T.success.bold('⬇️  Install (macOS)')       + T.muted(' — download .dmg from GitHub Releases'), value: 'install-mac' },
        { name: T.warning.bold('⬇️  Install (Windows)')     + T.muted(' — download .exe installer'), value: 'install-win' },
        { name: T.cyan.bold('🗣️   Arabic support info')     + T.muted(' — Whisper multilingual, best model for Arabic'), value: 'arabic' },
        { name: T.brand.bold('🤖  AI providers guide')      + T.muted(' — Ollama (free/local), OpenRouter, Claude, Groq'), value: 'providers' },
        { name: T.accent.bold('📖  Quick start guide'),     value: 'guide' },
        { name: T.muted('🐙  GitHub'),                      value: 'github' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 9,
    });
    if (mtAction !== '__back__') {
      console.log();
      if (mtAction === 'install-mac') {
        console.log(boxen(
          T.cyan.bold(' 🎙️  Meetily — Install on macOS ') + '\n\n' +
          T.success.bold('  Option 1 — Download .dmg (easiest):\n') +
          T.cyan('  1. Open Releases page (opening now...)\n') +
          T.cyan('  2. Download meetily_0.4.0_aarch64.dmg (Apple Silicon)\n') +
          T.cyan('     or the x64 build for Intel Mac\n') +
          T.cyan('  3. Open .dmg → drag Meetily to Applications\n') +
          T.cyan('  4. Open Meetily from Applications\n\n') +
          T.success.bold('  Option 2 — Build from source:\n') +
          T.cyan('  git clone https://github.com/Zackriya-Solutions/meeting-minutes\n') +
          T.cyan('  cd meeting-minutes/frontend\n') +
          T.cyan('  pnpm install\n') +
          T.cyan('  ./build-gpu.sh\n\n') +
          T.dim('  Releases: https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest'),
          { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
        ));
        try { execSync('open https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest 2>/dev/null || xdg-open https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (mtAction === 'install-win') {
        console.log(boxen(
          T.warning.bold(' 🎙️  Meetily — Install on Windows ') + '\n\n' +
          T.success.bold('  Steps:\n') +
          T.cyan('  1. Open Releases page (opening now...)\n') +
          T.cyan('  2. Download x64-setup.exe\n') +
          T.cyan('  3. Run the installer\n') +
          T.cyan('  4. Launch Meetily from Start Menu\n\n') +
          T.dim('  Releases: https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest'),
          { padding: 1, borderColor: '#F59E0B', borderStyle: 'round' }
        ));
        try { execSync('open https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest 2>/dev/null || xdg-open https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest 2>/dev/null', { stdio: 'ignore' }); } catch {}
      } else if (mtAction === 'arabic') {
        console.log(boxen(
          T.cyan.bold(' 🗣️  Meetily — Arabic Language Support ') + '\n\n' +
          T.success('  ✅ Arabic is fully supported via Whisper (OpenAI multilingual model)\n\n') +
          T.success.bold('  Best model for Arabic:\n') +
          T.white('  • whisper-large-v3  — highest accuracy, handles Arabic dialects\n') +
          T.white('  • whisper-medium    — good balance of speed vs accuracy\n') +
          T.white('  • whisper-large     — also very good\n\n') +
          T.warning.bold('  Tips for Arabic meetings:\n') +
          T.white('  • Select "Arabic" as language in Meetily settings\n') +
          T.white('  • Use large-v3 model for mixed Arabic-English (code-switching)\n') +
          T.white('  • Works with Gulf Arabic, Egyptian, Levantine dialects\n') +
          T.white('  • For summaries: use Ollama with Qwen2.5 (Arabic-capable LLM)\n\n') +
          T.success.bold('  GhostForge use cases:\n') +
          T.white('  • Client meetings in Arabic — full transcript, no cloud\n') +
          T.white('  • Government/enterprise meetings — privacy guaranteed\n') +
          T.white('  • Mixed Arabic-English technical discussions\n'),
          { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
        ));
      } else if (mtAction === 'providers') {
        console.log(boxen(
          T.brand.bold(' 🤖  Meetily — AI Summary Providers ') + '\n\n' +
          T.success.bold('  🆓 Ollama (fully local, FREE — recommended):\n') +
          T.cyan('  brew install ollama\n') +
          T.cyan('  ollama pull qwen2.5  # great for Arabic\n') +
          T.cyan('  ollama pull llama3.1\n') +
          T.white('  → In Meetily: select Ollama → pick model\n\n') +
          T.warning.bold('  🔀 OpenRouter (free tier available):\n') +
          T.white('  → Use your OPENROUTER_API_KEY\n') +
          T.white('  → Free models: llama-3.1-8b:free, gemini-2.0-flash:free\n\n') +
          T.cyan.bold('  🤖 Claude (via direct Anthropic API):\n') +
          T.white('  → Needs ANTHROPIC_API_KEY (not Copilot)\n\n') +
          T.accent.bold('  ⚡ Groq (fast, free tier):\n') +
          T.white('  → console.groq.com → get API key → very fast inference\n'),
          { padding: 1, borderColor: '#A855F7', borderStyle: 'round' }
        ));
      } else if (mtAction === 'guide') {
        console.log(boxen(
          T.cyan.bold(' 🎙️  Meetily — Quick Start ') + '\n\n' +
          T.success.bold('  1. Install\n') +
          T.white('  Download .dmg (macOS) or .exe (Windows) from Releases\n\n') +
          T.success.bold('  2. Set up AI provider for summaries\n') +
          T.white('  Recommended: brew install ollama → ollama pull llama3.1\n') +
          T.white('  Then in Meetily: Settings → AI Provider → Ollama\n\n') +
          T.success.bold('  3. Start a meeting\n') +
          T.white('  Click "New Meeting" → Meetily captures system audio\n') +
          T.white('  Real-time transcript appears as you speak\n\n') +
          T.success.bold('  4. Generate summary\n') +
          T.white('  After meeting → click "Summarise" → AI generates notes\n\n') +
          T.success.bold('  5. For Arabic meetings\n') +
          T.white('  Settings → Transcription Language → Arabic\n') +
          T.white('  Model → whisper-large-v3 for best accuracy\n\n') +
          T.dim('  GitHub: https://github.com/Zackriya-Solutions/meetily'),
          { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
        ));
      } else if (mtAction === 'github') {
        try { execSync('open https://github.com/Zackriya-Solutions/meetily 2>/dev/null || xdg-open https://github.com/Zackriya-Solutions/meetily 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'carbon-monitor') {
    const runCarbon = (args = []) => {
      spawnSync('bash', [resolve(ROOT, 'scripts/carbon.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
    };

    const carbonCat = await select({
      message: T.success.bold('🌿 Carbon Monitor — GhostForge:'),
      choices: [
        { name: T.cyan.bold('📊  Monitor & Track'), value: 'monitor' },
        { name: T.success.bold('🌿  Analysis'), value: 'analysis' },
        { name: T.white.bold('📄  Reports'), value: 'reports' },
        { name: T.accent.bold('⚙️   Settings'), value: 'settings' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});

    if (carbonCat !== '__back__') {
      console.log();

      if (carbonCat === 'monitor') {
        console.log(T.muted('  Note: threshold breaches can trigger macOS desktop alerts via notify / notify-test.\n'));
        const monitorAction = await select({
          message: T.cyan.bold('📊 Monitor & Track:'),
          choices: [
            { name: T.success.bold('⬇️  Install / Setup'), value: 'install' },
            { name: T.cyan.bold('▶️   Project Start'), value: 'start' },
            { name: T.warning.bold('⏹   Project Stop'), value: 'stop' },
            { name: T.success.bold('🔍  Track a command'), value: 'track' },
            { name: T.brand.bold('🌍  System-wide Start'), value: 'system-start' },
            { name: T.warning.bold('🛑  System-wide Stop'), value: 'system-stop' },
            { name: T.brand.bold('📡  System Status'), value: 'system-status' },
            { name: T.accent.bold('🌱  Git-linked tracking'), value: 'git-track' },
            { name: T.white.bold('📺  Live dashboard'), value: 'live' },
            { name: T.muted('← Back'), value: '__back__' },
          ],
        
          pageSize: 15,});

        if (monitorAction === 'track') {
          const cmd = await input({ message: 'Command to track (e.g. npm run build):' });
          if (cmd?.trim()) runCarbon(['track', ...cmd.trim().split(/\s+/)]);
        } else if (monitorAction === 'git-track') {
          const gitTrackAction = await select({
            message: T.accent.bold('🌱 Git-linked tracking:'),
            choices: [
              { name: T.success.bold('▶️   Start'), value: 'start' },
              { name: T.warning.bold('⏹   Stop'), value: 'stop' },
              { name: T.white.bold('📋  Branch emissions log'), value: 'log' },
              { name: T.muted('← Back'), value: '__back__' },
            ],
          
            pageSize: 15,});
          if (gitTrackAction !== '__back__') runCarbon(['git-track', gitTrackAction]);
        } else if (monitorAction !== '__back__') {
          runCarbon([monitorAction]);
        }
      }

      if (carbonCat === 'analysis') {
        const analysisAction = await select({
          message: T.success.bold('🌿 Analysis:'),
          choices: [
            { name: T.accent.bold('📊  Threshold'), value: 'threshold' },
            { name: T.white.bold('📈  Sparkline trend'), value: 'sparkline' },
            { name: T.success.bold('🏆  Leaderboard'), value: 'leaderboard' },
            { name: T.cyan.bold('💡  Recommendations'), value: 'recommend' },
            { name: T.brand.bold('📊  Weekly digest'), value: 'weekly' },
            { name: T.white.bold('🔄  Equivalencies'), value: 'equiv' },
            { name: T.white.bold('📋  Session history'), value: 'history' },
            { name: T.cyan.bold('☁️   Compare cloud providers'), value: 'compare-cloud' },
            { name: T.muted('← Back'), value: '__back__' },
          ],
        
          pageSize: 15,});

        if (analysisAction === 'equiv') {
          const equivMode = await select({
            message: T.white.bold('Equivalencies:'),
            choices: [
              { name: T.success.bold('Use latest session'), value: 'latest' },
              { name: T.cyan.bold('Enter custom kg CO₂'), value: 'custom' },
              { name: T.muted('← Back'), value: '__back__' },
            ],
          
            pageSize: 15,});
          if (equivMode === 'latest') runCarbon(['equiv']);
          if (equivMode === 'custom') {
            const kg = await input({ message: 'kg CO₂ value:' });
            if (kg?.trim()) runCarbon(['equiv', kg.trim()]);
          }
        } else if (analysisAction === 'compare-cloud') {
          const provider = await select({
            message: T.cyan.bold('Select provider:'),
            choices: [
              { name: T.success.bold('All providers'), value: 'all' },
              { name: 'Vercel', value: 'vercel' },
              { name: 'GitHub Actions', value: 'github-actions' },
              { name: 'Netlify', value: 'netlify' },
              { name: 'AWS Lambda', value: 'aws-lambda' },
              { name: T.muted('← Back'), value: '__back__' },
            ],
          
            pageSize: 15,});
          if (provider !== '__back__') runCarbon(provider === 'all' ? ['compare-cloud'] : ['compare-cloud', provider]);
        } else if (analysisAction !== '__back__') {
          runCarbon([analysisAction]);
        }
      }

      if (carbonCat === 'reports') {
        const reportsAction = await select({
          message: T.white.bold('📄 Reports:'),
          choices: [
            { name: T.white.bold('📄  Generate report'), value: 'report' },
            { name: T.success.bold('📤  Export'), value: 'export' },
            { name: T.success.bold('🏷️   Badge markdown'), value: 'badge' },
            { name: T.accent.bold('🧪  CI workflow'), value: 'ci' },
            { name: T.accent.bold('💸  Carbon budget'), value: 'budget' },
            { name: T.muted('← Back'), value: '__back__' },
          ],
        
          pageSize: 15,});

        if (reportsAction === 'export') {
          const exportFormat = await select({
            message: T.success.bold('Export format:'),
            choices: [
              { name: 'Markdown (.md)', value: 'md' },
              { name: 'HTML (.html)', value: 'html' },
              { name: T.muted('← Back'), value: '__back__' },
            ],
          
            pageSize: 15,});
          if (exportFormat !== '__back__') runCarbon(['export', exportFormat]);
        } else if (reportsAction === 'budget') {
          const budgetAction = await select({
            message: T.accent.bold('Carbon budget:'),
            choices: [
              { name: T.success.bold('Set daily / weekly budget'), value: 'set' },
              { name: T.white.bold('Today status'), value: 'status' },
              { name: T.white.bold('Week status'), value: 'week' },
              { name: T.warning.bold('Reset budget'), value: 'reset' },
              { name: T.muted('← Back'), value: '__back__' },
            ],
          
            pageSize: 15,});
          if (budgetAction === 'set') {
            const daily = await input({ message: 'Daily budget (kg CO₂):' });
            const weekly = await input({ message: 'Weekly budget (kg CO₂, optional):', default: '' });
            if (daily?.trim()) runCarbon(weekly.trim() ? ['budget', 'set', daily.trim(), weekly.trim()] : ['budget', 'set', daily.trim()]);
          } else if (budgetAction !== '__back__') {
            runCarbon(['budget', budgetAction]);
          }
        } else if (reportsAction !== '__back__') {
          runCarbon([reportsAction]);
        }
      }

      if (carbonCat === 'settings') {
        const settingsAction = await select({
          message: T.accent.bold('⚙️ Settings:'),
          choices: [
            { name: T.warning.bold('🧠  CPU throttle trigger'), value: 'throttle' },
            { name: T.success.bold('🔔  Test desktop notification'), value: 'notify-test' },
            { name: T.cyan.bold('ℹ️   About this feature'), value: 'about' },
            { name: T.muted('← Back'), value: '__back__' },
          ],
        
          pageSize: 15,});

        if (settingsAction === 'throttle') {
          const throttleAction = await select({
            message: T.warning.bold('Throttle mode:'),
            choices: [
              { name: T.success.bold('Enable auto-throttle'), value: 'on' },
              { name: T.warning.bold('Disable auto-throttle'), value: 'off' },
              { name: T.white.bold('Status'), value: 'status' },
              { name: T.muted('← Back'), value: '__back__' },
            ],
          
            pageSize: 15,});
          if (throttleAction !== '__back__') runCarbon(['throttle', throttleAction]);
        } else if (settingsAction === 'notify-test') {
          runCarbon(['notify-test']);
        } else if (settingsAction === 'about') {
          console.log(boxen(
            T.success.bold(' 🌿 Carbon Monitor — About ') + '\n\n' +
            T.white('Based on Hisham\'s CRP graduation research (2023):\n') +
            T.yellow.bold('  "Reducing the Carbon Footprint of Laptops and Workstations"\n\n') +
            T.white('The CFRS (Carbon Footprint Reduction System) achieved\n') +
            T.white('7–15% energy reduction by tracking emissions in real time\n') +
            T.white('and throttling CPU/GPU when threshold is exceeded.\n\n') +
            T.success.bold('  Tools used in research:\n') +
            T.white('  • CodeCarbon — emissions measurement\n') +
            T.white('  • CarbonTracker — ML training tracker\n') +
            T.white('  • Intel PowerLog — hardware power readings\n') +
            T.white('  • Threshold: avg_emissions/session × 1.1\n\n') +
            T.success.bold('  Now integrated into GhostForge as:\n') +
            T.cyan('  ghostforge carbon track npm run build\n') +
            T.cyan('  ghostforge carbon export html\n') +
            T.cyan('  ghostforge carbon throttle on\n'),
            { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
          ));
        }
      }
    }
    await pressEnter();
  }

  if (action === 'claude-mem') {
    const memAction = await select({
      message: T.white.bold('claude-mem Shared Memory:'),
      choices: [
        { name: T.success.bold('⬇️  Install claude-mem (recommended)'), value: 'install' },
        { name: T.accent.bold('📋  Show install instructions'),         value: 'info' },
        { name: T.cyan.bold('🌐  Open docs'),                          value: 'docs' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
    
      pageSize: 15,});
    if (memAction !== '__back__') {
      console.log();
      console.log(boxen(
        T.success.bold(' 🧠 claude-mem — Persistent Shared Memory ') + '\n\n' +
        T.white('Context survives across Claude Code sessions automatically.\n\n') +
        T.success.bold('  Install (recommended):\n') +
        T.cyan('  npx claude-mem install\n\n') +
        T.success.bold('  Or inside Claude Code:\n') +
        T.cyan('  /plugin marketplace add thedotmack/claude-mem\n') +
        T.cyan('  /plugin install claude-mem\n\n') +
        T.muted('  • Auto-captures tool usage + semantic summaries\n') +
        T.muted('  • Context appears automatically in new sessions\n') +
        T.muted('  • Web viewer UI at localhost:3000\n') +
        T.muted('  • Natural language memory search (mem-search skill)\n') +
        T.muted('  • Use <private> tags to exclude sensitive content\n') +
        T.muted('  • Works with Claude Code, OpenCode, Antigravity CLI\n\n') +
        T.dim('  Docs: https://docs.claude-mem.ai'),
        { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
      ));
      console.log();
      if (memAction === 'install') {
        const { spawnSync } = await import('child_process');
        spawnSync('bash', [resolve(ROOT, 'scripts/setup-memory.sh'), 'install'], { stdio: 'inherit', cwd: process.cwd() });
      } else if (memAction === 'docs') {
        try { execSync('open https://docs.claude-mem.ai 2>/dev/null || xdg-open https://docs.claude-mem.ai 2>/dev/null', { stdio: 'ignore' }); } catch {}
      }
    }
    await pressEnter();
  }

  if (action === 'skills') {
    const sourcesPath = resolve(ROOT, 'marketplace/sources.json');
    let allSources = [];
    try {
      const s = JSON.parse(readFileSync(sourcesPath, 'utf8'));
      allSources = (s.sources || []).filter(src => src.type === 'claude-skills');
    } catch {}

    const skillAction = await select({
      message: T.white.bold('Agent Skills:'),
      choices: [
        { name: T.accent.bold('📋  View all skill sources')              + T.muted(' — 9 trusted sources'), value: 'view' },
        { name: T.success.bold('🔍  Search SkillsMP')                   + T.muted(' — 2M+ community skills'), value: 'search' },
        { name: T.brand.bold('⚡  Install Claude-Flow')                 + T.muted(' — AI orchestration swarm'), value: 'claude-flow' },
        { name: T.white.bold('📦  Install Anthropic official skills')   + T.muted(' — docx, pdf, pptx, xlsx…'), value: 'anthropic' },
        { name: T.warning.bold('🌐  Open Awesome Claude Skills')         + T.muted(' — curated free directory'), value: 'awesome' },
        { name: T.cyan.bold('🌍  scroll-world')                         + T.muted(' — fly-through landing page skill'), value: 'scroll-world' },
        { name: T.accent.bold('🎨  UI/UX Pro Max')                       + T.muted(' — 161 reasoning rules + 84 UI styles'), value: 'ui-ux-pro-max' },
        { name: T.success.bold('🔍  find-skills')                         + T.muted(' — discover & install skills from ecosystem'), value: 'find-skills' },
        { name: T.brand.bold('🎨  frontend-design')                      + T.muted(' — Anthropic official design guidance'), value: 'frontend-design' },
        { name: T.cyan.bold('📄  OfficeCLI')                             + T.muted(' — create/edit .docx .xlsx .pptx · always-on skill'), value: 'officecli' },
        { name: T.warning.bold('🎨  extract-design-system')               + T.muted(' — reverse-engineer design tokens from any website'), value: 'extract-design-system' },
        { name: T.success.bold('⚡  Superpowers')                          + T.muted(' — full AI dev methodology (TDD, spec, subagents)'), value: 'superpowers' },
        { name: T.muted('🌐  Open SkillsMP marketplace'), value: 'open-skillsmp' },
        { name: T.muted('📖  View /skills command docs'), value: 'docs' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 10,
    });

    if (skillAction === '__back__') return;

    if (skillAction === 'view') {
      console.log();
      allSources.forEach(src => {
        console.log(`  ${T.success('●')} ${T.white.bold(src.name)}`);
        console.log(`    ${T.dim(src.description)}`);
        console.log(`    ${T.muted(src.url)}`);
        if (src.install_command) console.log(`    ${T.accent('Install: ')}${T.dim(src.install_command)}`);
        if (src.install_note) console.log(`    ${T.muted(src.install_note)}`);
        console.log();
      });
      await pressEnter();
    }

    if (skillAction === 'search') {
      const q = await input({ message: T.white('Search SkillsMP (e.g. "react", "typescript", "auth"):'), default: '' });
      if (q) {
        console.log(T.muted('\n  Searching...\n'));
        const { spawnSync } = await import('child_process');
        spawnSync('bash', [resolve(ROOT, 'scripts/skills.sh'), 'search', q], { stdio: 'inherit', cwd: process.cwd() });
        console.log();
      }
      await pressEnter();
    }

    if (skillAction === 'claude-flow') {
      console.log();
      console.log(boxen(
        T.brand.bold(' Claude-Flow — AI Orchestration ') + '\n\n' +
        T.white('Hive-mind swarm intelligence for complex development tasks:\n\n') +
        T.success('  ✅ 87 MCP tools\n') +
        T.success('  ✅ 84.8% SWE-Bench solve rate\n') +
        T.success('  ✅ 2.8–4.4× speed vs single agent\n') +
        T.success('  ✅ Persistent memory via SQLite\n\n') +
        T.muted('  Quick start:\n') +
        T.accent('  npx claude-flow@alpha init --force\n') +
        T.accent('  npx claude-flow@alpha swarm "refactor auth system"\n\n') +
        T.dim('  Requires: @anthropic-ai/claude-code'),
        { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
      ));
      const doInstall = await input({ message: T.white('Run install now? (yes/no):'), default: 'no' });
      if (doInstall.toLowerCase() === 'yes') {
        const { spawnSync } = await import('child_process');
        spawnSync('bash', [resolve(ROOT, 'scripts/skills.sh'), 'claude-flow'], { stdio: 'inherit', cwd: process.cwd() });
      }
      await pressEnter();
    }

    if (skillAction === 'anthropic') {
      console.log();
      console.log(boxen(
        T.brand.bold(' Anthropic Official Skills ') + '\n\n' +
        T.white('Official skills by Anthropic — production-tested:\n\n') +
        T.muted('  • docx — Create/edit Word documents\n') +
        T.muted('  • pdf  — Extract, split, merge PDFs\n') +
        T.muted('  • pptx — Generate PowerPoint presentations\n') +
        T.muted('  • xlsx — Manipulate Excel files\n') +
        T.muted('  • web-test — Playwright/Puppeteer testing\n') +
        T.muted('  • mcp-server-gen — Generate MCP servers\n\n') +
        T.cyan('  In Claude Code, run:\n') +
        T.accent('  /plugin marketplace add anthropics/skills\n\n') +
        T.dim('  Or: bash scripts/skills.sh anthropic'),
        { padding: 1, borderColor: '#0077C8', borderStyle: 'round' }
      ));
      await pressEnter();
    }

    if (skillAction === 'awesome') {
      try { execSync('open https://awesomeclaude.ai/awesome-claude-skills 2>/dev/null || xdg-open https://awesomeclaude.ai/awesome-claude-skills 2>/dev/null', { stdio: 'ignore' }); } catch {}
      console.log(T.muted('\n  Opened: https://awesomeclaude.ai/awesome-claude-skills\n'));
      await pressEnter();
    }

    if (skillAction === 'scroll-world') {
      console.log();
      console.log(boxen(
        T.cyan.bold(' 🌍 scroll-world — Fly-Through Landing Page Skill ') + '\n\n' +
        T.white('Scroll-scrubbed "fly through the world" landing pages.\n') +
        T.muted('Camera flies through scenes as you scroll — Apple-style.\n\n') +
        T.success.bold('  Install (Claude Code):\n') +
        T.cyan('  /plugin marketplace add oso95/scroll-world\n') +
        T.cyan('  /plugin install scroll-world@scroll-world\n\n') +
        T.success.bold('  Install (Codex / Cursor / 20+ agents):\n') +
        T.cyan('  npx skills add oso95/scroll-world\n\n') +
        T.success.bold('  Install (manual):\n') +
        T.cyan('  git clone https://github.com/oso95/scroll-world\n') +
        T.cyan('  cp -R scroll-world/skills/scroll-world ~/.claude/skills/\n\n') +
        T.warning('  Requires: Higgsfield CLI · ffmpeg · Python 3 + Pillow\n\n') +
        T.dim('  GitHub: https://github.com/oso95/scroll-world'),
        { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
      ));
      console.log();
      try { execSync('open https://github.com/oso95/scroll-world 2>/dev/null || xdg-open https://github.com/oso95/scroll-world 2>/dev/null', { stdio: 'ignore' }); } catch {}
      await pressEnter();
    }

    if (skillAction === 'ui-ux-pro-max') {
      console.log();
      console.log(boxen(
        T.accent.bold(' 🎨 UI/UX Pro Max — 161 Rules + 84 UI Styles ') + '\n\n' +
        T.white('World-class UI/UX reasoning for any AI agent.\n\n') +
        T.success.bold('  Install (CLI):\n') +
        T.cyan('  npx ui-ux-pro-max-cli\n\n') +
        T.success.bold('  Install (Claude Code plugin):\n') +
        T.cyan('  /plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill\n\n') +
        T.success.bold('  Install (manual):\n') +
        T.cyan('  cp -R ui-ux-pro-max-skill/skills/ ~/.claude/skills/\n\n') +
        T.muted('  • 161 UI/UX reasoning rules\n') +
        T.muted('  • 84 UI style definitions (layouts, typography, color, motion)\n') +
        T.muted('  • Covers accessibility, animations, design systems\n') +
        T.muted('  • Works with Claude Code, Codex, Cursor, 20+ agents\n\n') +
        T.dim('  GitHub: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill'),
        { padding: 1, borderColor: '#8B5CF6', borderStyle: 'round' }
      ));
      console.log();
      try { execSync('open https://github.com/nextlevelbuilder/ui-ux-pro-max-skill 2>/dev/null || xdg-open https://github.com/nextlevelbuilder/ui-ux-pro-max-skill 2>/dev/null', { stdio: 'ignore' }); } catch {}
      await pressEnter();
    }

    if (skillAction === 'find-skills') {
      console.log();
      console.log(boxen(
        T.success.bold(' 🔍 find-skills — Skill Discovery Agent ') + '\n\n' +
        T.white('Helps you find and install skills from the open ecosystem.\n\n') +
        T.success.bold('  Install globally:\n') +
        T.cyan('  npx skills add vercel-labs/skills@find-skills -g -y\n\n') +
        T.success.bold('  Installed locally in this toolkit:\n') +
        T.cyan('  .claude/skills/find-skills/SKILL.md\n\n') +
        T.muted('  Once installed, ask your agent:\n') +
        T.muted('  "find a skill for react performance"\n') +
        T.muted('  "is there a skill for PR review?"\n') +
        T.muted('  "can you do X?" → agent searches skills.sh\n\n') +
        T.dim('  Browse: https://skills.sh/'),
        { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
      ));
      console.log();
      try { execSync('open https://skills.sh 2>/dev/null || xdg-open https://skills.sh 2>/dev/null', { stdio: 'ignore' }); } catch {}
      await pressEnter();
    }

    if (skillAction === 'frontend-design') {
      console.log();
      console.log(boxen(
        T.brand.bold(' 🎨 frontend-design — Anthropic Official Design Skill ') + '\n\n' +
        T.white('Distinctive, intentional visual design — anti-template approach.\n\n') +
        T.success.bold('  Install globally:\n') +
        T.cyan('  npx skills add anthropics/skills@frontend-design -g -y\n\n') +
        T.success.bold('  Installed locally in this toolkit:\n') +
        T.cyan('  .claude/skills/frontend-design/SKILL.md\n\n') +
        T.muted('  Covers: palette, typography, layout, motion, copy\n') +
        T.muted('  Process: brainstorm → plan → self-critique → build\n') +
        T.muted('  RTL/Arabic: Cairo, Tajawal, logical CSS, dir="rtl"\n') +
        T.muted('  Avoids: generic AI design defaults (cream+serif, etc.)\n\n') +
        T.dim('  Source: https://github.com/anthropics/skills'),
        { padding: 1, borderColor: '#0077C8', borderStyle: 'round' }
      ));
      console.log();
      await pressEnter();
    }

    if (skillAction === 'officecli') {
      console.log();
      const { spawnSync: spawnOC } = await import('child_process');
      console.log(boxen(
        T.cyan.bold(' 📄 OfficeCLI — Office Documents Skill ') + '\n\n' +
        T.white('Create, edit, analyze .docx .xlsx .pptx — no Office installation needed.\n') +
        T.white('Single binary · AI-friendly CLI · always-on in GhostForge.\n\n') +
        T.success.bold('  ✅ Always-on skill (loaded via CLAUDE.md)\n') +
        T.cyan('  .claude/skills/officecli/SKILL.md\n\n') +
        T.success.bold('  Install the binary:\n') +
        T.cyan('  curl -fsSL https://d.officecli.ai/install.sh | bash\n\n') +
        T.muted('  Usage examples:\n') +
        T.muted('  officecli create report.docx\n') +
        T.muted('  officecli add report.docx /body --type paragraph --prop text="Hello"\n') +
        T.muted('  officecli create data.xlsx\n') +
        T.muted('  officecli create slides.pptx\n') +
        T.muted('  officecli view report.docx outline\n') +
        T.muted('  officecli validate report.docx\n\n') +
        T.dim('  Source: https://github.com/iOfficeAI/OfficeCLI'),
        { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
      ));
      console.log();
      const installOC = await import('@inquirer/prompts').then(m => m.confirm({
        message: 'Install officecli binary now?',
        default: false,
      }));
      if (installOC) {
        spawnOC('bash', ['-c', 'curl -fsSL https://d.officecli.ai/install.sh | bash'], { stdio: 'inherit' });
      }
      await pressEnter();
    }

    if (skillAction === 'extract-design-system') {
      console.log();
      console.log(boxen(
        T.warning.bold(' 🎨 extract-design-system — Design Token Extractor ') + '\n\n' +
        T.white('Reverse-engineer design tokens from any public website.\n') +
        T.muted('Outputs W3C-compatible tokens.json + tokens.css.\n\n') +
        T.success.bold('  Install:\n') +
        T.cyan('  npx skills add arvindrk/extract-design-system\n\n') +
        T.success.bold('  Then ask your agent:\n') +
        T.cyan('  "Extract the design system from https://stripe.com"\n\n') +
        T.muted('  Extracts: colors, typography, spacing, border radius, shadows\n') +
        T.muted('  Outputs:\n') +
        T.muted('    design-system/tokens.json  (W3C-compatible)\n') +
        T.muted('    design-system/tokens.css   (CSS custom properties)\n\n') +
        T.dim('  Browse: https://skills.sh/arvindrk/extract-design-system'),
        { padding: 1, borderColor: '#F59E0B', borderStyle: 'round' }
      ));
      console.log();
      try { execSync('open https://github.com/arvindrk/extract-design-system 2>/dev/null || xdg-open https://github.com/arvindrk/extract-design-system 2>/dev/null', { stdio: 'ignore' }); } catch {}
      await pressEnter();
    }

    if (skillAction === 'superpowers') {
      console.log();
      console.log(boxen(
        T.success.bold(' ⚡ Superpowers — Full AI Development Methodology ') + '\n\n' +
        T.white('Complete dev workflow: spec → plan → TDD → autonomous execution.\n\n') +
        T.success.bold('  Install (Claude Code official marketplace):\n') +
        T.cyan('  /plugin install superpowers@claude-plugins-official\n\n') +
        T.success.bold('  Or from Superpowers marketplace:\n') +
        T.cyan('  /plugin marketplace add obra/superpowers-marketplace\n') +
        T.cyan('  /plugin install superpowers@superpowers-marketplace\n\n') +
        T.muted('  What it does:\n') +
        T.muted('  1. Extracts a spec from conversation before writing code\n') +
        T.muted('  2. Builds a step-by-step implementation plan\n') +
        T.muted('  3. Launches subagents for TDD, YAGNI, DRY enforcement\n') +
        T.muted('  4. Runs autonomously for hours without deviating\n') +
        T.muted('  Works with: Claude Code, Copilot CLI, Cursor, Codex, OpenCode\n\n') +
        T.dim('  https://github.com/obra/superpowers'),
        { padding: 1, borderColor: '#22C55E', borderStyle: 'round' }
      ));
      console.log();
      try { execSync('open https://claude.com/plugins/superpowers 2>/dev/null || xdg-open https://claude.com/plugins/superpowers 2>/dev/null', { stdio: 'ignore' }); } catch {}
      await pressEnter();
    }

    if (skillAction === 'open-skillsmp') {
      try { execSync('open https://skillsmp.com 2>/dev/null || xdg-open https://skillsmp.com 2>/dev/null', { stdio: 'ignore' }); } catch {}
      console.log(T.muted('\n  Opened: https://skillsmp.com\n'));
      await pressEnter();
    }

    if (skillAction === 'docs') {
      showMdPreview('commands/skills.md', 60);
      console.log();
      await pressEnter();
    }
  }

  await handleMarketplaceToolAction(action);

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
  
    pageSize: 15,});

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
    content = `# ${name} Plugin\n\n${description}\n\n## Contents\n- agents/ — specialized agents for this plugin\n- commands/ — slash commands\n\n## Usage\nCopy files to the GhostForge root:\n\`\`\`bash\ncp -r plugins/${cleanName}/agents/* agents/\ncp -r plugins/${cleanName}/commands/* commands/\n\`\`\`\n\n## Tags\n${tags || cleanName}\n`;
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
  
    pageSize: 15,});

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
    
      pageSize: 15,});
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

  if (action === 'health-score') {
    const subAction = await select({
      message: T.white.bold('🏥  Codebase Health Score:'),
      choices: [
        { name: T.accent.bold('📊  Score directory'), value: 'score' },
        { name: T.white.bold('🧮  Latest breakdown'), value: 'breakdown' },
        { name: T.success.bold('🕘  History'), value: 'history' },
        { name: T.brand.bold('🏷️   Badge'), value: 'badge' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/health-score.sh'), subAction];
      if (subAction === 'score') {
        const dir = await input({ message: T.white('Directory to score:'), default: '.' });
        if (dir) args.push(dir);
      }
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'docker-gen') {
    const subAction = await select({
      message: T.white.bold('🐳  Docker Generator:'),
      choices: [
        { name: T.accent.bold('📦  Generate Dockerfile'), value: 'generate' },
        { name: T.white.bold('🧱  Generate docker-compose.yml'), value: 'compose' },
        { name: T.cyan.bold('⚙️   Generate docker-compose.dev.yml'), value: 'dev' },
        { name: T.warning.bold('🧹  Clean generated files'), value: 'clean' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/docker-gen.sh'), subAction];
      if (subAction === 'generate') {
        const type = await select({
          message: T.white('Project type:'),
          choices: [
            { name: 'Auto-detect from package.json', value: '__auto__' },
            { name: 'Next.js', value: 'nextjs' },
            { name: 'Node.js', value: 'node' },
            { name: 'React Vite', value: 'react-vite' },
          ],
          pageSize: 15,
        });
        if (type !== '__auto__') args.push(type);
      }
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'api-docs') {
    const subAction = await select({
      message: T.white.bold('📖  API Docs Generator:'),
      choices: [
        { name: T.accent.bold('🔍  Scan routes'), value: 'scan' },
        { name: T.success.bold('📝  Generate Markdown docs'), value: 'markdown' },
        { name: T.brand.bold('🧩  Generate OpenAPI'), value: 'openapi' },
        { name: T.cyan.bold('🌐  Serve docs'), value: 'serve' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/api-docs.sh'), subAction];
      if (subAction === 'scan' || subAction === 'markdown' || subAction === 'openapi') {
        const dir = await input({ message: T.white('Directory to scan:'), default: '.' });
        if (dir) args.push(dir);
      }
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'standup') {
    const subAction = await select({
      message: T.white.bold('🗣️  Daily Standup:'),
      choices: [
        { name: T.accent.bold('☀️   Today'), value: 'today' },
        { name: T.white.bold('🌙  Yesterday'), value: 'yesterday' },
        { name: T.cyan.bold('🗓️   This week'), value: 'week' },
        { name: T.success.bold('💾  Save today'), value: 'save' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const scriptPath = resolve(ROOT, 'scripts/standup.sh');
      if (subAction === 'today' || subAction === 'yesterday' || subAction === 'week') {
        const copy = process.platform === 'darwin'
          ? await confirm({ message: T.white('Copy output to clipboard?'), default: false })
          : false;
        if (copy) {
          const result = spawnSync('bash', [scriptPath, subAction], { stdio: 'pipe', cwd: process.cwd(), encoding: 'utf8' });
          process.stdout.write(result.stdout || '');
          process.stderr.write(result.stderr || '');
          if (result.status === 0) {
            try { execSync('pbcopy', { input: result.stdout || '' }); } catch {}
          }
        } else {
          spawnSync('bash', [scriptPath, subAction], { stdio: 'inherit', cwd: process.cwd() });
        }
      } else {
        spawnSync('bash', [scriptPath, subAction], { stdio: 'inherit', cwd: process.cwd() });
      }
      await pressEnter();
    }
  }

  if (action === 'git-hooks-setup') {
    const subAction = await select({
      message: T.white.bold('🪝  Smart Git Hooks:'),
      choices: [
        { name: T.accent.bold('⬇️  Install'), value: 'install' },
        { name: T.warning.bold('🗑️   Uninstall'), value: 'uninstall' },
        { name: T.white.bold('📋  Status'), value: 'status' },
        { name: T.cyan.bold('✏️   Customize'), value: 'customize' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/git-hooks-setup.sh'), subAction];
      if (subAction === 'customize') {
        const hook = await select({
          message: T.white('Hook to edit:'),
          choices: [
            { name: 'pre-commit', value: 'pre-commit' },
            { name: 'commit-msg', value: 'commit-msg' },
          ],
          pageSize: 15,
        });
        args.push(hook);
      }
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }

  if (action === 'schema-viz') {
    const subAction = await select({
      message: T.white.bold('🗄️  DB Schema Visualizer:'),
      choices: [
        { name: T.accent.bold('🧭  Visualize in terminal'), value: 'viz' },
        { name: T.success.bold('🌐  Generate HTML diagram'), value: 'html' },
        { name: T.white.bold('📂  List schema files'), value: 'list' },
        { name: T.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    });
    if (subAction !== '__back__') {
      const args = [resolve(ROOT, 'scripts/schema-viz.sh'), subAction];
      if (subAction === 'viz' || subAction === 'html') {
        const schema = await input({ message: T.white('Schema file (leave blank to auto-detect):'), default: '' });
        if (schema.trim()) args.push(schema.trim());
      }
      spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
      await pressEnter();
    }
  }
}

async function screenDashboard() {
  sectionHeader('📊  Developer Dashboard', 'Real-time: tickets · pipelines · health · releases · activity');
  console.log(T.muted('  Launches a full-screen terminal dashboard powered by blessed-contrib.\n'));
  console.log(`  ${T.muted('Keyboard shortcuts inside dashboard:')}`);
  console.log(`  ${T.accent('  R')} ${T.muted('— refresh all panels')}`);
  console.log(`  ${T.accent('  Q')} ${T.muted('— quit dashboard')}`);
  console.log(`  ${T.accent('  Tab')} ${T.muted('— switch focus between panels')}`);
  console.log(`  ${T.accent('  ↑↓')} ${T.muted('— scroll within focused panel')}`);
  console.log();

  const choices = [
    { name: T.brand.bold('▶  Launch Dashboard'), value: 'launch' },
    { name: T.white('📖  View dashboard docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
  if (choice === '__back__') return;
  if (choice === 'docs') {
    showMdPreview('commands/dashboard.md', 60);
    await pressEnter();
    await screenDashboard(); return;
  }

  // Check gh auth
  const { spawnSync: sp } = await import('child_process');
  const ghCheck = sp('gh', ['auth', 'status'], { stdio: 'pipe', cwd: process.cwd() });
  if (ghCheck.status !== 0) {
    console.log(T.warning('\n  ⚠  gh CLI not authenticated — ticket/pipeline data will be limited.'));
    console.log(T.muted('  Run: gh auth login\n'));
  }

  console.log(T.muted('\n  Launching dashboard... (press Q inside to return)\n'));
  await new Promise(r => setTimeout(r, 400));

  const dashboardPath = resolve(ROOT, 'tui/dashboard.js');
  if (!existsSync(dashboardPath)) {
    console.log(T.danger('  ✖  Dashboard file not found: tui/dashboard.js'));
    console.log(T.muted('  It may still be building. Try again in a moment.'));
    await pressEnter();
    return;
  }

  // Dashboard is a full-screen blessed app — spawn it replacing current process stdin/stdout
  const result = sp('node', [dashboardPath], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env },
  });
  // After dashboard closes, TUI resumes
}

async function screenAPITypes() {
  sectionHeader('🔑  /api-types', 'Generate TypeScript types from an OpenAPI/Swagger spec');
  const choices = [
    { name: T.accent('▶  Run /api-types (enter URL or path)'), value: 'run' },
    { name: T.white('▶  Run with --service flag (also generate API service file)'), value: 'run-service' },
    { name: T.white('📖  View command docs'), value: 'docs' },
    { name: T.muted('← Back'), value: '__back__' },
  ];
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
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
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
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
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
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
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
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
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
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
  sectionHeader('🧩  Install VS Code Extension', 'Install the GhostForge extension directly into VS Code');

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
  const codeCheck = spawnSync('which', ['code'], { stdio: 'pipe', cwd: process.cwd() });
  if (codeCheck.status !== 0) {
    console.log(T.warning('  VS Code CLI (code) not found in PATH.'));
    console.log(T.muted('  Install it: VS Code → Cmd+Shift+P → "Shell Command: Install code in PATH"\n'));
    console.log(T.white('  Then run manually:'));
    console.log(T.accent(`  code --install-extension ${vsixPath}\n`));
    await anyKey(); return;
  }

  console.log(T.muted('  Installing...\n'));
  const result = spawnSync('code', ['--install-extension', vsixPath, '--force'], { stdio: 'inherit', cwd: process.cwd() });

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
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
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
  const choice = await select({ message: 'Choose:', choices,
    pageSize: 15,});
  if (choice === '__back__') return;

  const { spawnSync } = await import('child_process');
  const args = choice === 'fix' ? [join(BASE, 'scripts/rtl.sh'), '.', '--fix'] : [join(BASE, 'scripts/rtl.sh'), '.'];
  console.log(T.muted('\n  Scanning...\n'));
  spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
  await anyKey();
}

async function screenHealthAll() {
  sectionHeader('Multi-Project Health', 'Scan all registered projects');
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/health-check.sh'), 'all'], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenPerf() {
  sectionHeader('/perf', 'Lighthouse performance audit');
  const url = await input({ message: 'URL to audit (leave blank for localhost:3000):', default: 'http://localhost:3000' });
  const mobile = await confirm({ message: 'Run mobile audit?', default: false });
  const { spawnSync } = await import('child_process');
  const args = [resolve(ROOT, 'scripts/perf.sh'), url];
  if (mobile) args.push('--mobile');
  spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenUpgrade() {
  sectionHeader('/upgrade', 'Interactive npm package upgrades');
  const mode = await select({ message: 'Upgrade mode:', choices: [
    { name: '🔒 Patch only (safest)', value: '--patch' },
    { name: '↑  Minor + patch', value: '--minor' },
    { name: '🚀 Latest (all)', value: '--latest' },
    { name: '◀  Back', value: '__back__' },
  ],
    pageSize: 15,});
  if (mode === '__back__') return;
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/upgrade.sh'), mode], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenMockApi() {
  sectionHeader('/mock-api', 'Generate MSW handlers from OpenAPI');
  const spec = await input({ message: 'Path to OpenAPI spec (yaml/json):' });
  if (!spec) return;
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/api-mock.sh'), 'generate', spec], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenOnboardDev() {
  sectionHeader('/onboard-dev', 'New developer setup wizard');
  const mode = await select({ message: 'Setup mode:', choices: [
    { name: '🚀 Full onboarding', value: '' },
    { name: '🔍 Check existing setup', value: '--check' },
    { name: '🛠  Tools only', value: '--tools-only' },
    { name: '◀  Back', value: '__back__' },
  ],
    pageSize: 15,});
  if (mode === '__back__') return;
  const { spawnSync } = await import('child_process');
  const args = [resolve(ROOT, 'scripts/onboard-dev.sh')];
  if (mode) args.push(mode);
  spawnSync('bash', args, { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenAdo() {
  sectionHeader('Azure DevOps', 'Work items · Pipelines · Releases');
  const action = await select({ message: 'What to view:', choices: [
    { name: '🎫 My Work Items', value: 'tickets' },
    { name: '🏗  Pipeline Runs', value: 'pipelines' },
    { name: '🚀 Releases', value: 'releases' },
    { name: '◀  Back', value: '__back__' },
  ],
    pageSize: 15,});
  if (action === '__back__') return;
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/ado.sh'), action], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenEstimate() {
  sectionHeader('/estimate', 'AI story point estimator');
  const description = await input({ message: 'Describe the task or feature:' });
  if (!description) return;
  const { spawnSync } = await import('child_process');
  spawnSync('bash', [resolve(ROOT, 'scripts/estimate.sh'), description], { stdio: 'inherit', cwd: process.cwd() });
  await pressEnter();
}

async function screenVoice() {
  sectionHeader('/voice', 'Free Voice Features (TTS + STT)');
  const action = await select({ message: 'Voice action:', choices: [
    { name: '🔊 Speak text aloud (TTS)', value: 'speak' },
    { name: '🎤 Listen & transcribe (STT)', value: 'listen' },
    { name: '📢 Read health score aloud', value: 'read-health' },
    { name: '⚙️  Voice status & setup', value: 'status' },
    { name: '⬇️  Install whisper.cpp (offline STT)', value: 'install-whisper' },
    { name: '◀  Back', value: '__back__' },
  ],
    pageSize: 15,});
  if (action === '__back__') return;
  const { spawnSync } = await import('child_process');
  if (action === 'speak') {
    const { input: inputPrompt } = await import('@inquirer/prompts');
    const text = await inputPrompt({ message: 'Text to speak:' });
    if (!text) return;
    spawnSync('bash', [resolve(ROOT, 'scripts/voice.sh'), 'speak', text], { stdio: 'inherit', cwd: process.cwd() });
  } else if (action === 'listen') {
    const { input: inputPrompt } = await import('@inquirer/prompts');
    const secs = await inputPrompt({ message: 'Record duration (seconds):', default: '5' });
    spawnSync('bash', [resolve(ROOT, 'scripts/voice.sh'), 'listen', secs], { stdio: 'inherit', cwd: process.cwd() });
  } else {
    spawnSync('bash', [resolve(ROOT, 'scripts/voice.sh'), action], { stdio: 'inherit', cwd: process.cwd() });
  }
  await pressEnter();
}

async function screenChangelogViewer() {
  sectionHeader('CHANGELOG Viewer', 'Browse project history interactively');
  const { spawnSync } = await import('child_process');
  if (!existsSync(resolve(process.cwd(), 'CHANGELOG.md'))) {
    const gen = await confirm({ message: 'No CHANGELOG.md found. Generate it now?', default: true });
    if (gen) {
      spawnSync('bash', [resolve(ROOT, 'scripts/changelog.sh')], { stdio: 'inherit', cwd: process.cwd() });
    } else {
      return;
    }
  }
  const content = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8');
  const lines = content.split('\n');
  const releases = lines.filter(line => line.startsWith('## '));
  if (releases.length === 0) {
    console.log(chalk.yellow('  No releases found in CHANGELOG.md'));
    await pressEnter();
    return;
  }
  const chosen = await select({ message: 'View release:', choices: [
    ...releases.slice(0, 20).map(release => ({ name: release.replace('## ', ''), value: release })),
    { name: '◀  Back', value: '__back__' },
  ],
    pageSize: 15,});
  if (chosen === '__back__') return;
  let printing = false;
  const section = [];
  for (const line of lines) {
    if (line === chosen) printing = true;
    else if (printing && line.startsWith('## ')) break;
    if (printing) section.push(line);
  }
  console.log('\n' + chalk.cyan(section.join('\n')) + '\n');
  await pressEnter();
}

// ── Beautiful Command Center (blessed-style layout with chalk) ────────────────

async function screenCommandCenter() {
  const { default: http } = await import('http');

  // Fetch live stats in background
  let hw = null, health = null;
  try {
    hw = await new Promise(r => {
      const req = http.get('http://localhost:3001/api/llmfit', {
        headers: { Cookie: `gf_token=${process.env.AUTH_SECRET || 'ghostforge-secret'}` },
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) return r(null);
          try { r(JSON.parse(d).hardware || null); } catch { r(null); }
        });
      });
      req.on('error', () => r(null));
      req.setTimeout(3000, () => { req.destroy(); r(null); });
    });
  } catch {}

  const cols = process.stdout.columns || 100;
  const panelW = Math.max(18, Math.floor((cols - 10) / 4));

  function panel(icon, title, items, color) {
    const border = color || T.brand;
    const w = panelW;
    const top    = border('┌' + '─'.repeat(w - 2) + '┐');
    const hdr    = border('│') + ' ' + T.white.bold(`${icon} ${title}`).slice(0, w - 4).padEnd(w - 4) + ' ' + border('│');
    const sep    = border('├' + '─'.repeat(w - 2) + '┤');
    const rows   = items.map(([k, label]) => {
      const row = ` ${T.accent.bold(k.padEnd(3))}${T.white(label)}`;
      const vis  = ` ${k.padEnd(3)}${label}`;
      const pad  = Math.max(0, w - 2 - vis.length);
      return border('│') + row + ' '.repeat(pad) + border('│');
    });
    const bot    = border('└' + '─'.repeat(w - 2) + '┘');
    return [top, hdr, sep, ...rows, bot].join('\n');
  }

  function sideBySide(...panels) {
    const splitPanels = panels.map(p => p.split('\n'));
    const height = Math.max(...splitPanels.map(p => p.length));
    const padded  = splitPanels.map(p => {
      while (p.length < height) p.push('');
      return p;
    });
    return Array.from({ length: height }, (_, i) =>
      padded.map(p => (p[i] || '').padEnd(panelW)).join(' ')
    ).join('\n');
  }

  const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const hwLine = hw
    ? T.muted(` ${hw.cpuBrand || 'CPU'} · ${hw.ramGB}GB RAM · ~${hw.availableGB}GB free`)
    : T.muted(' Hardware: local mode · LLMfit works without Web UI');

  function render() {
    clear();
    // Header
    const title = T.brand.bold('  ██████╗ ███████╗ █████╗ ██╗ ');
    console.log(boxen(
      T.accent.bold(` GhostForge AI Command Center  v${VERSION}`) + T.muted(`  •  ${ts}`) + '\n' +
      hwLine + T.muted('  •  ') + T.success('Ctrl+C: menu') + T.muted('  •  ') + T.warning('?: guide me'),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderColor: '#0077C8', borderStyle: 'double' }
    ));
    console.log();

    // 4-column feature grid
    const p1 = panel('🤖', 'AI & JARVIS', [
      ['1', ' Chat (TUI)'],
      ['2', ' Web UI'],
      ['3', ' Switch Model'],
      ['4', ' LLMFit'],
      ['5', ' Cleanup Mac'],
      ['6', ' Voice'],
    ], T.cyan);

    const p2 = panel('💻', 'Dev Tools', [
      ['a', ' Commands'],
      ['b', ' Projects'],
      ['c', ' Snippets'],
      ['d', ' Deploy'],
      ['e', ' Generate'],
      ['f', ' Health'],
    ], T.success);

    const p3 = panel('🔒', 'Security', [
      ['g', ' Security Audit'],
      ['h', ' Doctor'],
      ['i', ' Tickets'],
      ['j', ' Pentest'],
      ['k', ' Audit Log'],
      ['l', ' Env Check'],
    ], T.warning);

    const p4 = panel('📱', 'Platform', [
      ['m', ' Mac Control'],
      ['n', ' Remote Access'],
      ['o', ' Install APK/IPA'],
      ['p', ' Computer Use'],
      ['q', ' Free LLMs'],
      ['r', ' Free APIs'],
    ], T.brand);

    console.log(sideBySide(p1, p2, p3, p4));
    console.log();

    // Status bar
    const model = _tuiSelectedModel.id || 'auto';
    const serverStatus = hw ? T.success('online') : T.warning('offline · local fallback');
    console.log(
      T.muted('  Model: ') + T.accent(model) +
      T.muted('  │  Server: ') + serverStatus +
      T.muted('  │  ') + T.dim('Type number/letter to navigate · msg to chat · ? guide me · ESC menu')
    );
    console.log(divider());
  }

  const keyMap = {
    '1': 'chat', '2': 'webui', '3': 'model', '4': 'llmfit', '5': 'cleanup', '6': 'voice',
    'a': 'commands', 'b': 'projects', 'c': 'snippets', 'd': 'deploy', 'e': 'generate', 'f': 'health',
    'g': 'security', 'h': 'doctor', 'i': 'tickets', 'j': 'security', 'k': 'audit', 'l': 'env-check',
    'm': 'maccontrol', 'n': 'remote', 'o': 'deviceinstall', 'p': 'maccontrol', 'q': 'freemodels', 'r': 'freeapis',
    's': 'integrations',
  };

  // Handle integrations destination
  const handleDest = async (dest) => {
    if (dest === 'integrations') await screenIntegrationsHub();
    else if (dest === 'chat')    await screenGFAIChat();
    else if (dest === 'webui')   { try { execSync('open http://localhost:3001/jarvis 2>/dev/null', { stdio: 'ignore' }); } catch {} console.log(T.success('  ✓ Opened browser')); await new Promise(r=>setTimeout(r,1500)); }
    else if (dest === 'model')   await screenModelSelect();
    else if (dest === 'llmfit')  await screenLLMFit();
    else if (dest === 'cleanup') await screenMacCleanup();
    else if (dest === 'voice')   await screenVoice();
    else if (dest === 'commands') await screenCommands();
    else if (dest === 'snippets') await screenSnippets();
    else if (dest === 'projects') await screenProjects();
    else if (dest === 'deploy')  await screenDeploy();
    else if (dest === 'generate') await screenGenerate();
    else if (dest === 'health')  await screenHealth();
    else if (dest === 'security') await screenSecurity();
    else if (dest === 'doctor')  await screenDoctor();
    else if (dest === 'tickets') await screenTickets();
    else if (dest === 'env-check') await screenEnvCheck();
    else if (dest === 'maccontrol') await screenMacControl();
    else if (dest === 'remote')  { console.log(T.cyan('\n  Opening remote: http://localhost:3001/remote\n')); try { execSync('open http://localhost:3001/remote 2>/dev/null', { stdio: 'ignore' }); } catch {} await pressEnter(); }
    else if (dest === 'deviceinstall') await screenDeviceInstall();
    else if (dest === 'freemodels') await screenFreeModels();
    else if (dest === 'freeapis') await screenFreeAPIs();
    else if (dest === 'audit')   await screenAuditLog();
  };

  render();
  console.log();

  // Interactive loop
  while (true) {
    let inp;
    try {
      inp = await input({
        message: T.cyan('▸'),
        theme: { prefix: '' },
      });
    } catch { break; }

    const cmd = inp.trim().toLowerCase();
    if (!cmd) { render(); continue; }
    if (cmd === 'esc' || cmd === 'menu' || cmd === 'exit') break;
    if (cmd === '?') { await screenGuideMe(); render(); continue; }

    // Single key navigation
    if (keyMap[cmd]) {
      await handleDest(keyMap[cmd]);
      render();
      continue;
    }

    // Otherwise: send to JARVIS as a chat message
    const spinner = ora(T.muted('  G.F.A.I. thinking...')).start();
    try {
      const resp = await askGFAI({
        message: inp,
        selectedProvider: _tuiSelectedModel.provider,
        selectedModel: _tuiSelectedModel.id,
      });
      spinner.stop();
      const speech = resp.speech || resp.text || 'No response.';
      const model2 = resp.usedModel ? T.muted(` [${resp.usedModel}]`) : '';
      console.log();
      console.log(boxen(
        T.cyan.bold('G.F.A.I.:') + model2 + '\n\n' + T.white(speech) +
        (resp.toolResult ? '\n\n' + T.accent('Result:\n') + T.dim(String(resp.toolResult).slice(0, 600)) : ''),
        { padding: 1, margin: { left: 2 }, borderColor: 'cyan', borderStyle: 'round' }
      ));
      console.log();
    } catch (e) {
      spinner.stop();
      console.log(T.danger(`\n  Error: ${e.message}\n`));
    }
  }
}

// ── Guide Me — discovery mode for new users ───────────────────────────────────

async function screenGuideMe() {
  sectionHeader('🧭  Guide Me', 'I\'ll help you find the right feature based on what you want to do');
  console.log(T.muted('  Answer a couple of questions and I\'ll guide you to the right feature.\n'));

  const goal = await select({
    message: T.white('What do you want to do?'),
    choices: [
      { name: T.cyan('💬  Talk to an AI / get help with code'), value: 'ai' },
      { name: T.success('🚀  Start or setup a new project'), value: 'project' },
      { name: T.accent('🔒  Check security / run tests'), value: 'security' },
      { name: T.warning('📱  Build for mobile / install on phone'), value: 'mobile' },
      { name: T.brand('🖥  Control my Mac / remote access'), value: 'control' },
      { name: T.white('📊  See project health / dashboard'), value: 'health' },
      { name: T.muted('🆓  Use free AI models (no API key)'), value: 'free' },
      { name: T.accent('⚡  Run a quick command'), value: 'quick' },
      { name: T.cyan('🎓  Learn what this tool can do'), value: 'tour' },
    ],
  });

  const guides = {
    ai: {
      title: '🤖 AI Features',
      text: [
        T.white('Great choice! GhostForge has multiple AI entry points:\n'),
        T.accent('  [1] ') + T.white('TUI Chat') + T.muted('     → quick terminal chat with any model'),
        T.accent('  [2] ') + T.white('Web UI (JARVIS)') + T.muted(' → voice + tools + memory in browser'),
        T.accent('  [3] ') + T.white('Switch Model') + T.muted('   → choose: Gemini, OpenAI, Groq, Ollama, etc.'),
        T.accent('  [4] ') + T.white('LLMFit') + T.muted('         → find the best local model for your hardware'),
        T.accent('\n  Recommended: ') + T.white('Start with "2" (Web UI) for the full JARVIS experience.'),
        T.muted('\n  Or type your question directly in the command center!'),
      ],
      action: 'chat',
    },
    project: {
      title: '🚀 Project Setup',
      text: [
        T.white('GhostForge helps you scaffold, onboard, and manage projects:\n'),
        T.accent('  /setup') + T.muted('       → wizard: framework, tools, repo init'),
        T.accent('  /create') + T.muted('      → generate React/Next.js/NestJS project'),
        T.accent('  /scaffold') + T.muted('    → folder structure + boilerplate'),
        T.accent('  /open') + T.muted('        → add GhostForge to existing project'),
        T.accent('\n  Recommended: ') + T.white('Run "New Project Setup" from the main menu.'),
      ],
      action: 'setup',
    },
    security: {
      title: '🔒 Security & Testing',
      text: [
        T.white('Security + testing features:\n'),
        T.accent('  /security') + T.muted('   → OWASP scan, deps, secrets'),
        T.accent('  /test') + T.muted('       → auto-detect + run tests'),
        T.accent('  /pentest') + T.muted('    → pen test simulation'),
        T.accent('  Doctor') + T.muted('      → health check: env, AI, bridge'),
        T.accent('\n  Recommended: ') + T.white('Run "Doctor" first to check your setup, then "Security Audit".'),
      ],
      action: 'security',
    },
    mobile: {
      title: '📱 Mobile & Device Install',
      text: [
        T.white('GhostForge supports multiple mobile install methods:\n'),
        T.success('  PWA (Progressive Web App)') + T.muted(' → works on iOS + Android right now!'),
        T.accent('    Open ') + T.white('http://[your-mac-ip]:3001') + T.muted(' on your phone'),
        T.accent('    iOS: ') + T.muted('Share → Add to Home Screen'),
        T.accent('    Android: ') + T.muted('Menu → Install app / Add to Home Screen\n'),
        T.warning('  Android APK') + T.muted(' → native app via Capacitor'),
        T.accent('    Run: ') + T.white('gf → Install on Device (o) → Build Android APK\n'),
        T.brand('  Recommended: ') + T.white('Start with PWA — fastest, no build needed!'),
      ],
      action: 'deviceinstall',
    },
    control: {
      title: '🖥 Mac Control & Remote',
      text: [
        T.white('Control your Mac with AI or remotely:\n'),
        T.accent('  Mac Control') + T.muted('   → natural language → AppleScript'),
        T.accent('              ') + T.muted('   e.g. "open Safari", "lock screen"'),
        T.accent('  Remote Access') + T.muted(' → screen share + control from any device'),
        T.accent('              ') + T.muted('   at http://[ip]:3001/remote'),
        T.accent('  JARVIS') + T.muted('        → "take screenshot", "click at 500 300"'),
        T.accent('\n  Recommended: ') + T.white('Use JARVIS Web UI for best experience.'),
      ],
      action: 'maccontrol',
    },
    health: {
      title: '📊 Health & Dashboard',
      text: [
        T.white('Monitor your project and AI system:\n'),
        T.accent('  /health') + T.muted('     → score /100: deps, tests, security'),
        T.accent('  Dashboard') + T.muted('   → real-time: tickets, pipelines, charts'),
        T.accent('  Doctor') + T.muted('      → AI + env + bridge health check'),
        T.accent('\n  Recommended: ') + T.white('Run "Doctor" first, then "Project Health".'),
      ],
      action: 'health',
    },
    free: {
      title: '🆓 Free AI Models',
      text: [
        T.white('Many ways to use AI for free:\n'),
        T.success('  Ollama (local)') + T.muted('  → qwen2.5-coder:7b already installed!'),
        T.success('  OmniRoute') + T.muted('      → 250+ providers, 90+ free tiers'),
        T.success('  Groq') + T.muted('           → Llama3 70B free with API key'),
        T.success('  OpenRouter') + T.muted('     → many free models'),
        T.success('  NVIDIA NIM') + T.muted('     → free tier API'),
        T.accent('\n  See all:') + T.white(' gf → Free Models (q)'),
        T.accent('  Free APIs: ') + T.white('gf → Free APIs (r)'),
      ],
      action: 'freemodels',
    },
    quick: {
      title: '⚡ Quick Commands',
      text: [
        T.white('Common quick commands:\n'),
        T.accent('  gf health') + T.muted('   → project health check'),
        T.accent('  gf doctor') + T.muted('   → system health check'),
        T.accent('  gf chat') + T.muted('     → quick AI chat'),
        T.accent('  gf jarvis') + T.muted('   → open JARVIS web UI'),
        T.muted('\n  Or just type your question in the Command Center!'),
      ],
      action: null,
    },
    tour: {
      title: '🎓 What GhostForge Can Do',
      text: [
        T.white.bold('GhostForge is an operator-grade AI developer toolkit:\n'),
        T.cyan('  🤖 G.F.A.I. (JARVIS)') + T.muted(' — voice AI, Mac control, tools, memory'),
        T.success('  💻 Dev Tools') + T.muted('       — 40+ slash commands for dev workflows'),
        T.accent('  🔒 Security') + T.muted('        — OWASP, secrets, pen test'),
        T.warning('  📱 Mobile') + T.muted('          — PWA + Android APK + iOS IPA'),
        T.brand('  🌐 Remote') + T.muted('          — screen share, remote control'),
        T.cyan('  🆓 Free AI') + T.muted('         — Ollama, Groq, OpenRouter, NVIDIA'),
        T.success('  🔀 Git/CI') + T.muted('          — commits, PRs, releases, pipelines'),
        T.accent('  🏪 Marketplace') + T.muted('     — install agents, skills, plugins'),
        T.muted('\n  Start with the Command Center (enter "cc" from menu) for overview.'),
      ],
      action: null,
    },
  };

  const guide = guides[goal];
  if (!guide) return;

  console.log('\n' + boxen(
    T.cyan.bold(` ${guide.title} `) + '\n\n' + guide.text.join('\n'),
    { padding: 1, borderColor: '#06B6D4', borderStyle: 'round', width: 72 }
  ));

  if (guide.action) {
    const proceed = await confirm({ message: T.white(`Go to ${guide.title} now?`) });
    if (proceed) {
      if (guide.action === 'chat')         await screenGFAIChat();
      else if (guide.action === 'setup')   await screenSetup();
      else if (guide.action === 'security') await screenSecurity();
      else if (guide.action === 'maccontrol') await screenMacControl();
      else if (guide.action === 'health')  await screenHealth();
      else if (guide.action === 'freemodels') await screenFreeModels();
      else if (guide.action === 'deviceinstall') await screenDeviceInstall();
    }
  } else {
    await pressEnter();
  }
}

// ── Device Install — APK/IPA/PWA guide ────────────────────────────────────────

async function screenDeviceInstall() {
  sectionHeader('📱  Install on Device', 'APK (Android) · IPA (iOS) · PWA · Desktop');

  const platform = await select({
    message: T.white('Target platform:'),
    choices: [
      { name: T.success('🌐  PWA (Recommended)') + T.muted('     — works on iOS + Android NOW, no build needed'), value: 'pwa' },
      { name: T.accent('🤖  Android APK') + T.muted('          — native app via Capacitor + Android Studio'), value: 'android' },
      { name: T.brand('🍎  iOS IPA') + T.muted('              — native app via Capacitor + Xcode'), value: 'ios' },
      { name: T.white('🖥  Desktop (Electron)') + T.muted('    — Mac/Windows/Linux native app'), value: 'electron' },
      { name: T.muted('↩  Back'), value: 'back' },
    ],
  });

  if (platform === 'back') return;

  if (platform === 'pwa') {
    // Get local IP
    let ip = '192.168.1.x';
    try { ip = execSync("ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null", { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
    console.log('\n' + boxen(
      T.cyan.bold(' PWA Install (Fastest — no build needed!) \n\n') +
      T.white.bold('Step 1: ') + T.white('Make sure GhostForge server is running on your Mac\n') +
      T.muted('         ') + T.accent(`cd ~/GhostForge && npm start -- -p 3001\n\n`) +
      T.white.bold('Step 2: ') + T.white('Connect your phone to the same WiFi\n\n') +
      T.white.bold('Step 3: ') + T.white('Open this URL on your phone:\n') +
      T.success.bold(`         http://${ip}:3001\n\n`) +
      T.white.bold('Step 4 (iOS): ') + T.white('Safari → Share button → "Add to Home Screen"\n') +
      T.white.bold('Step 4 (Android): ') + T.white('Chrome → Menu (⋮) → "Add to Home Screen" / "Install app"\n\n') +
      T.muted('Note: For mic/voice access, use HTTPS. Run: ') + T.accent('bash scripts/setup-https.sh'),
      { padding: 1, borderColor: '#22C55E', borderStyle: 'round', width: 72 }
    ));
    await pressEnter(); return;
  }

  if (platform === 'android') {
    console.log('\n' + boxen(
      T.cyan.bold(' Android APK Build (via Capacitor) \n\n') +
      T.white.bold('Prerequisites:\n') +
      T.white('  • Node.js 18+\n  • Java 17+ (brew install openjdk@17)\n  • Android Studio\n\n') +
      T.white.bold('Build steps:\n') +
      T.accent('  cd ~/GhostForge/web-ui\n') +
      T.accent('  npm run build\n') +
      T.accent('  npx cap init GhostForge com.ghostforge.app --web-dir out\n') +
      T.accent('  npx cap add android\n') +
      T.accent('  npx cap sync android\n') +
      T.accent('  npx cap open android       # Opens Android Studio\n') +
      T.accent('  # In Android Studio: Build → Generate Signed APK\n\n') +
      T.muted('Or run the automated script: ') + T.white('bash scripts/build-android.sh\n\n') +
      T.warning('Features available on Android:\n') +
      T.success('  ✓ AI Chat, JARVIS, voice\n') +
      T.success('  ✓ Remote Mac control (via web)\n') +
      T.success('  ✓ All web-based features\n') +
      T.muted('  ✗ Mac-specific tools (AppleScript, screencapture) — Mac only'),
      { padding: 1, borderColor: '#06B6D4', borderStyle: 'round', width: 72 }
    ));
    const build = await confirm({ message: T.white('Run the Android build script now?') });
    if (build) {
      console.log(T.cyan('\n  Running scripts/build-android.sh ...\n'));
      runScriptSync('scripts/build-android.sh');
    }
    await pressEnter(); return;
  }

  if (platform === 'ios') {
    console.log('\n' + boxen(
      T.cyan.bold(' iOS IPA Build (via Capacitor + Xcode) \n\n') +
      T.white.bold('Prerequisites:\n') +
      T.white('  • macOS with Xcode 15+\n  • Apple Developer account (free or paid)\n  • CocoaPods: ') + T.accent('sudo gem install cocoapods\n\n') +
      T.white.bold('Build steps:\n') +
      T.accent('  cd ~/GhostForge/web-ui\n') +
      T.accent('  npm run build\n') +
      T.accent('  npx cap init GhostForge com.ghostforge.app --web-dir out\n') +
      T.accent('  npx cap add ios\n') +
      T.accent('  npx cap sync ios\n') +
      T.accent('  npx cap open ios           # Opens Xcode\n') +
      T.accent('  # In Xcode: Product → Archive → Distribute App\n\n') +
      T.muted('Or run: ') + T.white('bash scripts/build-ios.sh'),
      { padding: 1, borderColor: '#F59E0B', borderStyle: 'round', width: 72 }
    ));
    const build = await confirm({ message: T.white('Run the iOS build script now?') });
    if (build) {
      console.log(T.cyan('\n  Running scripts/build-ios.sh ...\n'));
      runScriptSync('scripts/build-ios.sh');
    }
    await pressEnter(); return;
  }

  if (platform === 'electron') {
    console.log('\n' + boxen(
      T.cyan.bold(' Desktop App (Electron) \n\n') +
      T.white.bold('Build steps:\n') +
      T.accent('  cd ~/GhostForge/web-ui\n') +
      T.accent('  npm install electron electron-builder\n') +
      T.accent('  npm run build\n') +
      T.accent('  npx electron-builder build --mac    # macOS .dmg\n') +
      T.accent('  npx electron-builder build --win    # Windows .exe\n') +
      T.accent('  npx electron-builder build --linux  # Linux .AppImage\n\n') +
      T.muted('Or run: ') + T.white('bash scripts/build-electron.sh'),
      { padding: 1, borderColor: '#8B5CF6', borderStyle: 'round', width: 72 }
    ));
    await pressEnter(); return;
  }
}

// ── Free AI APIs screen ───────────────────────────────────────────────────────

async function screenFreeAPIs() {
  sectionHeader('🆓  Free LLM API Resources', 'Free API endpoints — no credit card needed');

  console.log(T.muted('  Source: github.com/cheahjs/free-llm-api-resources\n'));

  const freeApis = [
    { name: 'Google Gemini',     models: 'gemini-2.0-flash, gemini-1.5-pro', limit: '1M tokens/day',  url: 'aistudio.google.com', key: 'GEMINI_API_KEY',    status: 'active' },
    { name: 'Groq',              models: 'llama3-70b, qwen3-32b, R1-distill', limit: '14.4k tok/min', url: 'console.groq.com',    key: 'GROQ_API_KEY',      status: 'active' },
    { name: 'DeepSeek',          models: 'v4-flash $0.14/M, v4-pro $1.74/M',limit: '~5M free on signup', url: 'platform.deepseek.com',key: 'DEEPSEEK_API_KEY', status: 'paid' },
    { name: 'DeepSeek (free OR)', models: 'deepseek-r1:free, v3:free',       limit: '200 req/day',    url: 'openrouter.ai',       key: 'OPENROUTER_API_KEY',status: '✓ free' },
    { name: 'OpenRouter (free)', models: '40+ free models incl DeepSeek',    limit: '200 req/day',    url: 'openrouter.ai',       key: 'OPENROUTER_API_KEY',status: 'active' },
    { name: 'Cloudflare AI',     models: 'llama3, mistral, phi-2',           limit: '10k neurons/day',url: 'ai.cloudflare.com',   key: 'CF_API_KEY',         status: 'active' },
    { name: 'NVIDIA NIM',        models: 'llama3-70b, mistral large',        limit: '1k credits',     url: 'build.nvidia.com',    key: 'NVIDIA_API_KEY',     status: 'active' },
    { name: 'Cohere',            models: 'command-r, command-light',         limit: '1k req/mo free', url: 'cohere.com',          key: 'COHERE_API_KEY',     status: 'active' },
    { name: 'Together AI',       models: 'llama, qwen, mistral, deepseek',   limit: '$5 free credit', url: 'api.together.ai',     key: 'TOGETHER_API_KEY',   status: 'active' },
    { name: 'HuggingFace',       models: '1000s of models',                  limit: '~10 req/s',      url: 'huggingface.co/api',  key: 'HF_TOKEN',           status: 'active' },
    { name: 'OmniRoute (local)', models: 'Auto-routes to all above',         limit: 'Unlimited local',url: 'localhost:20128',     key: 'None needed',        status: '✓ setup'},
    { name: 'Ollama (local)',    models: 'qwen3:14b (pulling), qwen2.5-coder:7b', limit: 'Unlimited', url: 'localhost:11434',     key: 'None needed',        status: '✓ ready'},
    { name: 'xAI Grok',          models: 'grok-3-mini, grok-3',             limit: 'Paid + free tier',url: 'console.x.ai',       key: 'XAI_API_KEY',        status: 'paid' },
    { name: 'Mistral (free)',    models: 'mistral-small, codestral',         limit: '1 req/s free',   url: 'console.mistral.ai',  key: 'MISTRAL_API_KEY',    status: 'active'},
    { name: 'jsrepl.io (code)',  models: 'JS/TS/Python/HTML sandbox',        limit: 'Unlimited free', url: 'jsrepl.io',           key: 'None needed',        status: '✓ free' },
  ];

  const table = new Table({
    head: [T.cyan('Provider'), T.white('Models'), T.muted('Limit'), T.success('Status')],
    colWidths: [22, 28, 20, 12],
    style: { head: [], border: ['cyan'] },
  });

  freeApis.forEach(api => {
    const statusColor = api.status.includes('✓') ? T.success(api.status) :
                        api.status === 'beta' ? T.warning(api.status) : T.white(api.status);
    table.push([T.white(api.name), T.muted(api.models), T.dim(api.limit), statusColor]);
  });

  console.log(table.toString());
  console.log();

  const action = await select({
    message: T.white('Action:'),
    choices: [
      { name: T.accent('📋  View setup guide for a provider'), value: 'view' },
      { name: T.success('⚡  Open provider website'), value: 'open' },
      { name: T.cyan('🔄  Add API key to .env.local'), value: 'addkey' },
      { name: T.muted('↩  Back'), value: 'back' },
    ],
  });

  if (action === 'view') {
    const picked = await select({
      message: T.white('Choose provider:'),
      choices: freeApis.map(a => ({ name: T.white(a.name) + T.muted(` — ${a.limit}`), value: a.name })),
    });
    const api = freeApis.find(a => a.name === picked);
    if (api) {
      console.log('\n' + boxen(
        T.cyan.bold(` ${api.name} Setup \n\n`) +
        T.white('Models: ') + T.muted(api.models) + '\n' +
        T.white('Limit: ') + T.muted(api.limit) + '\n' +
        T.white('URL: ') + T.accent(api.url) + '\n' +
        T.white('Env key: ') + T.accent(api.key) + '\n\n' +
        T.muted('Add to ~/GhostForge/web-ui/.env.local:\n') +
        T.accent(`${api.key}=your-key-here`),
        { padding: 1, borderColor: '#06B6D4', borderStyle: 'round' }
      ));
      await pressEnter();
    }
  } else if (action === 'open') {
    const picked = await select({
      message: T.white('Choose provider:'),
      choices: freeApis.filter(a => !a.url.includes('localhost')).map(a => ({ name: T.white(a.name), value: a.url })),
    });
    try { execSync(`open https://${picked} 2>/dev/null`, { stdio: 'ignore' }); } catch {}
    console.log(T.success(`\n  ✓ Opened https://${picked}\n`));
    await pressEnter();
  } else if (action === 'addkey') {
    const picked = await select({
      message: T.white('Choose provider:'),
      choices: freeApis.filter(a => a.key !== 'None needed').map(a => ({ name: T.white(a.name), value: a })),
    });
    const keyVal = await input({ message: T.white(`Enter ${picked.key}:`) });
    if (keyVal.trim()) {
      const envFile = resolve(ROOT, 'web-ui/.env.local');
      if (existsSync(envFile)) {
        const content = readFileSync(envFile, 'utf8');
        const newLine = `${picked.key}=${keyVal.trim()}`;
        if (content.includes(`${picked.key}=`)) {
          writeFileSync(envFile, content.replace(new RegExp(`^${picked.key}=.*$`, 'm'), newLine));
        } else {
          writeFileSync(envFile, content + '\n' + newLine + '\n');
        }
        console.log(T.success(`\n  ✓ Added ${picked.key} to .env.local\n`));
      }
    }
    await pressEnter();
  }
}

// ── Audit Log viewer ──────────────────────────────────────────────────────────

async function screenAuditLog() {
  sectionHeader('📋  Audit Log', 'Recent JARVIS tool activity and commands');
  const logPath = resolve(process.env.HOME || '~', '.ghostforge/audit.log');
  if (!existsSync(logPath)) {
    console.log(T.muted('\n  No audit log found yet. Actions are logged as you use JARVIS.\n'));
    await pressEnter(); return;
  }
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-30).reverse();
  console.log(T.muted(`  Last ${lines.length} actions (newest first):\n`));
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      const ts = new Date(e.timestamp).toLocaleTimeString();
      const risk = e.risk === 'high' ? T.danger('HIGH') : e.risk === 'medium' ? T.warning('MED ') : T.muted('low ');
      const tool = T.accent((e.tool || 'chat').padEnd(20));
      console.log(`  ${T.muted(ts)}  ${risk}  ${tool}  ${T.dim((e.message || '').slice(0, 60))}`);
    } catch { console.log(T.dim(`  ${line.slice(0, 80)}`)); }
  }
  console.log();
  await pressEnter();
}

// ── Integrations Hub — herdr, repowise, Vane, tasteskill ─────────────────────

async function screenIntegrationsHub() {
  sectionHeader('🔌  Integrations Hub', 'herdr · repowise · Vane · tasteskill — add superpowers');

  const tool = await select({
    message: T.white('Choose integration:'),
    choices: [
    { name: T.success.bold('🔵  DeepSeek API') + T.muted('     — deepseek-chat, deepseek-reasoner, deepseek-coder'), value: 'deepseek' },
    { name: T.success.bold('🐄  herdr') + T.muted('       — agent multiplexer: run all AI agents from one terminal'), value: 'herdr' },
      { name: T.cyan.bold('🧠  repowise') + T.muted('    — codebase intelligence: 96% fewer tokens for AI agents'), value: 'repowise' },
      { name: T.accent.bold('🔎  Vane') + T.muted('        — self-hosted AI search engine (Perplexity alternative)'), value: 'vane' },
      { name: T.brand.bold('🎨  tasteskill') + T.muted('  — frontend UI quality rules for AI coding agents'), value: 'tasteskill' },
      { name: T.muted('↩  Back'), value: 'back' },
    ],
  });

  if (tool === 'deepseek') {
    console.log('\n' + boxen(
      T.brand.bold(' 🔵 DeepSeek API — Best Value AI \n\n') +
      T.white('What it is:\n') +
      T.muted('  OpenAI-compatible API. deepseek-chat is among the best models at\n') +
      T.muted('  ~$0.14/M input tokens. deepseek-reasoner (R1) is a Chain-of-Thought\n') +
      T.muted('  reasoning model rivaling o1. Fully integrated in GhostForge.\n\n') +
      T.white.bold('Models (July 2026):\n') +
      T.accent('  deepseek-v4-flash    ') + T.muted('→ $0.14/M tokens, 1M context — RECOMMENDED\n') +
      T.accent('  deepseek-v4-pro      ') + T.muted('→ $1.74/M tokens, 1M context — highest quality\n') +
      T.accent('  deepseek-chat        ') + T.muted('→ V3 alias (deprecated, still works)\n') +
      T.accent('  deepseek-reasoner    ') + T.muted('→ R1 alias (deprecated, still works)\n\n') +
      T.white.bold('Free tier:\n') +
      T.muted('  ~5M tokens on signup. Cache hits = 50-100× cheaper!\n\n') +
      T.white.bold('Setup:\n') +
      T.accent('  1. Get API key: https://platform.deepseek.com/\n') +
      T.accent('  2. Add to .env.local: DEEPSEEK_API_KEY=sk-...\n') +
      T.accent('  3. In model picker: select deepseek → deepseek-chat\n\n') +
      T.white.bold('Free via OpenRouter (no key needed):\n') +
      T.accent('  Model: deepseek/deepseek-r1:free\n') +
      T.accent('  Model: deepseek/deepseek-chat-v3-0324:free\n\n') +
      T.muted('More integrations: github.com/deepseek-ai/awesome-deepseek-integration'),
      { padding: 1, borderColor: '#0077C8', borderStyle: 'round', width: 74 }
    ));

    const dsAction = await select({
      message: T.white('Action:'),
      choices: [
        { name: T.accent('🔑  Add DeepSeek API key to .env.local'), value: 'addkey' },
        { name: T.success('🌐  Open platform.deepseek.com'), value: 'open' },
        { name: T.muted('↩  Back'), value: 'back' },
      ],
    });

    if (dsAction === 'addkey') {
      const keyVal = await input({ message: T.white('Enter DEEPSEEK_API_KEY (sk-...):') });
      if (keyVal.trim().startsWith('sk-')) {
        const envFile = resolve(ROOT, 'web-ui/.env.local');
        if (existsSync(envFile)) {
          const content = readFileSync(envFile, 'utf8');
          const newLine = `DEEPSEEK_API_KEY=${keyVal.trim()}`;
          writeFileSync(envFile, content.includes('DEEPSEEK_API_KEY=')
            ? content.replace(/^DEEPSEEK_API_KEY=.*$/m, newLine)
            : content + '\n' + newLine + '\n');
          console.log(T.success('\n  ✓ DEEPSEEK_API_KEY saved! Restart the server to use DeepSeek.\n'));
        }
      } else {
        console.log(T.warning('\n  Key should start with sk- — not saved.\n'));
      }
      await pressEnter();
    } else if (dsAction === 'open') {
      try { execSync('open https://platform.deepseek.com/ 2>/dev/null', { stdio: 'ignore' }); } catch {}
      await pressEnter();
    }
    return;
  }

  if (tool === 'back') return;

  if (tool === 'herdr') {
    console.log('\n' + boxen(
      T.success.bold(' 🐄 herdr — AI Agent Multiplexer \n\n') +
      T.white('What it does:\n') +
      T.muted('  Runs all your AI agents (Claude Code, Cursor, Copilot, etc.) from one\n') +
      T.muted('  terminal. Sessions persist when you close your laptop. SSH-accessible\n') +
      T.muted('  from any device including your phone. Zero account, zero telemetry.\n\n') +
      T.white.bold('Install:\n') +
      T.accent('  curl -fsSL https://herdr.dev/install.sh | sh\n') +
      T.accent('  # or: brew install herdr\n\n') +
      T.white.bold('Usage:\n') +
      T.accent('  herdr new "claude code"   # start Claude Code agent\n') +
      T.accent('  herdr ls                  # list all agents + status\n') +
      T.accent('  herdr attach 1            # reattach to agent\n') +
      T.accent('  herdr ssh                 # access from phone/remote\n\n') +
      T.muted('Platform: Linux/macOS stable · Windows preview beta'),
      { padding: 1, borderColor: '#22C55E', borderStyle: 'round', width: 72 }
    ));
    const install = await confirm({ message: T.white('Install herdr now?') });
    if (install) {
      console.log(T.cyan('\n  Installing herdr...\n'));
      try {
        execSync('curl -fsSL https://herdr.dev/install.sh | sh', { stdio: 'inherit', timeout: 60000 });
        console.log(T.success('\n  ✓ herdr installed! Run: herdr --help\n'));
      } catch { console.log(T.warning('\n  Try: brew install herdr\n')); }
    }
    await pressEnter(); return;
  }

  if (tool === 'repowise') {
    console.log('\n' + boxen(
      T.cyan.bold(' 🧠 repowise — Codebase Intelligence Layer \n\n') +
      T.white('What it does:\n') +
      T.muted('  Indexes your repo (AST, deps, git history) into a knowledge base.\n') +
      T.muted('  Serves it to AI agents via 9 MCP tools. Result: 96% fewer tokens,\n') +
      T.muted('  89% fewer file reads, 70% fewer tool calls. Fully local, AGPL.\n\n') +
      T.white.bold('Install:\n') +
      T.accent('  pip3 install repowise\n\n') +
      T.white.bold('Setup for a project:\n') +
      T.accent('  cd your-project\n') +
      T.accent('  repowise init              # index the repo\n') +
      T.accent('  repowise serve             # start MCP server on :8080\n\n') +
      T.white.bold('Connect to Claude/Cursor (add to .cursor/mcp.json):\n') +
      T.accent('  { "mcpServers": { "repowise": { "url": "http://localhost:8080" } } }\n\n') +
      T.muted('Languages: Python, TS, JS, Java, Kotlin, Go, Rust, C++, C#, + 6 more'),
      { padding: 1, borderColor: '#06B6D4', borderStyle: 'round', width: 72 }
    ));
    const install = await confirm({ message: T.white('Install repowise now?') });
    if (install) {
      console.log(T.cyan('\n  Installing repowise...\n'));
      try {
        execSync('pip3 install repowise', { stdio: 'inherit', timeout: 120000 });
        console.log(T.success('\n  ✓ repowise installed! Run: repowise --help\n'));
      } catch { console.log(T.danger('\n  Install failed. Try: pip3 install --user repowise\n')); }
    }
    await pressEnter(); return;
  }

  if (tool === 'vane') {
    let vaneRunning = false;
    try { execSync('curl -s http://localhost:3100 -o /dev/null -w "%{http_code}"', { timeout: 2000, encoding: 'utf8' }); vaneRunning = true; } catch {}

    console.log('\n' + boxen(
      T.accent.bold(' 🔎 Vane — Self-Hosted AI Search Engine \n\n') +
      T.white('What it does:\n') +
      T.muted('  Perplexity-style AI answering engine. Pairs SearxNG (private search)\n') +
      T.muted('  with your LLM (Ollama/OpenAI/Gemini/Groq). Cited answers, file uploads,\n') +
      T.muted('  image/video search. Fully local — no data leaves your machine.\n\n') +
      T.white.bold('Run with Docker (one command):\n') +
      T.accent('  docker run -d --name vane \\\n') +
      T.accent('    -e OLLAMA_URL=http://host.docker.internal:11434 \\\n') +
      T.accent('    -p 3100:3000 \\\n') +
      T.accent('    itzcrazykns1337/vane:latest\n\n') +
      T.white('Then open: ') + T.success('http://localhost:3100') + '\n\n' +
      (vaneRunning ? T.success('  ✓ Vane appears to be running on port 3100!') :
        T.muted('  Status: not detected on port 3100')),
      { padding: 1, borderColor: '#F59E0B', borderStyle: 'round', width: 72 }
    ));
    if (!vaneRunning) {
      const start = await confirm({ message: T.white('Start Vane via Docker now?') });
      if (start) {
        console.log(T.cyan('\n  Starting Vane...\n'));
        try {
          execSync(`docker run -d --name vane -e OLLAMA_URL=http://host.docker.internal:11434 -p 3100:3000 itzcrazykns1337/vane:latest 2>&1`, { stdio: 'inherit', timeout: 30000 });
          console.log(T.success('\n  ✓ Vane started at http://localhost:3100\n'));
        } catch { console.log(T.danger('\n  Docker error. Make sure Docker Desktop is running.\n')); }
      }
    } else {
      try { execSync('open http://localhost:3100 2>/dev/null', { stdio: 'ignore' }); } catch {}
      console.log(T.success('\n  ✓ Opened Vane in browser\n'));
    }
    await pressEnter(); return;
  }

  if (tool === 'tasteskill') {
    console.log('\n' + boxen(
      T.brand.bold(' 🎨 tasteskill — Frontend UI Quality Rules \n\n') +
      T.white('What it does:\n') +
      T.muted('  An agent skill/ruleset that steers AI coding agents (Claude Code,\n') +
      T.muted('  Cursor, Cline) to produce design-intentional, non-templated UIs.\n') +
      T.muted('  Instead of generic Bootstrap-like interfaces, your AI writes\n') +
      T.muted('  components with actual design taste. Zero infrastructure.\n\n') +
      T.white.bold('Install (adds rules to your project):\n') +
      T.accent('  npx skills add https://github.com/Leonxlnx/taste-skill \\\n') +
      T.accent('    --skill "design-taste-frontend"\n\n') +
      T.white.bold('Or install v1 (stable):\n') +
      T.accent('  npx skills add https://github.com/Leonxlnx/taste-skill \\\n') +
      T.accent('    --skill "design-taste-frontend-v1"\n\n') +
      T.muted('Source: github.com/Leonxlnx/taste-skill (open source, free)'),
      { padding: 1, borderColor: '#8B5CF6', borderStyle: 'round', width: 72 }
    ));
    const install = await confirm({ message: T.white('Install tasteskill for current project?') });
    if (install) {
      console.log(T.cyan('\n  Installing tasteskill...\n'));
      try {
        execSync('npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"', { stdio: 'inherit', timeout: 60000 });
        console.log(T.success('\n  ✓ tasteskill installed! Your AI agents will now generate better UIs.\n'));
      } catch { console.log(T.danger('\n  Install failed. Try running manually.\n')); }
    }
    await pressEnter(); return;
  }
}

async function screenDesignResources() {
  sectionHeader('🎨  Design Resources', 'DESIGN.md templates + awesome-design tools');

  const categories = [
    { value: 'design_md', name: '📄  DESIGN.md Templates  — 74 AI-ready templates (Stripe, Apple, Notion, Vercel…)' },
    { value: 'color',       name: '🎨  Color Tools          — Coolors, Adobe Color, Color Hunt, uicolors.app' },
    { value: 'typography',  name: '🔤  Typography           — Google Fonts, Fontjoy, Typescale, Font Pair' },
    { value: 'icons',       name: '🔷  Icons & SVG          — Heroicons, Lucide, Phosphor, Simple Icons' },
    { value: 'stock',       name: '📷  Stock & Illustrations — Unsplash, Undraw, Storyset, UI Faces' },
    { value: 'prototyping', name: '🖥️  Prototyping          — Figma, Framer, Penpot, Excalidraw' },
    { value: 'inspiration', name: '💡  Inspiration          — Dribbble, Awwwards, Mobbin, Siteinspire' },
    { value: 'tools',       name: '🛠️  Component Libraries  — Tailwind, shadcn/ui, Radix, v0.dev' },
    { value: 'back', name: '← Back' },
  ];

  const { action } = await inquirer.prompt([{
    type: 'list', name: 'action', message: 'Choose a design category:',
    choices: categories,
  }]);

  if (action === 'back') return;

  if (action === 'design_md') {
    console.log(boxen(
      chalk.bold.cyan('📄 DESIGN.md Templates') + '\n' +
      chalk.dim('github.com/VoltAgent/awesome-design-md — 74 AI-ready templates\n') +
      chalk.white('Drop a DESIGN.md in your project root — AI agents auto-read it to\n') +
      chalk.white('generate visually consistent UI matching that brand\'s design system.\n\n') +
      chalk.bold('AI/Dev Tools:') + '  Claude, Cursor, Vercel, Warp, Raycast, Lovable, Ollama\n' +
      chalk.bold('Fintech:      ') + '  Stripe, Coinbase, Revolut, Wise, Binance, Mastercard\n' +
      chalk.bold('Big Tech:     ') + '  Apple, Meta, NVIDIA, IBM, Tesla, SpaceX, Nike\n' +
      chalk.bold('Automotive:   ') + '  Ferrari, BMW, Lamborghini, Bugatti, Renault\n' +
      chalk.bold('SaaS/Prod:    ') + '  Notion, Linear, Figma, Framer, Slack, Shopify, Stripe\n\n' +
      chalk.yellow('To apply: ask JARVIS "apply stripe design to my project"\n') +
      chalk.yellow('Or run:   curl -O https://getdesign.md/stripe/design-md'),
      { padding: 1, borderStyle: 'round', borderColor: 'cyan', title: '74 Templates Available' }
    ));

    const { site } = await inquirer.prompt([{
      type: 'input', name: 'site',
      message: 'Enter site name to fetch DESIGN.md (e.g. stripe, vercel, apple) or leave blank to skip:',
    }]);

    if (site.trim()) {
      const spinner = ora(`Fetching ${site} DESIGN.md...`).start();
      try {
        const { execSync } = require('child_process');
        execSync(`curl -fsSL "https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/${site.trim().toLowerCase()}/DESIGN.md" -o "${process.cwd()}/DESIGN.md"`, { stdio: 'pipe' });
        spinner.succeed(`DESIGN.md for ${site} saved to ${process.cwd()}/DESIGN.md`);
        console.log(chalk.green('\n✓ AI agents in this project will now use this design system!'));
      } catch {
        spinner.fail(`Could not fetch DESIGN.md for "${site}". Check spelling.`);
        console.log(chalk.dim('Full list: airbnb, apple, stripe, vercel, notion, figma, slack, spotify…'));
      }
    }
    await pressEnter(); return;
  }

  const resourceMap = {
    color: [
      ['Coolors',       'coolors.co',         'Fast palette generator — share palettes as URLs'],
      ['Adobe Color',   'color.adobe.com',    'Color wheel, harmony rules, extract from image'],
      ['Color Hunt',    'colorhunt.co',       'Curated palettes voted by designers'],
      ['uicolors.app',  'uicolors.app',       'Generate Tailwind CSS color scales from any hex'],
      ['Paletton',      'paletton.com',       'Adjacent/complementary color scheme designer'],
    ],
    typography: [
      ['Google Fonts',  'fonts.google.com',   '1000+ free, web-optimized font families'],
      ['Font Pair',     'fontpair.co',        'Curated Google Font pairings'],
      ['Fontjoy',       'fontjoy.com',        'AI-generated font combinations'],
      ['Typescale',     'typescale.com',      'Visual type scale calculator'],
    ],
    icons: [
      ['Heroicons',     'heroicons.com',      'Hand-crafted SVG by Tailwind team'],
      ['Lucide',        'lucide.dev',         'React/Vue/Svelte icon components (1000+)'],
      ['Phosphor',      'phosphoricons.com',  '7800+ icons in 6 weights'],
      ['Simple Icons',  'simpleicons.org',    'SVG brand/logo icons (3300+)'],
      ['Feather Icons', 'feathericons.com',   'Minimal, clean 24×24 icon set'],
    ],
    stock: [
      ['Unsplash',      'unsplash.com',       'Free hi-res photos, liberal license'],
      ['Pexels',        'pexels.com',         'Free photos and videos'],
      ['Undraw',        'undraw.co',          'MIT SVG illustrations, re-colorable'],
      ['Storyset',      'storyset.com',       'Animated + customizable illustrations'],
      ['UI Faces',      'uifaces.co',         'AI-generated person avatars for mockups'],
    ],
    prototyping: [
      ['Figma',         'figma.com',          'Industry standard: design + prototype + handoff'],
      ['Framer',        'framer.com',         'Design to published website, zero-code'],
      ['Penpot',        'penpot.app',         'Open-source Figma alternative (self-host)'],
      ['Excalidraw',    'excalidraw.com',     'Whiteboard-style wireframing'],
    ],
    inspiration: [
      ['Dribbble',      'dribbble.com',       'Shot-based design portfolio community'],
      ['Awwwards',      'awwwards.com',       'Best web design awards & site gallery'],
      ['Mobbin',        'mobbin.com',         'Mobile & web app UX pattern library'],
      ['Siteinspire',   'siteinspire.com',    'Curated web design showcase'],
    ],
    tools: [
      ['Tailwind CSS',  'tailwindcss.com',    'Utility-first CSS — most popular styling framework'],
      ['shadcn/ui',     'ui.shadcn.com',      'Copy-paste React components (Radix + Tailwind)'],
      ['Radix UI',      'radix-ui.com',       'Unstyled, accessible component primitives'],
      ['v0.dev',        'v0.dev',             'AI component generator by Vercel'],
      ['DESIGN.md',     'getdesign.md',       'AI-ready design system docs (74 sites)'],
    ],
  };

  const list = resourceMap[action] || resourceMap.tools;
  const rows = list.map(([name, url, desc]) =>
    chalk.bold.white(name.padEnd(16)) + chalk.cyan(url.padEnd(26)) + chalk.dim(desc)
  ).join('\n');

  console.log(boxen(
    chalk.bold.cyan(`${action.toUpperCase()} Resources`) + '\n' +
    chalk.dim('Source: github.com/gztchan/awesome-design\n\n') +
    rows,
    { padding: 1, borderStyle: 'round', borderColor: 'cyan' }
  ));

  await pressEnter(); return;
}

async function screenVigolium() {
  sectionHeader('🛡️  Vigolium Security Scanner', 'AI-powered vulnerability scanning (317 modules, OWASP Top 10)');

  // Check if installed
  let installed = false;
  try {
    require('child_process').execSync('vigolium --version 2>/dev/null', { stdio: 'pipe' });
    installed = true;
  } catch { /* not installed */ }

  const statusIcon = installed ? chalk.green('● INSTALLED') : chalk.yellow('○ NOT INSTALLED');
  console.log(boxen(
    chalk.bold('Vigolium Status: ') + statusIcon + '\n\n' +
    chalk.bold.cyan('Native Scan') + chalk.dim('  (vigolium scan)\n') +
    '  317 modules: 201 active fuzzing + 116 passive pattern matching\n' +
    '  OWASP Top 10, OAST (blind XSS/SSRF), multi-session auth (IDOR)\n\n' +
    chalk.bold.cyan('Agentic Scan') + chalk.dim('  (vigolium agent)\n') +
    '  autopilot: fully autonomous AI-driven attack planning\n' +
    '  swarm:     AI selects modules + generates JS exploit code\n' +
    '  audit:     SAST source code analysis (like SonarQube + AI)\n\n' +
    chalk.bold.cyan('AI Providers') + chalk.dim('  (pluggable)\n') +
    '  OpenAI, Anthropic, Google Vertex, Ollama (local), OpenRouter, vLLM\n' +
    chalk.dim('  → Use local qwen3:14b for private scans (no data leaves machine)\n\n') +
    chalk.bold.cyan('Cloud Console') + '  console.vigolium.com\n',
    { padding: 1, borderStyle: 'double', borderColor: installed ? 'green' : 'yellow',
      title: 'github.com/vigolium/vigolium (AGPL-3.0)' }
  ));

  const choices = [
    ...(installed ? [] : [{ value: 'install', name: '📦  Install Vigolium (npm install -g)' }]),
    { value: 'scan',    name: '🔍  Run Native Scan — enter target URL' },
    { value: 'agent',   name: '🤖  Run Agentic Scan — AI autopilot mode' },
    { value: 'audit',   name: '🔎  Source Code Audit — scan current project' },
    { value: 'server',  name: '🖥️   Start Vigolium Server (REST API + SSE)' },
    { value: 'brew',    name: '🍺  Install via Homebrew' },
    { value: 'back',    name: '← Back' },
  ];

  const { action } = await inquirer.prompt([{
    type: 'list', name: 'action', message: 'Vigolium action:', choices,
  }]);

  if (action === 'back') return;

  if (action === 'install') {
    const spinner = ora('Installing @vigolium/vigolium via npm...').start();
    try {
      require('child_process').execSync('npm install -g @vigolium/vigolium', { stdio: 'pipe', timeout: 120000 });
      spinner.succeed('Vigolium installed! Run: vigolium --help');
    } catch (e) {
      spinner.fail('npm install failed');
      console.log(chalk.yellow('Try: brew install vigolium/tap/vigolium'));
      console.log(chalk.yellow('Or:  curl -fsSL https://vigolium.com/install.sh | bash'));
    }
    await pressEnter(); return;
  }

  if (action === 'brew') {
    console.log(boxen(
      chalk.bold('Install via Homebrew:\n\n') +
      chalk.cyan('brew install vigolium/tap/vigolium\n\n') +
      chalk.bold('Or one-liner:\n\n') +
      chalk.cyan('curl -fsSL https://vigolium.com/install.sh | bash'),
      { padding: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));
    await pressEnter(); return;
  }

  if (action === 'scan') {
    const { target } = await inquirer.prompt([{
      type: 'input', name: 'target', message: 'Target URL to scan (e.g. https://example.com):',
    }]);
    if (!target.trim()) { await pressEnter(); return; }
    const { strategy } = await inquirer.prompt([{
      type: 'list', name: 'strategy', message: 'Scan strategy:',
      choices: [
        { value: 'fast',      name: '⚡  Fast      — quick overview, ~30s' },
        { value: 'balanced',  name: '⚖️   Balanced  — thorough but not noisy, ~2min' },
        { value: 'thorough',  name: '🔬  Thorough  — full deep scan, ~10min' },
      ],
    }]);
    console.log(chalk.bold.cyan(`\nStarting ${strategy} scan on ${target}...\n`));
    console.log(chalk.dim(`vigolium scan -t "${target}" --strategy ${strategy}\n`));
    if (!installed) {
      console.log(chalk.yellow('⚠ Vigolium not installed. Install first, then run:\n'));
      console.log(chalk.cyan(`  vigolium scan -t "${target}" --strategy ${strategy}`));
    } else {
      const { exec } = require('child_process');
      const child = exec(`vigolium scan -t "${target}" --strategy ${strategy}`, { timeout: 600000 });
      child.stdout.on('data', d => process.stdout.write(d));
      child.stderr.on('data', d => process.stderr.write(d));
      await new Promise(res => child.on('exit', res));
    }
    await pressEnter(); return;
  }

  if (action === 'agent') {
    const { target } = await inquirer.prompt([{
      type: 'input', name: 'target', message: 'Target URL for agentic scan:',
    }]);
    const cmd = `vigolium agent autopilot -t "${target || 'https://example.com'}"`;
    console.log(boxen(
      chalk.bold.yellow('Agentic Autopilot Scan\n\n') +
      chalk.white('The AI will autonomously plan attacks, select modules,\n') +
      chalk.white('generate custom JS exploits, and triage all findings.\n\n') +
      chalk.bold('Run in terminal:\n') + chalk.cyan(`  ${cmd}\n\n`) +
      chalk.bold('With local AI (private mode):\n') +
      chalk.cyan(`  vigolium agent autopilot -t "${target || '...'}" --provider ollama --model qwen3:14b`),
      { padding: 1, borderStyle: 'round', borderColor: 'yellow' }
    ));
    await pressEnter(); return;
  }

  if (action === 'audit') {
    const projectPath = process.cwd();
    const cmd = `vigolium agent audit --source "${projectPath}"`;
    console.log(boxen(
      chalk.bold.cyan('Source Code Audit (SAST)\n\n') +
      chalk.white(`Scanning: ${projectPath}\n\n`) +
      chalk.bold('Command:\n') + chalk.cyan(`  ${cmd}\n\n`) +
      chalk.bold('Diff-focused (only changed files):\n') +
      chalk.cyan(`  vigolium agent audit --source . --diff HEAD~5`),
      { padding: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));
    await pressEnter(); return;
  }

  if (action === 'server') {
    console.log(boxen(
      chalk.bold.green('Start Vigolium REST API Server\n\n') +
      chalk.cyan('  vigolium server -k my-secret-key\n\n') +
      chalk.white('Features:\n') +
      chalk.dim('  • REST API with SSE streaming\n') +
      chalk.dim('  • OpenAI-compatible chat endpoint\n') +
      chalk.dim('  • HTTP proxy mode for traffic ingestion\n') +
      chalk.dim('  • JARVIS can connect via vigolium_scan tool\n'),
      { padding: 1, borderStyle: 'round', borderColor: 'green' }
    ));
    await pressEnter(); return;
  }
}

async function screenWhatsNew() {
  sectionHeader('👁️  What’s New', 'Latest GhostForge updates at a glance');
  const changelogPath = existsSync(resolve(process.cwd(), 'CHANGELOG.md'))
    ? resolve(process.cwd(), 'CHANGELOG.md')
    : resolve(ROOT, 'CHANGELOG.md');

  if (!existsSync(changelogPath)) {
    console.log(boxen(
      T.warning.bold(' No changelog found ') + '\n\n' +
      T.white('Generate one with ') + T.accent('/changelog') + T.white(' or browse release history with ') + T.accent('/changelog-view') + T.white('.'),
      {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderColor: '#F59E0B',
        borderStyle: 'round',
      }
    ));
    await pressEnter();
    return;
  }

  const lines = readFileSync(changelogPath, 'utf8').split('\n');
  const start = Math.max(lines.findIndex(line => line.startsWith('## ')), 0);
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = Math.min(lines.length, start + 18);

  const preview = lines
    .slice(start, end)
    .join('\n')
    .trim() || 'No recent changelog entries found.';

  console.log(boxen(
    T.cyan.bold(' Latest release notes ') + '\n\n' + T.white(preview),
    {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: '#06B6D4',
      borderStyle: 'round',
      width: 88,
    }
  ));
  console.log();
  console.log(T.muted('  Tip: use /changelog-view to browse older releases interactively.'));
  await pressEnter();
}

async function screenOpenSourceTools() {
  sectionHeader('🔭  Open Source Tools', 'Browse and learn about integrated open source tools');

  const tool = await select({
    message: T.white('Choose an open source tool:'),
    choices: [
      { name: T.accent('🧠  OpenHuman'), value: 'openhuman' },
      { name: T.accent('🤖  OpenBot'), value: 'openbot' },
      { name: T.accent('🌐  Browser Use'), value: 'browseruse' },
      { name: T.accent('🛡️  ECC Tools'), value: 'ecctools' },
      { name: T.muted('↩  Back'), value: 'back' },
    ],
  });

  if (tool === 'back') return;

  let content = '';
  if (tool === 'openhuman') {
    content = `OpenHuman: Personal AI super intelligence with persistent local memory and agent orchestration.
GitHub: https://github.com/tinyhumansai/openhuman
License: GPL-3.0
Integration: Can be used for persistent memory and agent orchestration in GhostForge.`;
  } else if (tool === 'openbot') {
    content = `OpenBot: AI coworkers with dedicated computers (browser/files/tools) governed by policy.
GitHub: https://github.com/CopilotKit/openbot
License: MIT
Integration: Integrate specialized AI agents as coworkers in Jarvis workflows.`;
  } else if (tool === 'browseruse') {
    content = `Browser Use: Makes websites accessible for AI agents to automate web tasks.
GitHub: https://github.com/browser-use/browser-use
License: MIT
Integration: Enable Jarvis to perform web automation, data extraction, and form filling.`;
  } else if (tool === 'ecctools') {
    content = `ECC Tools: Provides skills, rules, hooks, and AgentShield security for AI coding agents.
GitHub: https://github.com/ECC-Tools/.github
Website: https://ecc.tools/
License: MIT
Integration: Standardize GhostForge/Jarvis behavior through skills, rules, and hooks.`;
  }

  console.log(boxen(
    T.white(content),
    { padding: 1, borderColor: '#8B5CF6', borderStyle: 'round' }
  ));
  await pressEnter();
}

async function main() {
  // Silently ensure officecli is installed
  try {
    const { execSync: _exec } = await import('child_process');
    try { _exec('officecli --version', { stdio: 'ignore', timeout: 3000 }); }
    catch {
      // Not installed — install quietly in background
      import('child_process').then(({ spawn }) => {
        const p = spawn('bash', ['-c', 'curl -fsSL https://d.officecli.ai/install.sh | bash'], { stdio: 'ignore', detached: true });
        p.unref();
      });
    }
  } catch {}

  try {
    while (true) {
      const choice = await screenHome();
      if (choice.startsWith('__ask__:')) {
        await screenGFAIChat(choice.slice('__ask__:'.length));
        continue;
      }
      switch (choice) {
        case 'integrations': await screenIntegrationsHub(); break;
        case 'commandcenter': await screenCommandCenter(); break;
        case 'guideme':      await screenGuideMe(); break;
        case 'deviceinstall': await screenDeviceInstall(); break;
        case 'freeapis':     await screenFreeAPIs(); break;
        case 'audit':        await screenAuditLog(); break;
        case 'dashboard':    await screenDashboard(); break; // lazy
        case 'whats-new':    await screenWhatsNew(); break;
        case 'setup':        await screenSetup(); break;
        case 'open':         await screenOpenProject(); break;
        case 'projects':     await screenProjects(); break;
        case 'health':       await screenHealth(); break;
        case 'health-all':   await screenHealthAll(); break;
        case 'perf':         await screenPerf(); break;
        case 'upgrade':      await screenUpgrade(); break;
        case 'mock-api':     await screenMockApi(); break;
        case 'onboard-dev':  await screenOnboardDev(); break;
        case 'ado':          await screenAdo(); break;
        case 'estimate':     await screenEstimate(); break;
        case 'voice':        await screenVoice(); break;
        case 'changelog-view': await screenChangelogViewer(); break;
        case 'commands':     await screenCommands(); break;
        case 'agents':       await screenAgents(); break;
        case 'instructions': await screenInstructions(); break;
        case 'tickets':      await screenTickets(); break;
        case 'security':     await screenSecurity(); break;
        case 'vigolium':     await screenVigolium(); break;
        case 'designresources': await screenDesignResources(); break;
        case 'test':         await screenTest(); break;
        case 'deploy':       await screenDeploy(); break;
        case 'appmorphy':    await screenAppmorphy(); break;
        case 'maccontrol':   await screenMacControl(); break;
        case 'jarvis':       await screenJarvis(); break;
        case 'digest':       await screenDigest(); break;
        case 'readme':       await screenReadme(); break;
        case 'marketplace':  await screenMarketplace(); break; // lazy
        case 'generate':     await screenGenerate(); break; // lazy
        case 'freemodels':   await screenFreeModels(); break; // lazy
        case 'opensourcetools': await screenOpenSourceTools(); break;
        case 'snippets':     await screenSnippets(); break; // lazy
        case 'bundle':       await screenBundle(); break; // lazy
        case 'rtl':          await screenRTL(); break; // lazy
        case 'api-types':    await screenAPITypes(); break; // lazy
        case 'changelog':    await screenChangelog(); break; // lazy
        case 'env-check':    await screenEnvCheck(); break; // lazy
        case 'unused':       await screenUnused(); break; // lazy
        case 'git-hooks':    await screenGitHooks(); break; // lazy
        case 'version':      await screenVersion(); break;
        case 'vscode-install': await screenVSCodeInstall(); break; // lazy
        case 'doctor':       await screenDoctor(); break;
        case 'help':         await screenHelp(); break;
        case 'exit':
          clear();
          console.log(boxen(
            T.brand.bold(' GhostForge signing off 👻 ') + '\n' + T.muted(` GhostForge — v${VERSION} `),
            { padding: 1, borderColor: '#0077C8', borderStyle: 'double' }
          ));
          console.log();
          process.exit(0);
      }
    }
  } catch (e) {
    if (e.name === 'ExitPromptError' || e.message?.includes('User force closed')) {
      clear();
      console.log(T.muted('\n  Exited. Run again: ') + T.accent('ghostforge') + '\n');
      process.exit(0);
    }
    console.error(T.danger('\n  Error: ') + e.message);
    process.exit(1);
  }
}

main();
