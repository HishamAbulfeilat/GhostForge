import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as z from 'zod/v4';
import { classifyTask, KIND_TIER } from '../../scripts/agents/lib/models.mjs';

// Tier (shared with the agent team's router) → this tool's task buckets.
const TIER_TO_TASK = { deep: 'security', balanced: 'feature', fast: 'quick' };

/**
 * `auto`: classify a free-text task description and pick the matching bucket,
 * so callers don't have to know the task type up front.
 */
export function resolveTaskType(taskType, description = '') {
  if (taskType && taskType !== 'auto') return taskType;
  if (/\b(sql|query|schema|etl|migration|database)\b/i.test(description)) return 'sql';
  return TIER_TO_TASK[KIND_TIER[classifyTask(description)]] ?? 'feature';
}

export function readModelCache(repoRoot) {
  const cachePath = resolve(repoRoot, '.ghostforge-models.json');
  if (!existsSync(cachePath)) {
    throw new Error('Model cache .ghostforge-models.json not found. Run node scripts/sync-models.js first.');
  }

  return JSON.parse(readFileSync(cachePath, 'utf8'));
}

export function selectBestModel(models, taskType) {
  const normalized = (taskType || '').toLowerCase();

  const findById = modelId => models.find(model => model.id === modelId);
  const firstBy = predicate => models.find(predicate);

  const mapping = {
    security: {
      model: findById('claude-opus-4.8') ?? firstBy(model => model.tier === 'deep' && model.thinking) ?? firstBy(model => model.tier === 'deep'),
      effort: 'high'
    },
    feature: {
      model: findById('claude-sonnet-4.6') ?? firstBy(model => model.tier === 'balanced' && model.thinking) ?? firstBy(model => model.tier === 'balanced'),
      effort: 'medium'
    },
    sql: {
      model: findById('gpt-5.3-codex') ?? firstBy(model => model.family === 'gpt-5' && model.tier === 'balanced') ?? firstBy(model => model.tier === 'balanced'),
      effort: 'medium'
    },
    quick: {
      model: findById('gpt-5-mini') ?? firstBy(model => model.tier === 'fast') ?? models[0],
      effort: 'low'
    }
  };

  return mapping[normalized] ?? mapping.feature;
}

function asToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

export function registerModelTools(server, { repoRoot }) {
  server.tool(
    'list_models',
    'List available Copilot Business models from the GhostForge cache, optionally filtered by tier.',
    {
      tier: z.enum(['deep', 'balanced', 'fast']).optional().describe('Optional model tier filter')
    },
    async ({ tier }) => {
      const cache = readModelCache(repoRoot);
      const models = tier ? cache.models.filter(model => model.tier === tier) : cache.models;

      return asToolResult({
        syncedAt: cache.syncedAt,
        count: models.length,
        tier: tier ?? 'all',
        models
      });
    }
  );

  server.tool(
    'get_best_model',
    'Return the best recommended model for a task. taskType "auto" (default) classifies `description` and picks for you; or pass security, feature, sql, or quick.',
    {
      taskType: z.enum(['auto', 'security', 'feature', 'sql', 'quick']).default('auto').describe('Task type to optimize for; "auto" infers it from description'),
      description: z.string().optional().describe('What the task is — used when taskType is "auto"')
    },
    async ({ taskType, description }) => {
      const cache = readModelCache(repoRoot);
      const resolved = resolveTaskType(taskType, description);
      const recommendation = selectBestModel(cache.models, resolved);

      return asToolResult({
        taskType: resolved,
        requested: taskType,
        recommendation: recommendation.model,
        effort: recommendation.effort,
        rationale: recommendation.model?.bestFor ?? 'Best available fallback model'
      });
    }
  );
}
