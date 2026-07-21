import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type CoreMessage, type LanguageModel } from 'ai'

export const GHOSTFORGE_SYSTEM = `You are GhostForge AI — an operator-grade developer assistant built by Hisham Abulfeilat.
You help with React, Next.js, TypeScript, Tailwind CSS, Git, CI/CD, Carbon tracking, and all GhostForge toolkit features.
You are concise, technical, and direct. You speak like a senior developer.
Available GhostForge commands the user can run on their Mac: ghostforge carbon status, ghostforge carbon track <cmd>, ghostforge ai-review staged, ghostforge standup today, ghostforge dep-health check, ghostforge health-score score, ghostforge bundle track, ghostforge lighthouse run <url>, and many more.
When user asks to run a command, prefix with [RUN]: ghostforge <command> — the UI will offer to execute it.`

export interface ModelOverride {
  activeModel?: string
  activeProvider?: string
}

export interface ModelEntry {
  provider: string
  modelId: string
  model: LanguageModel
}

/** Build an OmniRoute LanguageModel — no API key required */
export function makeOmniRouteModel(modelId = 'auto/coding'): LanguageModel {
  const baseURL = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'
  const omni = createOpenAI({ baseURL, apiKey: 'omniroute' })
  return omni(modelId)
}

/** Whether an error should trigger a fallback to the next model */
export function isFallbackError(e: unknown): boolean {
  const msg = String(e).toLowerCase()
  return (
    msg.includes('quota') ||
    msg.includes('exceeded') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('no longer available') ||
    msg.includes('not found') ||
    msg.includes('deprecated') ||
    msg.includes('unavailable') ||
    msg.includes('model_not_found') ||
    msg.includes('invalid model') ||
    msg.includes('does not exist') ||
    msg.includes('not supported') ||
    msg.includes('no endpoints') ||
    msg.includes('provider returned error') ||
    msg.includes('resource_exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('503') ||
    msg.includes('502')
  )
}

/**
 * Build an ordered fallback chain of AI models.
 * Order: user-selected → gemini → openrouter → omniroute
 */
export async function buildModelChain(opts?: ModelOverride): Promise<ModelEntry[]> {
  const chain: ModelEntry[] = []
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const orKey     = process.env.OPENROUTER_API_KEY
  const omniUrl   = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'

  const added = new Set<string>()
  const push = (entry: ModelEntry) => {
    const key = `${entry.provider}/${entry.modelId}`
    if (!added.has(key)) { added.add(key); chain.push(entry) }
  }

  // 1. User-selected model (highest priority)
  if (opts?.activeProvider && opts?.activeModel) {
    const { activeProvider: ap, activeModel: am } = opts
    if (ap === 'google' && geminiKey) {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      push({ provider: 'google', modelId: am, model: createGoogleGenerativeAI({ apiKey: geminiKey })(am) })
    } else if (ap === 'openrouter' && orKey) {
      push({ provider: 'openrouter', modelId: am, model: createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })(am) })
    } else if (ap === 'omniroute') {
      push({ provider: 'omniroute', modelId: am, model: makeOmniRouteModel(am) })
    }
  }

  // 2. Gemini (env default)
  if (geminiKey) {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const mid = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    push({ provider: 'google', modelId: mid, model: createGoogleGenerativeAI({ apiKey: geminiKey })(mid) })
  }

  // 3. OpenRouter free models (confirmed working July 2025)
  if (orKey) {
    const or = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })
    // Primary: Gemma 4 26B (working)
    push({ provider: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free', model: or('google/gemma-4-26b-a4b-it:free') })
    // Secondary: Nemotron 120B (working)
    push({ provider: 'openrouter', modelId: 'nvidia/nemotron-3-super-120b-a12b:free', model: or('nvidia/nemotron-3-super-120b-a12b:free') })
    // Tertiary: env override (if set manually)
    const mid = process.env.OPENROUTER_MODEL
    if (mid && mid !== 'google/gemma-2.0-flash-exp:free' && mid !== 'google/gemini-2.0-flash-exp:free') {
      push({ provider: 'openrouter', modelId: mid, model: or(mid) })
    }
    // Additional free fallbacks
    push({ provider: 'openrouter', modelId: 'nvidia/nemotron-nano-12b-v2-vl:free', model: or('nvidia/nemotron-nano-12b-v2-vl:free') })
  }

  // 4. xAI Grok (OpenAI-compatible API)
  const xaiKey = process.env.XAI_API_KEY
  if (xaiKey) {
    const grok = createOpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: xaiKey })
    if (opts?.activeProvider === 'xai') {
      const grokModel = opts.activeModel || 'grok-3-mini'
      push({ provider: 'xai', modelId: grokModel, model: grok(grokModel) })
    } else {
      // Always include grok-3-mini as a fallback option when key is set
      push({ provider: 'xai', modelId: 'grok-3-mini', model: grok('grok-3-mini') })
    }
  }

  // 5. Ollama (local, fully private, no API key needed)
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    if (ollamaRes.ok) {
      const ollamaData = await ollamaRes.json() as { models: Array<{ name: string }> }
      const ollamaModels = ollamaData.models || []
      // Prefer qwen2.5-coder > llama3.2 > first available
      const preferred = ['qwen2.5-coder:7b','qwen2.5:7b','llama3.2:3b','llama3.1:8b','mistral:7b']
      const pick = preferred.find(p => ollamaModels.some(m => m.name === p)) || ollamaModels[0]?.name
      if (pick) {
        const ollamaClient = createOpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })
        push({ provider: 'ollama', modelId: pick, model: ollamaClient(pick) })
      }
    }
  } catch { /* Ollama not running */ }

  // 6. OmniRoute (local free gateway, always last)
  if (omniUrl) {
    push({ provider: 'omniroute', modelId: 'auto/coding', model: makeOmniRouteModel('auto/coding') })
  }

  return chain
}

/**
 * Generate text with full automatic fallback chain.
 * Returns text + which model actually answered.
 */
export async function generateWithFallback(
  opts: Omit<Parameters<typeof generateText>[0], 'model'>,
  overrides?: ModelOverride,
): Promise<{ text: string; usedProvider: string; usedModel: string }> {
  const chain = await buildModelChain(overrides)

  if (chain.length === 0) {
    throw new Error('No AI providers configured. Add GOOGLE_GENERATIVE_AI_API_KEY or OPENROUTER_API_KEY to .env.local')
  }

  let lastError: unknown
  for (const entry of chain) {
    try {
      const { text } = await generateText({ ...opts, model: entry.model })
      return { text, usedProvider: entry.provider, usedModel: entry.modelId }
    } catch (e) {
      if (isFallbackError(e)) {
        console.warn(`[GhostForge] ${entry.provider}/${entry.modelId} failed → trying next. Reason: ${String(e).slice(0, 80)}`)
        lastError = e
        continue
      }
      throw e // Non-recoverable error
    }
  }

  throw lastError || new Error('All AI providers failed')
}

/** Legacy: selectAIModel kept for compatibility with streaming routes */
export async function selectAIModel(opts?: ModelOverride): Promise<{ model: LanguageModel; fallbackModel?: LanguageModel }> {
  const chain = await buildModelChain(opts)
  if (chain.length === 0) throw new Error('No AI providers configured')
  return { model: chain[0].model, fallbackModel: chain[1]?.model }
}

/** Legacy non-streaming helper */
export async function generateGhostforgeReply(messages: CoreMessage[], modelOverride?: ModelOverride) {
  const { text } = await generateWithFallback(
    { system: GHOSTFORGE_SYSTEM, messages },
    modelOverride,
  )
  return text
}
