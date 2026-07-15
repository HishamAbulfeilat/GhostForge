import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as z from 'zod/v4';

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
    'Return the best recommended model for security, feature, sql, or quick tasks.',
    {
      taskType: z.enum(['security', 'feature', 'sql', 'quick']).describe('Task type to optimize for')
    },
    async ({ taskType }) => {
      const cache = readModelCache(repoRoot);
      const recommendation = selectBestModel(cache.models, taskType);

      return asToolResult({
        taskType,
        recommendation: recommendation.model,
        effort: recommendation.effort,
        rationale: recommendation.model?.bestFor ?? 'Best available fallback model'
      });
    }
  );
}
