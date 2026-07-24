export type RunnerId = 'ollama' | 'llamafile' | 'lm-studio' | 'jan'
export type LLMFitTier = 'recommended' | 'good' | 'standard'

export interface LocalModel {
  id: string
  runner: RunnerId
  name: string
  size: string
  sizeGB: number
  description: string
  contextLength: string
  llmfit: LLMFitTier
  recommended?: boolean
  installCommand?: string
  externalUrl?: string
}

export interface RunnerMeta {
  id: RunnerId
  label: string
  accent: string
  installLabel: string
  helperText: string
}

export const RUNNER_META: Record<RunnerId, RunnerMeta> = {
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    accent: '#3b82f6',
    installLabel: 'Install via Ollama',
    helperText: 'One-command local installs with ollama pull',
  },
  llamafile: {
    id: 'llamafile',
    label: 'llamafile',
    accent: '#22d3ee',
    installLabel: 'Download llamafile',
    helperText: 'Standalone local executables from Mozilla + Hugging Face',
  },
  'lm-studio': {
    id: 'lm-studio',
    label: 'LM Studio',
    accent: '#60a5fa',
    installLabel: 'Open LM Studio',
    helperText: 'Browse and install models inside LM Studio',
  },
  jan: {
    id: 'jan',
    label: 'Jan.ai',
    accent: '#38bdf8',
    installLabel: 'Open Jan.ai',
    helperText: 'Desktop local AI workspace with one-click model pulls',
  },
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'qwen3.5:9b',
    runner: 'ollama',
    name: 'qwen3.5:9b',
    size: '6.6GB',
    sizeGB: 6.6,
    description: 'Recommended JARVIS default for 24GB Apple Silicon: tools, vision, reasoning, and fast responses.',
    contextLength: '256K',
    llmfit: 'recommended',
    recommended: true,
    installCommand: 'ollama pull qwen3.5:9b',
  },
  {
    id: 'qwen3.5:27b',
    runner: 'ollama',
    name: 'qwen3.5:27b',
    size: '17GB',
    sizeGB: 17,
    description: 'Maximum local quality on a 24GB Mac, but leaves less memory for computer-use tools and other apps.',
    contextLength: '256K',
    llmfit: 'good',
    installCommand: 'ollama pull qwen3.5:27b',
  },
  {
    id: 'qwen3.5:4b',
    runner: 'ollama',
    name: 'qwen3.5:4b',
    size: '3.4GB',
    sizeGB: 3.4,
    description: 'Fast offline JARVIS profile with tool use and vision support.',
    contextLength: '256K',
    llmfit: 'good',
    installCommand: 'ollama pull qwen3.5:4b',
  },
  {
    id: 'qwen3:14b',
    runner: 'ollama',
    name: 'qwen3:14b',
    size: '9.4GB',
    sizeGB: 9.4,
    description: 'Best reasoning + coding. Highest LLMFit rank for a powerful local all-rounder.',
    contextLength: '40K',
    llmfit: 'recommended',
    recommended: true,
    installCommand: 'ollama pull qwen3:14b',
  },
  {
    id: 'qwen2.5-coder:7b',
    runner: 'ollama',
    name: 'qwen2.5-coder:7b',
    size: '4.7GB',
    sizeGB: 4.7,
    description: 'Best local coder. Excellent code generation with modest RAM needs.',
    contextLength: '32K',
    llmfit: 'good',
    installCommand: 'ollama pull qwen2.5-coder:7b',
  },
  {
    id: 'qwen3:8b',
    runner: 'ollama',
    name: 'qwen3:8b',
    size: '5.2GB',
    sizeGB: 5.2,
    description: 'Fast + smart. Great balance for daily JARVIS use.',
    contextLength: '40K',
    llmfit: 'good',
    installCommand: 'ollama pull qwen3:8b',
  },
  {
    id: 'llama3.3:70b',
    runner: 'ollama',
    name: 'llama3.3:70b',
    size: '43GB',
    sizeGB: 43,
    description: 'Best quality, but only for very high RAM Macs.',
    contextLength: '128K',
    llmfit: 'standard',
    installCommand: 'ollama pull llama3.3:70b',
  },
  {
    id: 'llama3.2:3b',
    runner: 'ollama',
    name: 'llama3.2:3b',
    size: '2.0GB',
    sizeGB: 2,
    description: 'Fastest, lowest RAM option for lightweight local chat.',
    contextLength: '128K',
    llmfit: 'standard',
    installCommand: 'ollama pull llama3.2:3b',
  },
  {
    id: 'mistral:7b',
    runner: 'ollama',
    name: 'mistral:7b',
    size: '4.1GB',
    sizeGB: 4.1,
    description: 'Good general purpose model with fast local responses.',
    contextLength: '32K',
    llmfit: 'standard',
    installCommand: 'ollama pull mistral:7b',
  },
  {
    id: 'phi4:14b',
    runner: 'ollama',
    name: 'phi4:14b',
    size: '9.1GB',
    sizeGB: 9.1,
    description: 'Microsoft’s strongest compact reasoning model.',
    contextLength: '16K',
    llmfit: 'good',
    installCommand: 'ollama pull phi4:14b',
  },
  {
    id: 'deepseek-r1:7b',
    runner: 'ollama',
    name: 'deepseek-r1:7b',
    size: '4.7GB',
    sizeGB: 4.7,
    description: 'Reasoning-focused model for chain-of-thought heavy tasks.',
    contextLength: '128K',
    llmfit: 'good',
    installCommand: 'ollama pull deepseek-r1:7b',
  },
  {
    id: 'gemma3:12b',
    runner: 'ollama',
    name: 'gemma3:12b',
    size: '8.1GB',
    sizeGB: 8.1,
    description: 'Google’s local model with strong multimodal DNA.',
    contextLength: '128K',
    llmfit: 'standard',
    installCommand: 'ollama pull gemma3:12b',
  },
  {
    id: 'codellama:7b',
    runner: 'ollama',
    name: 'codellama:7b',
    size: '3.8GB',
    sizeGB: 3.8,
    description: 'Code specialist with low footprint and broad compatibility.',
    contextLength: '16K',
    llmfit: 'standard',
    installCommand: 'ollama pull codellama:7b',
  },
  {
    id: 'Llama-3.2-3B-Instruct.Q6_K.llamafile',
    runner: 'llamafile',
    name: 'Llama-3.2-3B-Instruct.Q6_K.llamafile',
    size: '2.5GB',
    sizeGB: 2.5,
    description: 'Portable low-RAM starter model in a single executable file.',
    contextLength: '128K',
    llmfit: 'recommended',
    recommended: true,
    externalUrl: 'https://huggingface.co/models?search=Llama-3.2-3B-Instruct.Q6_K.llamafile',
  },
  {
    id: 'Llama-3.2-11B-Vision-Instruct.Q6_K.llamafile',
    runner: 'llamafile',
    name: 'Llama-3.2-11B-Vision-Instruct.Q6_K.llamafile',
    size: '8.0GB',
    sizeGB: 8,
    description: 'Vision-capable llamafile for screenshots, UI, and image prompts.',
    contextLength: '128K',
    llmfit: 'good',
    externalUrl: 'https://huggingface.co/models?search=Llama-3.2-11B-Vision-Instruct.Q6_K.llamafile',
  },
  {
    id: 'Mistral-7B-Instruct-v0.2.Q5_K_M.llamafile',
    runner: 'llamafile',
    name: 'Mistral-7B-Instruct-v0.2.Q5_K_M.llamafile',
    size: '4.8GB',
    sizeGB: 4.8,
    description: 'Compact general-purpose instruct model in portable form.',
    contextLength: '32K',
    llmfit: 'good',
    externalUrl: 'https://huggingface.co/models?search=Mistral-7B-Instruct-v0.2.Q5_K_M.llamafile',
  },
  {
    id: 'Phi-3.5-mini-instruct.Q6_K.llamafile',
    runner: 'llamafile',
    name: 'Phi-3.5-mini-instruct.Q6_K.llamafile',
    size: '2.6GB',
    sizeGB: 2.6,
    description: 'Fast small reasoning model for everyday local automation.',
    contextLength: '128K',
    llmfit: 'standard',
    externalUrl: 'https://huggingface.co/models?search=Phi-3.5-mini-instruct.Q6_K.llamafile',
  },
  {
    id: 'WizardCoder-Python-34B-V1.0.Q5_K_M.llamafile',
    runner: 'llamafile',
    name: 'WizardCoder-Python-34B-V1.0.Q5_K_M.llamafile',
    size: '22GB',
    sizeGB: 22,
    description: 'Massive Python-focused coder for heavy local workstations.',
    contextLength: '16K',
    llmfit: 'standard',
    externalUrl: 'https://huggingface.co/models?search=WizardCoder-Python-34B-V1.0.Q5_K_M.llamafile',
  },
  {
    id: 'lmstudio-llama-3.3-70b',
    runner: 'lm-studio',
    name: 'Llama 3.3 70B',
    size: '43GB',
    sizeGB: 43,
    description: 'High-end flagship quality inside LM Studio.',
    contextLength: '128K',
    llmfit: 'recommended',
    recommended: true,
    externalUrl: 'https://lmstudio.ai/models',
  },
  {
    id: 'lmstudio-qwen2.5-72b',
    runner: 'lm-studio',
    name: 'Qwen2.5 72B',
    size: '44GB',
    sizeGB: 44,
    description: 'Massive coding and reasoning model from the LM Studio catalog.',
    contextLength: '128K',
    llmfit: 'good',
    externalUrl: 'https://lmstudio.ai/models',
  },
  {
    id: 'lmstudio-deepseek-r1',
    runner: 'lm-studio',
    name: 'DeepSeek R1',
    size: 'Varies',
    sizeGB: 14,
    description: 'Popular reasoning family, ideal for analytical local tasks.',
    contextLength: '128K',
    llmfit: 'good',
    externalUrl: 'https://lmstudio.ai/models',
  },
  {
    id: 'lmstudio-phi-4',
    runner: 'lm-studio',
    name: 'Phi-4',
    size: '9.1GB',
    sizeGB: 9.1,
    description: 'Strong compact reasoning option with modest memory demand.',
    contextLength: '16K',
    llmfit: 'standard',
    externalUrl: 'https://lmstudio.ai/models',
  },
  {
    id: 'lmstudio-mistral-small',
    runner: 'lm-studio',
    name: 'Mistral Small',
    size: 'Varies',
    sizeGB: 12,
    description: 'Balanced general local model with good speed-quality tradeoff.',
    contextLength: '32K',
    llmfit: 'standard',
    externalUrl: 'https://lmstudio.ai/models',
  },
  {
    id: 'jan-llama-3-8b',
    runner: 'jan',
    name: 'Llama 3 8B',
    size: '5.0GB',
    sizeGB: 5,
    description: 'Easy-start Jan.ai model for reliable local chat.',
    contextLength: '128K',
    llmfit: 'recommended',
    recommended: true,
    externalUrl: 'https://jan.ai',
  },
  {
    id: 'jan-qwen2-7b',
    runner: 'jan',
    name: 'Qwen2 7B',
    size: '4.7GB',
    sizeGB: 4.7,
    description: 'Smart compact assistant model often chosen for dev workflows.',
    contextLength: '32K',
    llmfit: 'good',
    externalUrl: 'https://jan.ai',
  },
  {
    id: 'jan-mistral-7b',
    runner: 'jan',
    name: 'Mistral 7B',
    size: '4.1GB',
    sizeGB: 4.1,
    description: 'Reliable general-purpose Jan.ai install with fast responses.',
    contextLength: '32K',
    llmfit: 'good',
    externalUrl: 'https://jan.ai',
  },
  {
    id: 'jan-gemma-2-9b',
    runner: 'jan',
    name: 'Gemma 2 9B',
    size: '5.5GB',
    sizeGB: 5.5,
    description: 'Mid-sized Google model for clean general reasoning.',
    contextLength: '32K',
    llmfit: 'standard',
    externalUrl: 'https://jan.ai',
  },
]

export function getRunnerModels(runner: RunnerId) {
  return LOCAL_MODELS.filter(model => model.runner === runner)
}

export function getRecommendedModel(runner: RunnerId) {
  return getRunnerModels(runner).find(model => model.recommended) ?? getRunnerModels(runner)[0]
}

export function getLLMFitLabel(tier: LLMFitTier) {
  if (tier === 'recommended') return '⭐ recommended'
  if (tier === 'good') return '✓ good'
  return 'standard'
}

export function getLLMFitWeight(tier: LLMFitTier) {
  if (tier === 'recommended') return 3
  if (tier === 'good') return 2
  return 1
}
