#!/usr/bin/env node
/**
 * sync-models.js — Auto-sync Copilot Business plan models
 *
 * Queries the live GitHub Copilot API, reads actual enabled models,
 * rewrites instructions/model-selection.md, updates the auto-synced
 * section in .github/copilot-instructions.md, and prints a branch-aware
 * recommendation for the current git branch.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const JSON_DUMP = process.argv.includes('--json');

const C = {
  blue: s => `\x1b[34m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`
};

const BRANCH_AWARE_SECTION = `## 🌿 Branch-Aware Model Selection

Auto-adjust model and effort based on current git branch:

| Branch Pattern | Model Tier | Effort | Reason |
|----------------|-----------|--------|--------|
| \`main\`, \`master\`, \`production\` | deep (claude-opus-4.8) | high | Production code — maximum care |
| \`hotfix/*\`, \`bugfix/*\` | deep (claude-opus-4.7) | high | Urgent fixes need thorough review |
| \`release/*\` | balanced (claude-sonnet-4.6) | high | Release prep — careful but fast |
| \`feature/*\`, \`feat/*\` | balanced (claude-sonnet-4.6) | medium | Normal feature work |
| \`develop\`, \`dev\` | balanced (claude-sonnet-4.6) | medium | Integration branch |
| \`experiment/*\`, \`spike/*\` | fast (claude-haiku-4.5) | low | Exploration — speed over perfection |
| \`chore/*\`, \`docs/*\` | fast (gpt-5-mini) | low | Non-code changes |`;

function safeExec(command, options = {}) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options }).trim();
}

console.log('');
console.log(C.blue(C.bold('  GhostForge AI Toolkit — Model Sync')));
console.log(C.dim('  Querying GitHub Copilot API...\n'));

let TOKEN;
try {
  TOKEN = safeExec('gh auth token');
} catch {
  console.error('  ✖  gh CLI not authenticated. Run: gh auth login');
  process.exit(1);
}

async function fetchModels() {
  const res = await fetch('https://api.githubcopilot.com/models', {
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Copilot-Integration-Id': 'vscode-chat',
      'Editor-Version': 'vscode/1.90.0'
    }
  });

  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.data || [];
}

function categorize(model) {
  const id = model.id.toLowerCase();
  const cap = model.capabilities || {};
  const sup = cap.supports || {};
  const lim = cap.limits || {};

  const thinking = !!sup.adaptive_thinking;
  const vision = !!lim.vision;
  const maxCtx = lim.max_context_window_tokens || 0;
  const maxOut = lim.max_output_tokens || lim.max_non_streaming_output_tokens || 0;
  const thinkBudg = sup.max_thinking_budget || 0;

  const skip = ['embedding', 'trajectory', 'text-embedding', 'gpt-3.5', 'gpt-4-0613', 'gpt-4o-preview', 'gpt-4-o-preview']
    .some(fragment => id.includes(fragment));
  if (skip) return null;

  let family = 'other';
  let tier = 'balanced';
  let speed = '⚡⚡';

  if (id.includes('claude-opus')) {
    family = 'claude-opus';
    tier = 'deep';
    speed = '⚡';
  } else if (id.includes('claude-sonnet')) {
    family = 'claude-sonnet';
    tier = 'balanced';
    speed = '⚡⚡';
  } else if (id.includes('claude-haiku')) {
    family = 'claude-haiku';
    tier = 'fast';
    speed = '⚡⚡⚡';
  } else if (id.startsWith('gpt-5')) {
    family = 'gpt-5';
    tier = id.includes('mini') ? 'fast' : 'balanced';
    speed = id.includes('mini') ? '⚡⚡⚡' : '⚡⚡';
  } else if (id.startsWith('gpt-4.1')) {
    family = 'gpt-4.1';
  } else if (id.startsWith('gpt-4o')) {
    family = 'gpt-4o';
  } else if (id.includes('gemini-3.1') || id.includes('gemini-3-')) {
    family = 'gemini-3';
    tier = id.includes('flash') ? 'fast' : 'balanced';
    speed = id.includes('flash') ? '⚡⚡⚡' : '⚡⚡';
  } else if (id.includes('gemini-2.5')) {
    family = 'gemini-2.5';
  } else if (id.includes('codex')) {
    family = 'codex';
  }

  const bestFor = {
    'claude-opus': 'Security, architecture, deep analysis, system design',
    'claude-sonnet': 'Features, testing, refactoring, CMS, reliable code gen',
    'claude-haiku': 'Quick edits, explanations, simple tasks',
    'gpt-5': id.includes('mini') ? 'Commit messages, lint, formatting' : 'SQL, APIs, structured output, deployments',
    'gpt-4.1': 'Code generation, general tasks',
    'gpt-4o': 'General code gen, legacy support',
    'gemini-3': id.includes('flash') ? 'Rapid Q&A, fast completions' : 'Large codebase analysis, documentation',
    'gemini-2.5': 'Multimodal, diagrams, visual tasks',
    codex: 'Pure code generation, completion',
    other: 'General purpose'
  }[family] || 'General purpose';

  return { id, family, tier, speed, thinking, vision, maxCtx, maxOut, thinkBudg, bestFor };
}

function fmtCtx(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return `${value}`;
}

function generateMarkdown(models, fetchedAt) {
  const tiers = {
    deep: models.filter(model => model.tier === 'deep'),
    balanced: models.filter(model => model.tier === 'balanced'),
    fast: models.filter(model => model.tier === 'fast')
  };

  const thinkingModels = models.filter(model => model.thinking);
  const row = model =>
    `| \`${model.id}\` | ${model.speed} | ${model.thinking ? '🧠' : '  '} ${model.vision ? '👁' : '  '} | ${fmtCtx(model.maxCtx)} | ${model.bestFor} |`;

  return `# Model Selection & Thinking Effort
> Auto-generated by \`scripts/sync-models.js\` on ${fetchedAt}
> Run \`node scripts/sync-models.js\` to refresh after plan changes.

---

## ✅ Your Active Models (${models.length} available)

### 🔴 Deep — Complex Tasks (security, architecture, design)
| Model | Speed | Caps | Context | Best For |
|-------|-------|------|---------|----------|
${tiers.deep.map(row).join('\n')}

### 🟡 Balanced — Standard Work (features, testing, SQL)
| Model | Speed | Caps | Context | Best For |
|-------|-------|------|---------|----------|
${tiers.balanced.map(row).join('\n')}

### 🟢 Fast — Quick Tasks (explain, lint, commit)
| Model | Speed | Caps | Context | Best For |
|-------|-------|------|---------|----------|
${tiers.fast.map(row).join('\n')}

> 🧠 = adaptive thinking (extended reasoning) | 👁 = vision/image support

---

## 🎯 Auto-Selection: Task → Best Model

| Task / Command | Model | Effort |
|----------------|-------|--------|
| \`/explain-error\`, \`/help\`, quick Q&A | \`${tiers.fast[0]?.id || 'claude-haiku-4.5'}\` | low |
| \`/lint\`, \`/commit\`, \`/pr-description\` | \`${tiers.fast.find(model => model.family === 'gpt-5')?.id || tiers.fast[0]?.id}\` | low |
| \`/add-feature\`, \`/test\` | \`${thinkingModels.find(model => model.tier === 'balanced')?.id || tiers.balanced[0]?.id}\` | medium |
| \`/optimize\`, \`/refactor\`, CMS | \`${thinkingModels.find(model => model.tier === 'balanced')?.id || tiers.balanced[0]?.id}\` | medium |
| \`/sql\`, \`/deploy\`, \`/release\` | \`${tiers.balanced.find(model => model.family === 'gpt-5')?.id || tiers.balanced[0]?.id}\` | medium |
| Large codebase, \`/docs\` | \`${tiers.balanced.find(model => model.family.includes('gemini'))?.id || tiers.balanced[0]?.id}\` | medium |
| \`/security\`, \`/review\` | \`${thinkingModels[0]?.id || tiers.deep[0]?.id}\` | high |
| \`/fix-tickets --critical\` | \`${thinkingModels[1]?.id || tiers.deep[1]?.id || tiers.deep[0]?.id}\` | high |
| Architecture, system design | \`${thinkingModels[0]?.id || tiers.deep[0]?.id}\` | max |

---

## 🧠 Thinking-Capable Models (${thinkingModels.length})

${thinkingModels.map(model => `- \`${model.id}\` — budget up to ${fmtCtx(model.thinkBudg)} tokens`).join('\n')}

Use these for: security audits, architecture, complex multi-step reasoning.

---

## ⚙️ Effort Levels

| Level | Use When |
|-------|----------|
| \`low\` | Quick lookups, simple edits, commit messages |
| \`medium\` | Standard coding tasks, features, SQL |
| \`high\` | Security, architecture, critical bugs |
| \`max\` | Full system design, deep planning (thinking models only) |

---

## 💬 Manual Override Keywords

\`\`\`
"think step by step..."   → ${thinkingModels[0]?.id}, max effort
"thorough audit..."       → ${thinkingModels[0]?.id}, high effort
"quick answer..."         → ${tiers.fast[0]?.id}, low effort
"briefly..."              → ${tiers.fast[0]?.id}, low effort
\`\`\`

---

## 🔧 .ghostforge-config.json Defaults

\`\`\`json
{
  "model": {
    "default": "${thinkingModels.find(model => model.tier === 'balanced')?.id || tiers.balanced[0]?.id}",
    "security": "${thinkingModels[0]?.id || tiers.deep[0]?.id}",
    "architecture": "${thinkingModels[0]?.id || tiers.deep[0]?.id}",
    "quickTasks": "${tiers.fast[0]?.id}",
    "sql": "${tiers.balanced.find(model => model.family === 'gpt-5')?.id || tiers.balanced[0]?.id}",
    "docs": "${tiers.balanced.find(model => model.family.includes('gemini'))?.id || tiers.balanced[0]?.id}",
    "effort": {
      "default": "medium",
      "production": "high",
      "quick": "low"
    }
  }
}
\`\`\`
`;
}

function getBranchTier(models) {
  let branch = 'unknown';
  try {
    branch = safeExec('git --no-pager branch --show-current', { cwd: ROOT }) || 'unknown';
  } catch {
    branch = 'unknown';
  }

  const chooseModel = preferred => models.find(model => model.id === preferred);
  const deep = chooseModel('claude-opus-4.8') || models.find(model => model.tier === 'deep');
  const hotfix = chooseModel('claude-opus-4.7') || deep;
  const balanced = chooseModel('claude-sonnet-4.6') || models.find(model => model.tier === 'balanced');
  const fastHaiku = chooseModel('claude-haiku-4.5') || models.find(model => model.tier === 'fast');
  const fastMini = chooseModel('gpt-5-mini') || models.find(model => model.id.includes('mini')) || fastHaiku;

  const rules = [
    { test: /^(main|master|production)$/i, tier: 'deep', effort: 'high', model: deep, reason: 'Production code — maximum care' },
    { test: /^(hotfix|bugfix)\//i, tier: 'deep', effort: 'high', model: hotfix, reason: 'Urgent fixes need thorough review' },
    { test: /^release\//i, tier: 'balanced', effort: 'high', model: balanced, reason: 'Release prep — careful but fast' },
    { test: /^(feature|feat)\//i, tier: 'balanced', effort: 'medium', model: balanced, reason: 'Normal feature work' },
    { test: /^(develop|dev)$/i, tier: 'balanced', effort: 'medium', model: balanced, reason: 'Integration branch' },
    { test: /^(experiment|spike)\//i, tier: 'fast', effort: 'low', model: fastHaiku, reason: 'Exploration — speed over perfection' },
    { test: /^(chore|docs)\//i, tier: 'fast', effort: 'low', model: fastMini, reason: 'Non-code changes' }
  ];

  const match = rules.find(rule => rule.test.test(branch));
  return match || {
    branch,
    tier: 'balanced',
    effort: 'medium',
    model: balanced,
    reason: 'Default recommendation for unclassified branches'
  };
}

function updateCopilotInstructions(models) {
  const path = resolve(ROOT, '.github/copilot-instructions.md');
  if (!existsSync(path)) return null;

  const content = readFileSync(path, 'utf8');
  const thinkingModels = models.filter(model => model.thinking);
  const fastModels = models.filter(model => model.tier === 'fast').slice(0, 3);
  const balancedModels = models.filter(model => model.tier === 'balanced').slice(0, 4);
  const deepModels = models.filter(model => model.tier === 'deep').slice(0, 3);

  const autoSection = `## 🤖 Model Auto-Selection (auto-synced ${new Date().toISOString().split('T')[0]})

Auto-select best model based on task. Available tiers:

| Tier | Models | Use For |
|------|--------|---------|
| Fast | ${fastModels.map(model => `\`${model.id}\``).join(', ')} | Quick tasks, lint, commit |
| Balanced | ${balancedModels.map(model => `\`${model.id}\``).join(', ')} | Features, tests, SQL, deploy |
| Deep 🧠 | ${deepModels.map(model => `\`${model.id}\``).join(', ')} | Security, architecture, design |

**Rules:**
- Keywords "quick"/"briefly" → fast tier, low effort
- Keywords "thorough"/"full audit" → deep tier, high effort
- \`/security\`, \`/review\`, architecture → \`${thinkingModels[0]?.id}\`, high effort
- \`/add-feature\`, \`/test\` → \`${thinkingModels.find(model => model.tier === 'balanced')?.id || balancedModels[0]?.id}\`, medium effort
- \`/sql\`, \`/deploy\` → \`${models.find(model => model.family === 'gpt-5' && model.tier === 'balanced')?.id || balancedModels[0]?.id}\`, medium effort
- Production context detected → bump effort +1 level

Use \`/model list\` to see all models. Use \`/model deep|fast|balanced|max\` to override.`;

  const autoRegex = /## 🤖 Model Auto-Selection[\s\S]*?(?=\n---\n\n## 🌿 Branch-Aware Model Selection|$)/;
  let updated = content.match(autoRegex) ? content.replace(autoRegex, autoSection) : `${content.trim()}\n\n---\n\n${autoSection}`;

  if (!updated.includes('## 🌿 Branch-Aware Model Selection')) {
    updated = `${updated.trim()}\n\n---\n\n${BRANCH_AWARE_SECTION}\n`;
  }

  return updated;
}

async function main() {
  let rawModels;
  try {
    rawModels = await fetchModels();
  } catch (error) {
    console.error(`  ✖  Failed to fetch models: ${error.message}`);
    process.exit(1);
  }

  if (JSON_DUMP) {
    console.log(JSON.stringify(rawModels, null, 2));
    return;
  }

  const models = rawModels.map(categorize).filter(Boolean);
  const fetchedAt = `${new Date().toISOString().replace('T', ' ').substring(0, 16)} UTC`;
  const deep = models.filter(model => model.tier === 'deep');
  const balanced = models.filter(model => model.tier === 'balanced');
  const fast = models.filter(model => model.tier === 'fast');
  const thinking = models.filter(model => model.thinking);
  const branchRecommendation = getBranchTier(models);

  console.log(`  Found ${C.bold(models.length)} active models:`);
  console.log(`  ${C.blue('Deep    ')} (${deep.length}): ${deep.map(model => model.id).join(', ')}`);
  console.log(`  ${C.cyan('Balanced')} (${balanced.length}): ${balanced.map(model => model.id).join(', ')}`);
  console.log(`  ${C.green('Fast    ')} (${fast.length}): ${fast.map(model => model.id).join(', ')}`);
  console.log(`  ${C.yellow('Thinking')} (${thinking.length}): ${thinking.map(model => model.id).join(', ')}`);
  console.log('');
  console.log(`  ${C.bold('Branch recommendation:')} ${branchRecommendation.branch} → ${branchRecommendation.tier}/${branchRecommendation.effort}`);
  console.log(`  ${C.dim(`  ${branchRecommendation.model?.id || 'n/a'} — ${branchRecommendation.reason}`)}`);
  console.log('');

  if (DRY_RUN) {
    console.log(C.yellow('  --dry-run: no files written\n'));
    console.log(generateMarkdown(models, fetchedAt));
    return;
  }

  writeFileSync(resolve(ROOT, 'instructions/model-selection.md'), generateMarkdown(models, fetchedAt));
  console.log(`  ${C.green('✔')} instructions/model-selection.md updated`);

  writeFileSync(
    resolve(ROOT, '.ghostforge-models.json'),
    JSON.stringify(
      {
        syncedAt: fetchedAt,
        count: models.length,
        branchRecommendation: {
          branch: branchRecommendation.branch,
          tier: branchRecommendation.tier,
          effort: branchRecommendation.effort,
          model: branchRecommendation.model?.id || null,
          reason: branchRecommendation.reason
        },
        models: models.map(({ id, family, tier, thinking, vision, maxCtx, bestFor }) => ({ id, family, tier, thinking, vision, maxCtx, bestFor }))
      },
      null,
      2
    )
  );
  console.log(`  ${C.green('✔')} .ghostforge-models.json cache saved`);

  const updatedInstructions = updateCopilotInstructions(models);
  if (updatedInstructions) {
    writeFileSync(resolve(ROOT, '.github/copilot-instructions.md'), updatedInstructions);
    console.log(`  ${C.green('✔')} .github/copilot-instructions.md model section updated`);
  }

  console.log('');
  console.log(`  ${C.green(C.bold('✅ Model sync complete!'))} Run again any time after plan changes.`);
  console.log(`  ${C.dim('  Or it runs automatically via .github/workflows/sync-models.yml (weekly)')}\n`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
