function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeLLMFitCLI(payload, hardwareFallback = {}) {
  const sourceModels = Array.isArray(payload?.models) ? payload.models : [];
  const system = payload?.system || {};
  const ramGB = numeric(system.total_ram_gb, numeric(hardwareFallback.ramGB, 8));
  const reportedAvailableGB = numeric(system.available_ram_gb, numeric(hardwareFallback.availableGB));
  const availableGB = system.unified_memory
    ? Math.max(reportedAvailableGB, ramGB - 4)
    : reportedAvailableGB || Math.max(2, ramGB - 4);
  const hardware = {
    cpuBrand: system.cpu_name || hardwareFallback.cpuBrand || 'Unknown CPU',
    ramGB: Math.round(ramGB),
    availableGB: Math.round(availableGB * 10) / 10,
  };

  const models = sourceModels.map((model, index) => {
    const ramRequired = numeric(model.memory_required_gb, numeric(model.total_memory_gb));
    const score = Math.round(numeric(model.score));
    const fitLabel = String(model.fit_level || model.fit_label || '').toLowerCase();
    const canRun = !['marginal', 'too large', 'insufficient'].includes(fitLabel);

    return {
      id: model.ollama_name || model.name || `model-${index + 1}`,
      name: model.name || model.ollama_name || `Model ${index + 1}`,
      params: numeric(model.params_b, parseFloat(model.parameter_count) || 0),
      ramGB: Math.round(ramRequired * 10) / 10,
      compositeScore: canRun ? score : 0,
      recommendation: index === 0 && canRun ? 'best' : score >= 75 && canRun ? 'good' : canRun ? 'ok' : 'too-large',
      isInstalled: Boolean(model.installed),
      canRun,
      runtime: model.runtime_label || model.runtime || 'local',
      estimatedTps: model.estimated_tps || null,
      pullable: Boolean(model.ollama_name),
    };
  });

  const best = models.find(model => model.canRun) || null;
  const bestInstalled = models.find(model => model.canRun && model.isInstalled && model.pullable) || null;
  const pullFirst = models.find(model => model.canRun && model.pullable && !model.isInstalled) || null;

  return {
    hardware,
    models,
    recommendation: {
      best: best?.id || null,
      bestInstalled: bestInstalled?.id || null,
      pullFirst: pullFirst?.id || null,
      summary: bestInstalled
        ? `Best available now: ${bestInstalled.name}`
        : best
          ? `Best fit: ${best.name} via ${best.runtime}`
          : 'No compatible local model found.',
    },
    source: 'llmfit-cli',
  };
}
