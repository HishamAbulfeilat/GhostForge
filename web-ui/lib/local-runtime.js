const MODEL_PROFILES = [
  { id: 'qwen3.5:9b', sizeGB: 6.6, quality: 96, speed: 82, tasks: ['general', 'code', 'reasoning', 'tools'], label: 'balanced' },
  { id: 'qwen3.5:27b', sizeGB: 17, quality: 100, speed: 48, tasks: ['general', 'code', 'reasoning', 'tools'], label: 'max-quality' },
  { id: 'qwen3.5:4b', sizeGB: 3.4, quality: 84, speed: 96, tasks: ['general', 'code', 'tools'], label: 'fast' },
  { id: 'qwen3:14b', sizeGB: 9.3, quality: 91, speed: 68, tasks: ['general', 'code', 'reasoning', 'tools'], label: 'balanced' },
  { id: 'qwen2.5-coder:7b', sizeGB: 4.7, quality: 88, speed: 86, tasks: ['code', 'tools'], label: 'coding' },
  { id: 'qwen3.5:2b', sizeGB: 2.7, quality: 72, speed: 100, tasks: ['general', 'tools'], label: 'ultra-fast' },
  { id: 'llama3.2:3b', sizeGB: 2, quality: 66, speed: 98, tasks: ['general', 'tools'], label: 'fallback' },
  { id: 'qwen3.5:0.8b', sizeGB: 1, quality: 55, speed: 100, tasks: ['general'], label: 'minimal' },
]

function normalizeModelName(value) {
  return String(value || '').trim().toLowerCase()
}

function getModelProfile(modelName) {
  const normalized = normalizeModelName(modelName)
  return MODEL_PROFILES.find(profile => normalizeModelName(profile.id) === normalized) || null
}

function scoreInstalledModel(modelName, ramGB, task = 'general') {
  const profile = getModelProfile(modelName)
  if (!profile) return { score: 1, fitsSafely: true, profile: null }

  const safeBudgetGB = Math.max(2, ramGB * 0.7)
  const fitsSafely = profile.sizeGB <= safeBudgetGB
  const taskBonus = profile.tasks.includes(task) ? 14 : 0
  const toolBonus = profile.tasks.includes('tools') ? 8 : 0
  const pressurePenalty = profile.sizeGB > safeBudgetGB
    ? 80
    : Math.round((profile.sizeGB / safeBudgetGB) * 14)
  const score = profile.quality + Math.round(profile.speed * 0.35) + taskBonus + toolBonus - pressurePenalty

  return { score, fitsSafely, profile }
}

function chooseBestInstalledModel(installedModels, ramGB, task = 'general') {
  const candidates = installedModels
    .map(name => ({ name, ...scoreInstalledModel(name, ramGB, task) }))
    .filter(candidate => candidate.fitsSafely)
    .sort((left, right) => right.score - left.score)

  return candidates[0] || null
}

/**
 * @param {{
 *   selectedProvider?: string,
 *   selectedModel?: string,
 *   ollamaModels?: string[],
 *   ramGB?: number,
 *   task?: string,
 *   llamaCppModel?: string,
 * }} options
 */
function buildLocalRuntimeOrder(options = {}) {
  const {
    selectedProvider,
    selectedModel,
    ollamaModels = [],
    ramGB = 8,
    task = 'general',
    llamaCppModel,
  } = options
  const order = []
  const normalizedProvider = normalizeModelName(selectedProvider)

  if (normalizedProvider === 'ollama' && selectedModel && ollamaModels.includes(selectedModel)) {
    order.push({ provider: 'ollama', model: selectedModel })
  } else if ((normalizedProvider === 'llamacpp' || normalizedProvider === 'llama.cpp') && llamaCppModel) {
    order.push({ provider: 'llamacpp', model: selectedModel || llamaCppModel })
  }

  const bestOllama = chooseBestInstalledModel(ollamaModels, ramGB, task)
  if (bestOllama && !order.some(entry => entry.provider === 'ollama' && entry.model === bestOllama.name)) {
    order.push({ provider: 'ollama', model: bestOllama.name })
  }

  if (llamaCppModel && !order.some(entry => entry.provider === 'llamacpp')) {
    order.push({ provider: 'llamacpp', model: llamaCppModel })
  }

  return order
}

module.exports = {
  MODEL_PROFILES,
  buildLocalRuntimeOrder,
  chooseBestInstalledModel,
  getModelProfile,
  normalizeModelName,
  scoreInstalledModel,
}
