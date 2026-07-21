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
    msg.includes('not supported')
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

  // 3. OpenRouter free model
  if (orKey) {
    const mid = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free'
    push({ provider: 'openrouter', modelId: mid, model: createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })(mid) })
    // Also add a second free fallback
    push({ provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free',
      model: createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })('meta-llama/llama-3.3-70b-instruct:free') })
  }

  // 4. OmniRoute (local, always last)
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
