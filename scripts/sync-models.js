#!/usr/bin/env node
/**
 * sync-models.js — Auto-sync Copilot Business plan models
 *
 * Queries the live GitHub Copilot API, reads actual enabled models
 * and their capabilities, then rewrites instructions/model-selection.md
 * and the model section of .github/copilot-instructions.md.
 *
 * Usage:
 *   node scripts/sync-models.js
 *   node scripts/sync-models.js --dry-run   (print only, no file writes)
 *   node scripts/sync-models.js --json      (dump raw model JSON)
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const DRY_RUN   = process.argv.includes('--dry-run');
const JSON_DUMP = process.argv.includes('--json');

// ── ANSI colors ────────────────────────────────────────────────
const C = {
  blue:   s => `\x1b[34m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

console.log('');
console.log(C.blue(C.bold('  GhostForge AI Toolkit — Model Sync')));
console.log(C.dim('  Querying GitHub Copilot API...\n'));

// ── Get GitHub token via gh CLI ────────────────────────────────
let TOKEN;
try {
  TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
} catch {
  console.error('  ✖  gh CLI not authenticated. Run: gh auth login');
  process.exit(1);
}

// ── Fetch models from Copilot API ─────────────────────────────
async function fetchModels() {
  const res = await fetch('https://api.githubcopilot.com/models', {
    headers: {
      'Authorization':           `Bearer ${TOKEN}`,
      'Copilot-Integration-Id':  'vscode-chat',
      'Editor-Version':          'vscode/1.90.0',
    },
  });
  if (!res.ok) throw new Error(`API returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

// ── Categorize a model ────────────────────────────────────────
function categorize(model) {
  const id  = model.id.toLowerCase();
  const cap = model.capabilities || {};
  const sup = cap.supports || {};
  const lim = cap.limits   || {};

  const thinking   = !!sup.adaptive_thinking;
  const vision     = !!lim.vision;
  const maxCtx     = lim.max_context_window_tokens || 0;
  const maxOut     = lim.max_output_tokens || lim.max_non_streaming_output_tokens || 0;
  const thinkBudg  = sup.max_thinking_budget || 0;

  // Skip embeddings and utility models
  const skip = ['embedding', 'trajectory', 'text-embedding', 'gpt-3.5', 'gpt-4-0613',
                 'gpt-4o-preview', 'gpt-4-o-preview'].some(x => id.includes(x));
  if (skip) return null;

  // Determine family
  let family = 'other';
  let tier   = 'balanced';
  let speed  = '⚡⚡';

  if (id.includes('claude-opus'))   { family = 'claude-opus';   tier = 'deep'; speed = '⚡'; }
  else if (id.includes('claude-sonnet')) { family = 'claude-sonnet'; tier = 'balanced'; speed = '⚡⚡'; }
  else if (id.includes('claude-haiku'))  { family = 'claude-haiku';  tier = 'fast'; speed = '⚡⚡⚡'; }
  else if (id.startsWith('gpt-5'))       { family = 'gpt-5';         tier = id.includes('mini') ? 'fast' : 'balanced'; speed = id.includes('mini') ? '⚡⚡⚡' : '⚡⚡'; }
  else if (id.startsWith('gpt-4.1'))     { family = 'gpt-4.1';       tier = 'balanced'; speed = '⚡⚡'; }
  else if (id.startsWith('gpt-4o'))      { family = 'gpt-4o';        tier = 'balanced'; speed = '⚡⚡'; }
  else if (id.includes('gemini-3.1') || id.includes('gemini-3-'))  { family = 'gemini-3'; tier = id.includes('flash') ? 'fast' : 'balanced'; speed = id.includes('flash') ? '⚡⚡⚡' : '⚡⚡'; }
  else if (id.includes('gemini-2.5'))    { family = 'gemini-2.5';    tier = 'balanced'; speed = '⚡⚡'; }
  else if (id.includes('codex'))         { family = 'codex';          tier = 'balanced'; speed = '⚡⚡'; }

  // Best-for descriptions
  const bestFor = {
    'claude-opus':   'Security, architecture, deep analysis, system design',
    'claude-sonnet': 'Features, testing, refactoring, CMS, reliable code gen',
    'claude-haiku':  'Quick edits, explanations, simple tasks',
    'gpt-5':         id.includes('mini') ? 'Commit messages, lint, formatting' : 'SQL, APIs, structured output, deployments',
    'gpt-4.1':       'Code generation, general tasks',
    'gpt-4o':        'General code gen, legacy support',
    'gemini-3':      id.includes('flash') ? 'Rapid Q&A, fast completions' : 'Large codebase analysis, documentation',
    'gemini-2.5':    'Multimodal, diagrams, visual tasks',
    'codex':         'Pure code generation, completion',
    'other':         'General purpose',
  }[family] || 'General purpose';

  return { id, family, tier, speed, thinking, vision, maxCtx, maxOut, thinkBudg, bestFor };
}

// ── Generate model-selection.md ────────────────────────────────
function generateMarkdown(models, fetchedAt) {
  const tiers = {
    deep:     models.filter(m => m.tier === 'deep'),
    balanced: models.filter(m => m.tier === 'balanced'),
    fast:     models.filter(m => m.tier === 'fast'),
  };

  const thinkingModels = models.filter(m => m.thinking);
  const visionModels   = models.filter(m => m.vision);

  const fmtCtx = n => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}k` : `${n}`;
  const row = m =>
    `| \`${m.id}\` | ${m.speed} | ${m.thinking ? '🧠' : '  '} ${m.vision ? '👁' : '  '} | ${fmtCtx(m.maxCtx)} | ${m.bestFor} |`;

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
| \`/lint\`, \`/commit\`, \`/pr-description\` | \`${tiers.fast.find(m => m.family === 'gpt-5')?.id || tiers.fast[0]?.id}\` | low |
| \`/add-feature\`, \`/scaffold\`, \`/test\` | \`${thinkingModels.find(m => m.tier === 'balanced')?.id || tiers.balanced[0]?.id}\` | medium |
| \`/optimize\`, \`/refactor\`, CMS | \`${thinkingModels.find(m => m.tier === 'balanced')?.id || tiers.balanced[0]?.id}\` | medium |
| \`/sql\`, \`/deploy\`, \`/release\` | \`${tiers.balanced.find(m => m.family === 'gpt-5')?.id || tiers.balanced[0]?.id}\` | medium |
| Large codebase, \`/docs\` | \`${tiers.balanced.find(m => m.family.includes('gemini'))?.id || tiers.balanced[0]?.id}\` | medium |
| \`/security\`, \`/review\` | \`${thinkingModels[0]?.id || tiers.deep[0]?.id}\` | high |
| \`/fix-tickets --critical\` | \`${thinkingModels[1]?.id || tiers.deep[1]?.id || tiers.deep[0]?.id}\` | high |
| Architecture, system design | \`${thinkingModels[0]?.id || tiers.deep[0]?.id}\` | max |

---

## 🧠 Thinking-Capable Models (${thinkingModels.length})

${thinkingModels.map(m => `- \`${m.id}\` — budget up to ${fmtCtx(m.thinkBudg)} tokens`).join('\n')}

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
    "default":      "${thinkingModels.find(m => m.tier === 'balanced')?.id || tiers.balanced[0]?.id}",
    "security":     "${thinkingModels[0]?.id || tiers.deep[0]?.id}",
    "architecture": "${thinkingModels[0]?.id || tiers.deep[0]?.id}",
    "quickTasks":   "${tiers.fast[0]?.id}",
    "sql":          "${tiers.balanced.find(m => m.family === 'gpt-5')?.id || tiers.balanced[0]?.id}",
    "docs":         "${tiers.balanced.find(m => m.family.includes('gemini'))?.id || tiers.balanced[0]?.id}",
    "effort": {
      "default":    "medium",
      "production": "high",
      "quick":      "low"
    }
  }
}
\`\`\`
`;
}

// ── Update copilot-instructions.md model section ───────────────
function updateCopilotInstructions(models) {
  const path = resolve(ROOT, '.github/copilot-instructions.md');
  if (!existsSync(path)) return;

  let content = readFileSync(path, 'utf8');

  const thinkingModels = models.filter(m => m.thinking);
  const fastModels     = models.filter(m => m.tier === 'fast').slice(0, 3);
  const balancedModels = models.filter(m => m.tier === 'balanced').slice(0, 4);
  const deepModels     = models.filter(m => m.tier === 'deep').slice(0, 3);

  const section = `
---

## 🤖 Model Auto-Selection (auto-synced ${new Date().toISOString().split('T')[0]})

Auto-select best model based on task. Available tiers:

| Tier | Models | Use For |
|------|--------|---------|
| Fast | ${fastModels.map(m => `\`${m.id}\``).join(', ')} | Quick tasks, lint, commit |
| Balanced | ${balancedModels.map(m => `\`${m.id}\``).join(', ')} | Features, tests, SQL, deploy |
| Deep 🧠 | ${deepModels.map(m => `\`${m.id}\``).join(', ')} | Security, architecture, design |

**Rules:**
- Keywords "quick"/"briefly" → fast tier, low effort
- Keywords "thorough"/"full audit" → deep tier, high effort  
- \`/security\`, \`/review\`, architecture → \`${thinkingModels[0]?.id}\`, high effort
- \`/add-feature\`, \`/test\` → \`${thinkingModels.find(m => m.tier === 'balanced')?.id || balancedModels[0]?.id}\`, medium effort
- \`/sql\`, \`/deploy\` → \`${models.find(m => m.family === 'gpt-5' && m.tier === 'balanced')?.id || balancedModels[0]?.id}\`, medium effort
- Production context detected → bump effort +1 level

Use \`/model list\` to see all models. Use \`/model deep|fast|balanced|max\` to override.`;

  // Replace existing auto-synced section or append
  const marker = '## 🤖 Model Auto-Selection';
  const idx = content.indexOf(marker);
  if (idx !== -1) {
    // Remove everything from the marker to end
    content = content.substring(0, content.lastIndexOf('\n---\n\n' + marker)) + section;
  } else {
    content = content + section;
  }

  return content;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  let rawModels;
  try {
    rawModels = await fetchModels();
  } catch (e) {
    console.error(`  ✖  Failed to fetch models: ${e.message}`);
    process.exit(1);
  }

  if (JSON_DUMP) {
    console.log(JSON.stringify(rawModels, null, 2));
    return;
  }

  // Categorize and filter
  const models = rawModels.map(categorize).filter(Boolean);
  const fetchedAt = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

  // Print summary
  const deep     = models.filter(m => m.tier === 'deep');
  const balanced = models.filter(m => m.tier === 'balanced');
  const fast     = models.filter(m => m.tier === 'fast');
  const thinking = models.filter(m => m.thinking);

  console.log(`  Found ${C.bold(models.length)} active models:`);
  console.log(`  ${C.blue('Deep    ')} (${deep.length}): ${deep.map(m => m.id).join(', ')}`);
  console.log(`  ${C.cyan('Balanced')} (${balanced.length}): ${balanced.map(m => m.id).join(', ')}`);
  console.log(`  ${C.green('Fast    ')} (${fast.length}): ${fast.map(m => m.id).join(', ')}`);
  console.log(`  ${C.yellow('Thinking')} (${thinking.length}): ${thinking.map(m => m.id).join(', ')}`);
  console.log('');

  if (DRY_RUN) {
    console.log(C.yellow('  --dry-run: no files written\n'));
    console.log(generateMarkdown(models, fetchedAt));
    return;
  }

  // Write model-selection.md
  const mdPath = resolve(ROOT, 'instructions/model-selection.md');
  writeFileSync(mdPath, generateMarkdown(models, fetchedAt));
  console.log(`  ${C.green('✔')} instructions/model-selection.md updated`);

  // Save raw model data as cache
  const cachePath = resolve(ROOT, '.ghostforge-models.json');
  writeFileSync(cachePath, JSON.stringify({
    syncedAt: fetchedAt,
    count: models.length,
    models: models.map(({ id, family, tier, thinking, vision, maxCtx, bestFor }) =>
      ({ id, family, tier, thinking, vision, maxCtx, bestFor }))
  }, null, 2));
  console.log(`  ${C.green('✔')} .ghostforge-models.json cache saved`);

  // Update copilot-instructions.md
  const updatedInstructions = updateCopilotInstructions(models);
  if (updatedInstructions) {
    writeFileSync(resolve(ROOT, '.github/copilot-instructions.md'), updatedInstructions);
    console.log(`  ${C.green('✔')} .github/copilot-instructions.md model section updated`);
  }

  console.log('');
  console.log(`  ${C.green(C.bold('✅ Model sync complete!'))} Run again any time after plan changes.`);
  console.log(`  ${C.dim('  Or it runs automatically via .github/workflows/sync-models.yml (weekly)')}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
