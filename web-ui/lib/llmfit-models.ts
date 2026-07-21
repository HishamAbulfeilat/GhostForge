/**
 * GhostForge LLMFit Integration
 * Hardware-aware model scorer inspired by github.com/AlexsJones/llmfit
 * Scores models on: fit (RAM), quality (params), speed (size), context window
 * Auto-detects Apple Silicon, reads RAM, lists installed Ollama models.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ── Model database (llmfit-inspired, Ollama-compatible) ───────────────────────
// RAM estimates at Q4_K_M quantization (0.5 bytes/param + overhead)
export interface ModelSpec {
  id: string           // ollama pull name
  name: string
  provider: string
  params: number       // billions
  ramGB: number        // estimated RAM needed (Q4_K_M)
  contextK: number     // context window (thousands of tokens)
  useCase: string
  qualityScore: number // 0-100, subjective quality rating
  tags: string[]
  recommended?: boolean
}

export const MODEL_DATABASE: ModelSpec[] = [
  // ── Qwen 2.5 Coder series (best coding models) ──
  { id: 'qwen2.5-coder:1.5b', name: 'Qwen2.5-Coder 1.5B', provider: 'Alibaba', params: 1.5, ramGB: 1.0, contextK: 32, useCase: 'Code (fast)', qualityScore: 55, tags: ['code', 'fast', 'tiny'] },
  { id: 'qwen2.5-coder:7b',   name: 'Qwen2.5-Coder 7B',   provider: 'Alibaba', params: 7.6, ramGB: 4.7, contextK: 32, useCase: 'Code generation', qualityScore: 78, tags: ['code', 'balanced'], recommended: true },
  { id: 'qwen2.5-coder:14b',  name: 'Qwen2.5-Coder 14B',  provider: 'Alibaba', params: 14.8, ramGB: 9.0, contextK: 32, useCase: 'Code (best local)', qualityScore: 87, tags: ['code', 'high-quality'] },
  { id: 'qwen2.5-coder:32b',  name: 'Qwen2.5-Coder 32B',  provider: 'Alibaba', params: 32.8, ramGB: 19.5, contextK: 32, useCase: 'Code (max quality)', qualityScore: 93, tags: ['code', 'large'] },

  // ── Qwen 2.5 general ──
  { id: 'qwen2.5:7b',   name: 'Qwen2.5 7B',   provider: 'Alibaba', params: 7.6,  ramGB: 4.7,  contextK: 32,  useCase: 'General chat', qualityScore: 75, tags: ['general', 'balanced'] },
  { id: 'qwen2.5:14b',  name: 'Qwen2.5 14B',  provider: 'Alibaba', params: 14.8, ramGB: 9.0,  contextK: 128, useCase: 'General (high quality)', qualityScore: 85, tags: ['general', 'high-quality'] },
  { id: 'qwen2.5:32b',  name: 'Qwen2.5 32B',  provider: 'Alibaba', params: 32.8, ramGB: 19.5, contextK: 128, useCase: 'General (best)', qualityScore: 92, tags: ['general', 'large'] },

  // ── Qwen3 series ──
  { id: 'qwen3:8b',  name: 'Qwen3 8B',  provider: 'Alibaba', params: 8.2,  ramGB: 5.2,  contextK: 40, useCase: 'General (latest)', qualityScore: 80, tags: ['general', 'latest'] },
  { id: 'qwen3:14b', name: 'Qwen3 14B', provider: 'Alibaba', params: 14.8, ramGB: 9.0,  contextK: 40, useCase: 'General (latest, high)', qualityScore: 88, tags: ['general', 'latest', 'high-quality'] },
  { id: 'qwen3:30b-a3b', name: 'Qwen3 30B MoE', provider: 'Alibaba', params: 30.5, ramGB: 11.0, contextK: 40, useCase: 'General (MoE efficient)', qualityScore: 90, tags: ['general', 'moe', 'efficient'] },

  // ── Llama series ──
  { id: 'llama3.2:3b',   name: 'Llama 3.2 3B',   provider: 'Meta', params: 3.2,  ramGB: 2.0,  contextK: 128, useCase: 'Fast chat', qualityScore: 60, tags: ['general', 'tiny', 'fast'] },
  { id: 'llama3.2:1b',   name: 'Llama 3.2 1B',   provider: 'Meta', params: 1.2,  ramGB: 0.9,  contextK: 128, useCase: 'Ultra-fast', qualityScore: 45, tags: ['general', 'tiny'] },
  { id: 'llama3.1:8b',   name: 'Llama 3.1 8B',   provider: 'Meta', params: 8.0,  ramGB: 5.0,  contextK: 128, useCase: 'General chat', qualityScore: 74, tags: ['general', 'balanced'] },
  { id: 'llama3.3:70b',  name: 'Llama 3.3 70B',  provider: 'Meta', params: 70.6, ramGB: 43.0, contextK: 128, useCase: 'High quality (large)', qualityScore: 94, tags: ['general', 'xlarge'] },

  // ── Mistral series ──
  { id: 'mistral:7b',       name: 'Mistral 7B',      provider: 'Mistral', params: 7.2,  ramGB: 4.5, contextK: 32,  useCase: 'Fast general', qualityScore: 72, tags: ['general', 'balanced'] },
  { id: 'mistral-nemo:12b', name: 'Mistral Nemo 12B', provider: 'Mistral', params: 12.2, ramGB: 7.5, contextK: 128, useCase: 'General (long context)', qualityScore: 81, tags: ['general', 'long-context'] },

  // ── DeepSeek series (Ollama local) ──
  { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2 16B', provider: 'DeepSeek', params: 16.0, ramGB: 10.0, contextK: 128, useCase: 'Code (MoE)', qualityScore: 85, tags: ['code', 'moe'] },
  { id: 'deepseek-r1:8b',        name: 'DeepSeek R1 8B',         provider: 'DeepSeek', params: 8.0,  ramGB: 5.0,  contextK: 128, useCase: 'Reasoning', qualityScore: 82, tags: ['reasoning'] },
  { id: 'deepseek-r1:14b',       name: 'DeepSeek R1 14B',        provider: 'DeepSeek', params: 14.0, ramGB: 8.7,  contextK: 128, useCase: 'Reasoning (high)', qualityScore: 88, tags: ['reasoning', 'high-quality'] },
  { id: 'deepseek-r1:32b',       name: 'DeepSeek R1 32B',        provider: 'DeepSeek', params: 32.0, ramGB: 19.0, contextK: 128, useCase: 'Reasoning (best local)', qualityScore: 93, tags: ['reasoning', 'large'] },

  // ── Phi series ──
  { id: 'phi4:14b',      name: 'Phi-4 14B',      provider: 'Microsoft', params: 14.7, ramGB: 9.0, contextK: 16, useCase: 'STEM, reasoning', qualityScore: 84, tags: ['reasoning', 'stem'] },
  { id: 'phi3:3.8b',     name: 'Phi-3 3.8B',     provider: 'Microsoft', params: 3.8,  ramGB: 2.4, contextK: 4,  useCase: 'Fast reasoning', qualityScore: 63, tags: ['reasoning', 'fast'] },
  { id: 'phi3.5:3.8b',   name: 'Phi-3.5 3.8B',   provider: 'Microsoft', params: 3.8,  ramGB: 2.4, contextK: 128, useCase: 'Fast reasoning (long ctx)', qualityScore: 67, tags: ['reasoning', 'fast'] },

  // ── Gemma series ──
  { id: 'gemma3:4b',   name: 'Gemma 3 4B',    provider: 'Google', params: 4.0,  ramGB: 2.5, contextK: 128, useCase: 'Multimodal (vision)', qualityScore: 70, tags: ['general', 'vision'] },
  { id: 'gemma3:12b',  name: 'Gemma 3 12B',   provider: 'Google', params: 12.0, ramGB: 7.5, contextK: 128, useCase: 'General (vision)', qualityScore: 80, tags: ['general', 'vision'] },
  { id: 'gemma3:27b',  name: 'Gemma 3 27B',   provider: 'Google', params: 27.0, ramGB: 16.5, contextK: 128, useCase: 'High quality (vision)', qualityScore: 90, tags: ['general', 'vision', 'large'] },

  // ── JARVIS optimized ──
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B (current)', provider: 'Meta', params: 3.2, ramGB: 2.0, contextK: 128, useCase: 'JARVIS default (fast)', qualityScore: 60, tags: ['general', 'jarvis', 'fast'] },
]

// ── Hardware detection ────────────────────────────────────────────────────────

interface HardwareInfo {
  ramGB: number
  cpuBrand: string
  isAppleSilicon: boolean
  gpuSharedMemoryGB: number  // Apple Silicon shares RAM with GPU
  availableGB: number        // estimated available for LLM
  ollamaModels: string[]     // currently installed
}

export async function detectHardware(): Promise<HardwareInfo> {
  const [memResult, cpuResult, ollamaResult] = await Promise.allSettled([
    execAsync('sysctl hw.memsize'),
    execAsync('sysctl -n machdep.cpu.brand_string'),
    execAsync('ollama list 2>/dev/null'),
  ])

  const memOutput = memResult.status === 'fulfilled' ? memResult.value.stdout : ''
  const cpuOutput = cpuResult.status === 'fulfilled' ? cpuResult.value.stdout.trim() : 'Unknown'
  const ollamaOutput = ollamaResult.status === 'fulfilled' ? ollamaResult.value.stdout : ''

  const memMatch = memOutput.match(/(\d+)/)
  const ramGB = memMatch ? Math.round(parseInt(memMatch[1]) / (1024 ** 3)) : 8

  const isAppleSilicon = cpuOutput.toLowerCase().includes('apple m')

  // Parse installed Ollama models
  const ollamaModels = ollamaOutput.split('\n')
    .slice(1) // skip header
    .map(l => l.split(/\s+/)[0])
    .filter(Boolean)
    .filter(m => m !== 'NAME')

  // Available RAM: Apple Silicon uses unified memory, leave 4GB for OS
  const availableGB = Math.max(2, ramGB - 4)

  return {
    ramGB,
    cpuBrand: cpuOutput,
    isAppleSilicon,
    gpuSharedMemoryGB: isAppleSilicon ? ramGB : 0,
    availableGB,
    ollamaModels,
  }
}

// ── Scoring algorithm (llmfit-inspired) ──────────────────────────────────────

export interface ScoredModel extends ModelSpec {
  fitScore: number       // 0-100: will it run without swapping?
  speedScore: number     // 0-100: relative speed estimate
  compositeScore: number // weighted final score
  canRun: boolean        // fits in available RAM
  isInstalled: boolean   // already pulled in Ollama
  recommendation: 'best' | 'good' | 'ok' | 'too-large'
  ramUsagePercent: number
}

export function scoreModels(models: ModelSpec[], hw: HardwareInfo): ScoredModel[] {
  const maxParams = Math.max(...models.map(m => m.params))

  return models.map(model => {
    const canRun = model.ramGB <= hw.availableGB
    const ramUsagePercent = Math.round((model.ramGB / hw.availableGB) * 100)

    // Fit score: higher = uses less RAM (leaves room for OS + other apps)
    // Ideal: use 30-60% of available RAM
    let fitScore: number
    if (ramUsagePercent <= 30) fitScore = 75  // tiny, too small
    else if (ramUsagePercent <= 60) fitScore = 100  // sweet spot
    else if (ramUsagePercent <= 80) fitScore = 80   // tight but ok
    else if (ramUsagePercent <= 100) fitScore = 40  // will swap
    else fitScore = 0  // cannot run

    // Speed score: smaller = faster tokens/sec on local hardware
    const speedScore = Math.round(100 * (1 - model.params / maxParams))

    // Apple Silicon bonus: unified memory means GPU benefits from all RAM
    const appleSiliconBonus = hw.isAppleSilicon ? 15 : 0

    // Composite: fit(40%) + quality(35%) + speed(15%) + apple bonus(10%)
    const compositeScore = canRun
      ? Math.min(100, Math.round(
          fitScore * 0.40 +
          model.qualityScore * 0.35 +
          speedScore * 0.15 +
          appleSiliconBonus
        ))
      : 0

    const isInstalled = hw.ollamaModels.some(m =>
      m.split(':')[0] === model.id.split(':')[0] &&
      (m.split(':')[1] || 'latest') === (model.id.split(':')[1] || 'latest')
    )

    let recommendation: ScoredModel['recommendation']
    if (!canRun) recommendation = 'too-large'
    else if (compositeScore >= 80) recommendation = 'best'
    else if (compositeScore >= 65) recommendation = 'good'
    else recommendation = 'ok'

    return {
      ...model,
      fitScore,
      speedScore,
      compositeScore,
      canRun,
      isInstalled,
      recommendation,
      ramUsagePercent,
    }
  })
}

// ── Try calling llmfit CLI if installed ───────────────────────────────────────

export async function tryLLMFitCLI(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('llmfit --provider ollama --json 2>/dev/null', { timeout: 10000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}
